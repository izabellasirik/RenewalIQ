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

/** Requests still needing attention — 'pending' and 'needs_more_information' both stay in the working queue; only 'approved'/'rejected' are resolved. */
export async function fetchOpenAppetiteUpdateRequests(): Promise<ServiceResult<AppetiteUpdateRequest[]>> {
  if (!supabase) return notConfigured();

  const { data, error } = await supabase
    .from('appetite_update_requests')
    .select('*')
    .in('status', ['pending', 'needs_more_information'])
    .order('created_at', { ascending: false });

  if (error) return errorResult(error.message);
  return { ok: true, data: ((data ?? []) as RequestRow[]).map(rowToRequest) };
}

export interface ReviewDecisionInput {
  request: AppetiteUpdateRequest;
  decision: Exclude<AppetiteUpdateStatus, 'pending'>;
  reviewedBy: string;
  reviewNotes: string;
  /** Only used when decision === 'approved' — the exact value to write live, chosen/typed by the admin, never auto-derived from the broker's free-text proposal. */
  approvedValue?: unknown;
  /** Only used when decision === 'approved'. Never defaults to VERIFIED — see Part 9 of the spec this implements. */
  approvedVerificationStatus?: Extract<VerificationStatus, 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NEEDS_CONFIRMATION'>;
}

/**
 * Reviews one request: 1) updates its status, 2) writes a durable audit-history row (always, for
 * every decision including reject/needs-more-info), 3) on approval only, upserts the one live-facing
 * appetite_overrides row for that (market, field). Steps run in order and stop at the first failure,
 * so a caller can tell exactly how far the review got if something breaks partway through.
 */
export async function reviewAppetiteUpdateRequest(input: ReviewDecisionInput): Promise<ServiceResult<null>> {
  if (!supabase) return notConfigured();
  const now = new Date().toISOString();

  const { error: statusError } = await supabase
    .from('appetite_update_requests')
    .update({ status: input.decision, review_notes: input.reviewNotes || null, reviewed_by: input.reviewedBy, reviewed_at: now })
    .eq('id', input.request.id);
  if (statusError) return errorResult(`Could not update request status: ${statusError.message}`);

  const { error: historyError } = await supabase.from('appetite_update_history').insert({
    request_id: input.request.id,
    market_id: input.request.marketId,
    field_key: input.request.fieldKey,
    previous_value: input.request.currentValue as never,
    new_value: (input.decision === 'approved' ? (input.approvedValue ?? input.request.proposedValue) : null) as never,
    submitted_by: input.request.submitterEmail,
    submitted_at: input.request.createdAt,
    reviewed_by: input.reviewedBy,
    reviewed_at: now,
    status: input.decision,
    source_url: input.request.sourceUrl,
    review_notes: input.reviewNotes || null,
  });
  if (historyError) return errorResult(`Request status was updated, but the audit-history record failed to save: ${historyError.message}`);

  if (input.decision === 'approved') {
    const { error: overrideError } = await supabase.from('appetite_overrides').upsert(
      {
        market_id: input.request.marketId,
        field_key: input.request.fieldKey,
        value: (input.approvedValue ?? input.request.proposedValue) as never,
        verification_status: input.approvedVerificationStatus ?? 'NEEDS_CONFIRMATION',
        source_url: input.request.sourceUrl,
        approved_by: input.reviewedBy,
        approved_at: now,
        request_id: input.request.id,
      },
      { onConflict: 'market_id,field_key' }
    );
    if (overrideError) return errorResult(`Request approved and audited, but the live override failed to save: ${overrideError.message}`);
  }

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
