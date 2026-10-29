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

/** A referral partner an agent typed in under "Other" (0083), and the accounts that use it. */
export interface PartnerRequest {
  sourceId: string;
  name: string;
  requestedBy: string | null;
  accounts: { id: string; name: string; agent: string; agentId: string | null }[];
  /** Once decided: the partner it was merged into, and the agreed amount it was approved with. */
  mergedInto: string | null;
  partnerFeeCents: number | null;
}

export interface AdminReviewItem {
  id: string;
  kind: 'possible_duplicate' | 'new_referral_partner';
  status: 'open' | 'resolved';
  createdAt: string;
  createdByName: string | null;
  account: ReviewAccount;
  related: ReviewAccount[];
  resolution: 'kept_both' | 'archived_new' | 'approved' | 'merged' | 'rejected' | null;
  /** new_referral_partner items only. */
  partner?: PartnerRequest;
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
        kind: r.kind === 'new_referral_partner' ? 'new_referral_partner' : 'possible_duplicate',
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
        ...(r.kind === 'new_referral_partner' ? { partner: partnerFrom((r.detail as Record<string, unknown>) ?? {}) } : {}),
      })),
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not load Admin Review.' };
  }
}

function partnerFrom(d: Record<string, unknown>): PartnerRequest {
  return {
    sourceId: String(d.source_id ?? ''),
    name: String(d.name ?? ''),
    requestedBy: (d.requested_by as string) ?? null,
    accounts: ((d.accounts as Record<string, unknown>[]) ?? []).map((a) => ({ id: String(a.id), name: String(a.name ?? ''), agent: String(a.agent ?? ''), agentId: (a.agentId as string) ?? null })),
    mergedInto: (d.merged_into as string) ?? null,
    partnerFeeCents: d.partner_fee_cents === null || d.partner_fee_cents === undefined ? null : Number(d.partner_fee_cents),
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
