import type { AppetiteFieldKey, AppetiteOverride, AppetiteUpdateRequest, AppetiteUpdateStatus, VerificationStatus } from '../../types';
import { supabase, isSupabaseConfigured } from '../supabase/client';

export const NOT_CONFIGURED_MESSAGE = 'Supabase is not configured in this environment. See SUPABASE_SETUP.md — nothing was submitted or loaded.';

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; reason: 'not_configured' | 'error'; message: string };

function notConfigured<T>(): ServiceResult<T> {
  return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };
}

function errorResult<T>(message: string): ServiceResult<T> {
  return { ok: false, reason: 'error', message };
}

// --- row <-> domain mapping (Supabase columns are snake_case; app types stay camelCase like everywhere else in the codebase) ---

interface RequestRow {
  id: string;
  market_id: string;
  market_name: string;
  field_key: string;
  current_value: unknown;
  proposed_value: string;
  notes: string | null;
  source_url: string | null;
  source_reference: string | null;
  submitter_name: string;
  submitter_email: string;
  status: string;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

function rowToRequest(row: RequestRow): AppetiteUpdateRequest {
  return {
    id: row.id,
    marketId: row.market_id,
    marketName: row.market_name,
    fieldKey: row.field_key as AppetiteFieldKey,
    currentValue: row.current_value,
    proposedValue: row.proposed_value,
    notes: row.notes,
    sourceUrl: row.source_url,
    sourceReference: row.source_reference,
    submitterName: row.submitter_name,
    submitterEmail: row.submitter_email,
    status: row.status as AppetiteUpdateStatus,
    reviewNotes: row.review_notes,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

interface OverrideRow {
  id: string;
  market_id: string;
  field_key: string;
  value: unknown;
  verification_status: string;
  source_url: string | null;
  approved_by: string;
  approved_at: string;
  request_id: string;
}

function rowToOverride(row: OverrideRow): AppetiteOverride {
  return {
    id: row.id,
    marketId: row.market_id,
    fieldKey: row.field_key as AppetiteFieldKey,
    value: row.value,
    verificationStatus: row.verification_status as VerificationStatus,
    sourceUrl: row.source_url,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    requestId: row.request_id,
  };
}

// --- broker submission ---

export interface SubmitAppetiteUpdateInput {
  marketId: string;
  marketName: string;
  fieldKey: AppetiteFieldKey;
  currentValue: unknown;
  proposedValue: string;
  notes: string;
  sourceUrl: string;
  sourceReference: string;
  submitterName: string;
  submitterEmail: string;
}

/** Inserts a new pending request. Never touches live appetite. Returns ok:false (never a false "saved") on any failure, including Supabase not being configured. */
export async function submitAppetiteUpdateRequest(input: SubmitAppetiteUpdateInput): Promise<ServiceResult<null>> {
  if (!supabase) return notConfigured();

  const { error } = await supabase.from('appetite_update_requests').insert({
    market_id: input.marketId,
    market_name: input.marketName,
    field_key: input.fieldKey,
    current_value: input.currentValue as never,
    proposed_value: input.proposedValue,
    notes: input.notes || null,
    source_url: input.sourceUrl || null,
    source_reference: input.sourceReference || null,
    submitter_name: input.submitterName,
    submitter_email: input.submitterEmail,
    status: 'pending',
  });

  if (error) return errorResult(error.message);
  return { ok: true, data: null };
}

// --- admin review ---

/**
 * Every appetite update request regardless of status, newest first — the admin dashboard and the
 * full request queue both derive their counts and filtered views from this single fetch, rather
 * than each re-querying Supabase per status. RLS ("admin can read appetite update requests", see
 * supabase/migrations) already permits an admin to read every status, not just open ones — this
 * was previously a client-side narrowing on top of that, not a security boundary, so removing it
 * doesn't change what an admin is authorized to see.
 */
export async function fetchAllAppetiteUpdateRequests(): Promise<ServiceResult<AppetiteUpdateRequest[]>> {
  if (!supabase) return notConfigured();

  const { data, error } = await supabase.from('appetite_update_requests').select('*').order('created_at', { ascending: false });

  if (error) return errorResult(error.message);
  return { ok: true, data: ((data ?? []) as RequestRow[]).map(rowToRequest) };
}

export interface ReviewDecisionInput {
  request: AppetiteUpdateRequest;
  decision: Exclude<AppetiteUpdateStatus, 'pending'>;
  reviewNotes: string;
  /** Only used when decision === 'approved' — the exact value to write live, chosen/typed by the admin, never auto-derived from the broker's free-text proposal. */
  approvedValue?: unknown;
  /** Only used when decision === 'approved'. Never defaults to VERIFIED — see Part 9 of the spec this implements. */
  approvedVerificationStatus?: Extract<VerificationStatus, 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NEEDS_CONFIRMATION'>;
}

/**
 * Reviews one request via the review_appetite_update_request() database function (see
 * supabase/migrations) — one atomic transaction that updates the request's status, writes a
 * durable audit-history row (for every decision, including reject/needs-more-info), and on
 * approval only, upserts the one live-facing appetite_overrides row for that (market, field).
 * All three either succeed together or fail together. `reviewedBy` is deliberately not a
 * parameter here — the function looks up the caller's own admin_users.email server-side, so a
 * client can never claim to be reviewed by someone else. The function itself re-verifies the
 * caller is an admin before doing anything; that check, not this client call, is the real
 * authorization boundary.
 */
export async function reviewAppetiteUpdateRequest(input: ReviewDecisionInput): Promise<ServiceResult<null>> {
  if (!supabase) return notConfigured();

  const { error } = await supabase.rpc('review_appetite_update_request', {
    p_request_id: input.request.id,
    p_decision: input.decision,
    p_review_notes: input.reviewNotes || null,
    p_approved_value: (input.decision === 'approved' ? (input.approvedValue ?? input.request.proposedValue) : null) as never,
    p_approved_verification_status: input.decision === 'approved' ? (input.approvedVerificationStatus ?? 'NEEDS_CONFIRMATION') : null,
  });

  if (error) return errorResult(error.message);
  return { ok: true, data: null };
}

// --- runtime effective appetite ---

/** Every approved override — the app merges these onto the static base records at runtime. Public/anon-readable by design (see migration). */
export async function fetchAppetiteOverrides(): Promise<ServiceResult<AppetiteOverride[]>> {
  if (!supabase) return notConfigured();

  const { data, error } = await supabase.from('appetite_overrides').select('*');
  if (error) return errorResult(error.message);
  return { ok: true, data: ((data ?? []) as OverrideRow[]).map(rowToOverride) };
}

export { isSupabaseConfigured };
