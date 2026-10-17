import { supabase } from './client';
import type { DocumentRequest, DocumentRequestFile, DocumentRequestItem } from '../../types';
import { storageSafeName } from './intakeRepo';
import { clientRequestUrl } from '../publicLinks';
import { errorMessage, errorStatus, withRetry, withTimeout } from '../intake/retry';
import { precheckUpload, rejectedFileError, storageBody, storageContentType, verifyUploadOnServer } from '../uploads/uploadCheck';

/**
 * Client document requests (0030). Broker functions run signed in and are checked by the database
 * against the account's access rule; client functions run anonymously and only ever with the
 * request's link token. Uploads reuse 0029's fail-safe approach: a stable storage path per file,
 * retries for temporary failures, and a file only counts once the server has verified it's in
 * storage and linked it.
 */

export type RepoResult<T = void> = { ok: true; data: T } | { ok: false; message: string };

const BUCKET = 'intake-uploads';
const NOT_CONFIGURED = 'This isn’t available in this environment.';
const TIMEOUT = 30_000;
const fail = (message: string): RepoResult<never> => ({ ok: false, message });

/** 0030 isn't applied yet — the broker sees the email-only request flow instead. */
export const isMissingRequestsSchema = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST202' || e.code === 'PGRST205' || e.code === '42P01' || /document_request/.test(e.message ?? '');

export function requestLink(token: string): string {
  return clientRequestUrl(token);
}

// ---------------------------------------------------------------------------------------------
// Broker
// ---------------------------------------------------------------------------------------------

interface RequestRow {
  id: string;
  submission_id: string;
  token: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  channel: DocumentRequest['channel'];
  status: DocumentRequest['status'];
  requested_at: string;
  sent_at?: string | null;
  delivery_status?: DocumentRequest['deliveryStatus'] | null;
  last_follow_up_at: string | null;
  follow_up_count: number;
  next_follow_up: string | null;
  expires_at: string;
  closed_at: string | null;
  created_by_name: string | null;
  document_request_items?: {
    id: string;
    missing_item_id: string;
    label: string;
    instructions: string | null;
    status: DocumentRequestItem['status'];
    uploaded_at: string | null;
    satisfied_at: string | null;
    position: number;
  }[];
  document_request_files?: {
    id: string;
    request_item_id: string | null;
    file_name: string;
    storage_path: string;
    size_bytes: number | null;
    uploaded_at: string;
    imported_document_id: string | null;
    imported_at: string | null;
    match_status: DocumentRequestFile['matchStatus'];
    match_note: string | null;
    resolved_item_id?: string | null;
  }[];
}

function toRequest(r: RequestRow): DocumentRequest {
  return {
    id: r.id,
    accountId: r.submission_id,
    token: r.token,
    contactId: r.contact_id ?? undefined,
    contactName: r.contact_name ?? undefined,
    contactEmail: r.contact_email ?? undefined,
    channel: r.channel,
    status: r.status,
    // Before 0047 there's no delivery status: those requests were never confirmed as sent.
    deliveryStatus: r.delivery_status ?? 'unconfirmed',
    sentAt: r.sent_at ?? undefined,
    requestedAt: r.requested_at,
    lastFollowUpAt: r.last_follow_up_at ?? undefined,
    followUpCount: r.follow_up_count,
    nextFollowUp: r.next_follow_up ?? undefined,
    expiresAt: r.expires_at,
    closedAt: r.closed_at ?? undefined,
    createdByName: r.created_by_name ?? undefined,
    items: (r.document_request_items ?? [])
      .map((i) => ({
        id: i.id,
        missingItemId: i.missing_item_id,
        label: i.label,
        instructions: i.instructions ?? undefined,
        status: i.status,
        uploadedAt: i.uploaded_at ?? undefined,
        satisfiedAt: i.satisfied_at ?? undefined,
        position: i.position,
      }))
      .sort((a, b) => a.position - b.position),
    files: (r.document_request_files ?? [])
      .map((f) => ({
        id: f.id,
        requestItemId: f.request_item_id ?? undefined,
        fileName: f.file_name,
        storagePath: f.storage_path,
        sizeBytes: f.size_bytes ?? undefined,
        uploadedAt: f.uploaded_at,
        importedDocumentId: f.imported_document_id ?? undefined,
        importedAt: f.imported_at ?? undefined,
        matchStatus: f.match_status,
        matchNote: f.match_note ?? undefined,
        resolvedItemId: f.resolved_item_id ?? undefined,
      }))
      .sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1)),
  };
}

