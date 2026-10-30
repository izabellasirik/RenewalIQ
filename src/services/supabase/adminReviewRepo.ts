import { supabase } from './client';
import type { RepoResult } from './commissionRepo';

/**
 * Admin Review (0080): things an agency admin should look at — first, accounts an agent created that may
 * duplicate one the agency already has (flagged by the database when the account is saved). Admins only:
 * the database returns nothing to anyone else and checks again when deciding.
 */
export interface ReviewAccount {
  id: string;
  name: string;
  agent: string;
  archived: boolean;
  createdAt?: string;
  reasons: string[];
}

/** An agent chose "Other" as a client's referral partner (0083): what they typed, and what's on the account now. */
export interface OtherReferralReview {
  name: string;
  partnerFeeCents: number;
  /** On the account now (null once it was added to the list or rejected). */
  current: { name: string; partnerFeeCents: number } | null;
  /** Once decided: the amount it ended with. */
  finalFeeCents: number | null;
}

export interface AdminReviewItem {
  id: string;
  kind: 'possible_duplicate' | 'other_referral';
  status: 'open' | 'resolved';
  createdAt: string;
  createdByName: string | null;
  account: ReviewAccount;
  related: ReviewAccount[];
  resolution: 'kept_both' | 'archived_new' | 'ok' | 'changed' | 'added' | 'rejected' | null;
  /** other_referral items only. */
  other?: OtherReferralReview;
  resolvedByName: string | null;
  resolvedAt: string | null;
}

export const MIGRATION_0080_MESSAGE = 'Admin Review needs database migration 0080_admin_review.sql.';
const missing = (m: string) => /admin_review_items|resolve_admin_review|schema cache|PGRST202/i.test(m);

export async function fetchAdminReviewItems(): Promise<RepoResult<AdminReviewItem[]>> {
  if (!supabase) return { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
  try {
    const { data, error } = await supabase.rpc('admin_review_items');
    if (error) return missing(error.message) ? { ok: false, message: MIGRATION_0080_MESSAGE, missingMigration: true } : { ok: false, message: error.message };
    return {
      ok: true,
      data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        kind: r.kind === 'other_referral' ? 'other_referral' : 'possible_duplicate',
        status: r.status === 'resolved' ? 'resolved' : 'open',
        createdAt: String(r.created_at),
        createdByName: (r.created_by_name as string) ?? null,
        account: { id: String(r.submission_id), name: (r.account_name as string) ?? 'Deleted account', agent: (r.account_agent as string) ?? '', archived: !!r.account_archived, reasons: [] },
        related: ((r.related as Record<string, unknown>[]) ?? []).map((o) => ({
          id: String(o.id),
          name: String(o.name ?? ''),
          agent: String(o.agent ?? ''),
          archived: !!o.archived,
          createdAt: (o.createdAt as string) ?? undefined,
          reasons: Array.isArray(o.reasons) ? (o.reasons as string[]) : [],
        })),
        resolution: (r.resolution as AdminReviewItem['resolution']) ?? null,
        resolvedByName: (r.resolved_by_name as string) ?? null,
        resolvedAt: (r.resolved_at as string) ?? null,
        ...(r.kind === 'other_referral' ? { other: otherFrom((r.detail as Record<string, unknown>) ?? {}) } : {}),
      })),
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not load Admin Review.' };
  }
}

function otherFrom(d: Record<string, unknown>): OtherReferralReview {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    name: String(d.name ?? ''),
    partnerFeeCents: Number(d.partner_fee_cents ?? 0),
    current: d.current_name ? { name: String(d.current_name), partnerFeeCents: Number(d.current_fee_cents ?? 0) } : null,
    finalFeeCents: n(d.final_fee_cents),
  };
}

export async function resolveAdminReview(id: string, action: 'keep_both' | 'archive_new'): Promise<RepoResult<string>> {
  if (!supabase) return { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
  try {
    const { data, error } = await supabase.rpc('resolve_admin_review', { p_id: id, p_action: action });
    if (error) return { ok: false, message: error.message };
    return { ok: true, data: String(data) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not save.' };
  }
}

export const REASON_LABELS: Record<string, string> = {
  same_dot: 'Same USDOT',
  same_mc: 'Same MC',
  same_name: 'Same name',
  reordered_name: 'Same words, different order',
};