/** Every request the signed-in broker can see (RLS), optionally for some accounts only. Empty before 0030. */
export async function fetchDocumentRequests(accountIds?: string[]): Promise<RepoResult<DocumentRequest[]>> {
  if (!supabase) return fail(NOT_CONFIGURED);
  let q = supabase.from('document_requests').select('*, document_request_items(*), document_request_files(*)').order('requested_at', { ascending: false });
  if (accountIds) q = q.in('submission_id', accountIds);
  const { data, error } = await q;
  if (error) return isMissingRequestsSchema(error) ? { ok: true, data: [] } : fail(error.message);
  return { ok: true, data: ((data ?? []) as RequestRow[]).map(toRequest) };
}

export interface NewRequestInput {
  accountId: string;
  /** One per click of "send" — repeating it returns the same request. */
  clientKey: string;
  contact?: { id?: string; name?: string; email?: string };
  channel?: DocumentRequest['channel'];
  items: { missingItemId: string; label: string; instructions?: string }[];
  nextFollowUp?: string;
  requestedAt?: string;
  /** The link's token, made when the request dialog opened so the email could show the real link (0045). */
  token?: string;
}

/** 0045 not applied yet: the function doesn't take p_token. */
const isMissingTokenParam = (error: { code?: string; message?: string }) => error.code === 'PGRST202' || /Could not find the function|p_token/i.test(error.message ?? '');

export async function createDocumentRequest(input: NewRequestInput): Promise<RepoResult<{ id: string; token: string }>> {
  if (!supabase) return fail(NOT_CONFIGURED);
  try {
    const data = await withRetry(async () => {
      const args = {
        p_submission_id: input.accountId,
        p_client_key: input.clientKey,
        p_contact: input.contact ?? {},
        p_channel: input.channel ?? 'email',
        p_items: input.items,
        p_next_follow_up: input.nextFollowUp || null,
        p_requested_at: input.requestedAt ?? null,
      };
      const rpc = (withToken: boolean) => withTimeout(Promise.resolve(supabase!.rpc('create_document_request', withToken ? { ...args, p_token: input.token } : args)), TIMEOUT, 'Creating the request');
      let { data, error } = await rpc(!!input.token);
      // Without 0045 the database makes the token itself; the caller swaps the link in the email.
      if (error && input.token && isMissingTokenParam(error)) ({ data, error } = await rpc(false));
      if (error) throw Object.assign(new Error(isMissingRequestsSchema(error) ? 'Secure request links need migration 0030_document_requests.sql in Supabase.' : error.message), { code: error.code });
      return data as { id: string; token: string };
    });
    return { ok: true, data };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

async function call(fn: string, args: Record<string, unknown>): Promise<RepoResult<unknown>> {
  if (!supabase) return fail(NOT_CONFIGURED);
  try {
    const data = await withRetry(async () => {
      const { data, error } = await withTimeout(Promise.resolve(supabase!.rpc(fn, args)), TIMEOUT);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data;
    });
    return { ok: true, data };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

/**
 * The broker sent the request (or confirms an older one was sent). Before 0047 there is no
 * delivery status to set — the old behaviour (every request counts as requested) stays.
 */
export async function markRequestSent(requestId: string, sentAt?: string, nextFollowUp?: string): Promise<RepoResult<{ recorded: boolean }>> {
  const res = await call('mark_document_request_sent', { p_request_id: requestId, p_sent_at: sentAt ?? null, p_next_follow_up: nextFollowUp || null });
  if (!res.ok && /mark_document_request_sent|PGRST202|schema cache/i.test(res.message)) return { ok: true, data: { recorded: false } };
  return res.ok ? { ok: true, data: { recorded: true } } : res;
}

export const recordRequestFollowUp = (requestId: string, nextFollowUp: string | null) => call('record_document_request_follow_up', { p_request_id: requestId, p_next_follow_up: nextFollowUp });
export const setRequestNextFollowUp = (requestId: string, nextFollowUp: string | null) => call('set_document_request_next_follow_up', { p_request_id: requestId, p_next_follow_up: nextFollowUp });
export const cancelDocumentRequest = (requestId: string) => call('cancel_document_request', { p_request_id: requestId });
export const settleRequestItems = (accountId: string, missingItemIds: string[], status: 'satisfied' | 'waived') =>
  call('settle_document_request_items', { p_submission_id: accountId, p_missing_item_ids: missingItemIds, p_status: status });
/** Short lock before importing a file: `held` for confirming one that waits for review (0031), otherwise one not yet checked. */
export async function claimRequestFile(fileId: string, held = false): Promise<boolean> {
  const r = await call('claim_document_request_file', held ? { p_file_id: fileId, p_held: true } : { p_file_id: fileId });
  return r.ok && r.data === true;
}
/** Give a claim back when nothing was imported (0031) — best effort; it lapses after 10 minutes anyway. */
export const releaseRequestFile = (fileId: string) => call('release_document_request_file', { p_file_id: fileId });
/** The automatic check's result; a file held for review has no documentId (it isn't in the account yet). */
export const completeRequestFile = (fileId: string, documentId: string | null, match: 'satisfied' | 'needs_review', note?: string, itemId?: string) =>
  call('complete_document_request_file', { p_file_id: fileId, p_document_id: documentId, p_match: match, p_note: note ?? null, ...(itemId ? { p_item_id: itemId } : {}) });
/** A held or imported file's review decision; `documentId` is the account document a held file was just imported as (0031). */
export async function resolveRequestFile(fileId: string, action: 'satisfy' | 'reject' | 'reassign', targetItemId?: string, documentId?: string) {
  const res = await call('resolve_document_request_file', { p_file_id: fileId, p_action: action, p_target_item_id: targetItemId ?? null, p_document_id: documentId ?? null });
  // Before 0031 the function had no document parameter.
  if (!res.ok && /resolve_document_request_file|function .* does not exist|PGRST202/i.test(res.message)) {
    return call('resolve_document_request_file', { p_file_id: fileId, p_action: action, p_target_item_id: targetItemId ?? null });
  }
  return res;
}
/** An accepted file was the wrong document: asked for again, request reopened (0031). */
export const markRequestFileWrong = (fileId: string, note: string) => call('mark_document_request_file_wrong', { p_file_id: fileId, p_note: note });

/** The client's original file, for importing into the account. */
export async function downloadRequestFile(file: Pick<DocumentRequestFile, 'storagePath' | 'fileName'>): Promise<RepoResult<File>> {
  if (!supabase) return fail(NOT_CONFIGURED);
  try {
    const blob = await withRetry(async () => {
      const { data, error } = await supabase!.storage.from(BUCKET).download(file.storagePath);
      if (error || !data) throw error ?? new Error('Could not download the file.');
      return data;
    });
    return { ok: true, data: new File([blob], file.fileName, { type: blob.type }) };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

// ---------------------------------------------------------------------------------------------
// Client (anonymous, link token only)
// ---------------------------------------------------------------------------------------------

export interface PublicRequestFile {
  name: string;
  uploadedAt: string;
  /** 0031: the client's own key for the file, whether it's accepted yet, and whether they can still remove it. */
  key?: string;
  state?: 'checking' | 'accepted';
  removable?: boolean;
}

export interface PublicRequestItem {
  id: string;
  label: string;
  instructions?: string | null;
  received: boolean;
  /** 0031: the agent has accepted what was sent. */
  confirmed?: boolean;
  files: PublicRequestFile[];
}

export interface PublicRequestView {
  requestId: string;
  folder: string;
  status: 'waiting' | 'partial' | 'complete' | 'cancelled' | 'expired';
  accountName: string;
  /** 0033: the agency the client is dealing with (the account's agency, or the name the broker shows clients). */
  agencyName?: string | null;
  /** When the client last pressed Submit (0035); absent before it's run. */
  submittedAt?: string | null;
  /** 0033: files sent with "Upload multiple documents" that your agent hasn't placed yet. */
  unassigned?: PublicRequestFile[];
  contactFirstName?: string | null;
  items: PublicRequestItem[];
}

export async function fetchPublicRequest(token: string): Promise<RepoResult<PublicRequestView | null>> {
  if (!supabase) return fail(NOT_CONFIGURED);
  try {
    const data = await withRetry(async () => {
      const { data, error } = await withTimeout(Promise.resolve(supabase!.rpc('get_document_request', { p_token: token })), TIMEOUT, 'Loading the request');
      if (error) {
        if (error.code === '22P02') return null; // not a valid token at all
        throw Object.assign(new Error(error.message), { code: error.code });
      }
      return (data as PublicRequestView | null) ?? null;
    });
    return { ok: true, data };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

const isAlreadyThere = (error: unknown) => errorStatus(error) === 409 || /already exists|duplicate/i.test(errorMessage(error));

/**
 * Uploads one file for one requested item and has the server verify and link it. Resolves with the
 * updated view only once the server has confirmed the file — until then nothing shows as received.
 */
export async function uploadRequestFile(
  token: string,
  folder: string,
  /** null: "Upload multiple documents" — the agent's check works out which item it is. */
  itemId: string | null,
  fileKey: string,
  file: File,
  onRetry?: (attempt: number, reason: string) => void
): Promise<PublicRequestView> {
  if (!supabase) throw new Error(NOT_CONFIGURED);
  const pre = await precheckUpload(file);
  if (!pre.ok) throw rejectedFileError(pre.reason);
  const path = `${folder}/${fileKey}/${storageSafeName(file.name)}`;
  const timeout = 60_000 + Math.ceil(file.size / 50_000) * 1000;
  return withRetry(
    async () => {
      const up = await withTimeout(Promise.resolve(supabase!.storage.from(BUCKET).upload(path, storageBody(file), { contentType: storageContentType(file) })), timeout, `Uploading ${file.name}`);
      if (up.error && !isAlreadyThere(up.error)) {
        if (errorStatus(up.error) === 413 || /too large|exceeded the maximum/i.test(up.error.message)) throw Object.assign(new Error(`${file.name} is too large to upload (25 MB at most).`), { status: 413 });
        throw up.error;
      }
      // The server reads the stored file and checks it really is what its name says (0048).
      const checked = await verifyUploadOnServer('intake-uploads', path);
      if (checked.status === 'rejected') throw rejectedFileError(checked.message);
      const { data, error } = await withTimeout(
        Promise.resolve(supabase!.rpc('attach_document_request_file', { p_token: token, p_item_id: itemId, p_file_key: fileKey, p_file_name: file.name, p_storage_path: path, p_size: file.size })),
        TIMEOUT,
        `Confirming ${file.name}`
      );
      if (error) {
        if (error.code === 'P0002') throw Object.assign(new Error(error.message), { status: 503 });
        throw Object.assign(new Error(error.message), { code: error.code });
      }
      return data as PublicRequestView;
    },
    { onRetry: (attempt, err) => onRetry?.(attempt, errorMessage(err)) }
  );
}

/** The client takes back a file that hasn't been accepted yet (e.g. the wrong one) — 0031. */
/**
 * The client's "Submit": that's everything for now. Records when and tells the broker (activity) —
 * nothing is accepted or counted by it. Needs migration 0035.
 */
export async function submitDocumentRequest(token: string): Promise<RepoResult<PublicRequestView>> {
  if (!supabase) return fail(NOT_CONFIGURED);
  try {
    const data = await withRetry(async () => {
      const { data, error } = await withTimeout(Promise.resolve(supabase!.rpc('submit_document_request', { p_token: token })), TIMEOUT, 'Submitting');
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data as PublicRequestView;
    });
    return { ok: true, data };
  } catch (err) {
    const message = errorMessage(err);
    return fail(/submit_document_request|schema cache|PGRST202/i.test(message) ? 'Submitting isn’t available yet — your files are already with your agent.' : message);
  }
}

export async function withdrawRequestFile(token: string, fileKey: string): Promise<RepoResult<PublicRequestView>> {
  if (!supabase) return fail(NOT_CONFIGURED);
  try {
    const data = await withRetry(async () => {
      const { data, error } = await withTimeout(Promise.resolve(supabase!.rpc('withdraw_document_request_file', { p_token: token, p_file_key: fileKey })), TIMEOUT, 'Removing the file');
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data as PublicRequestView;
    });
    return { ok: true, data };
  } catch (err) {
    return fail(errorMessage(err));
  }
}
