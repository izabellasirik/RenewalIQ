import type { Account, RiskProfile } from '../../types';
import { getFieldValueByPath } from '../../utils/riskProfilePath';

/**
 * "Possible existing account" on New Account. The database check (find_account_duplicates, 0072) covers the
 * whole agency and only says what the caller may know; these are the same rules, used to turn its answer
 * into plain reasons and — before 0072 is installed or without the cloud — to check the accounts on this
 * device. Never a merge: the broker decides.
 */

export type DuplicateReason = 'same_dot' | 'same_mc' | 'same_name' | 'reordered_name' | 'similar_name';

export interface AccountIdentity {
  name: string;
  dotNumber?: string | null;
  mcNumber?: string | null;
}

export interface AccountDuplicate {
  /** Only for an account the user may open. */
  accountId: string | null;
  namedInsured: string;
  assignedUserId: string | null;
  assignedName: string | null;
  canOpen: boolean;
  archived: boolean;
  reasons: DuplicateReason[];
  similarity?: number | null;
}

/** The answer of a check: `complete: false` when only this device's accounts could be compared. */
export interface DuplicateCheckResult {
  matches: AccountDuplicate[];
  complete: boolean;
}

export const SIMILARITY_THRESHOLD = 0.85;
const MIN_NAME = 3;
const MIN_FUZZY = 6;
const SUFFIXES = /\b(llc|llp|lp|pllc|plc|inc|incorporated|corp|corporation|co|company|ltd|limited)\b/g;

/** Lower case, '&' as 'and', punctuation, common legal suffixes and a leading "the" dropped. */
export function normalizeAccountName(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(l l c|l l p|l p)\b/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/^\s*the\s+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The normalized name's words in alphabetical order. */
export const accountNameKey = (raw: string | null | undefined) => normalizeAccountName(raw).split(' ').filter(Boolean).sort().join(' ');

/** Digits without leading zeros: "USDOT 0123456" = "123456", "MC-012345" = "12345". */
export const normalizeNumber = (raw: string | null | undefined) => (raw ?? '').replace(/\D/g, '').replace(/^0+/, '');

/** Dice coefficient of the letter pairs (spaces ignored), 0..1, rounded to 3 places like the database. */
export function nameSimilarity(a: string, b: string): number {
  const pairs = (s: string) => {
    const t = s.replace(/ /g, '');
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  const total = [...pa.values(), ...pb.values()].reduce((x, y) => x + y, 0);
  if (!total) return 0;
  let common = 0;
  for (const [g, n] of pa) common += Math.min(n, pb.get(g) ?? 0);
  return Math.round((2000 * common) / total) / 1000;
}

export interface LocalCandidate {
  accountId: string;
  namedInsured: string;
  dotNumber?: string | null;
  mcNumber?: string | null;
  assignedUserId?: string | null;
  assignedName?: string | null;
  archived?: boolean;
}

/** Why `candidate` may be the same business as `identity` (empty: it isn't). Same rules as 0072. */
export function duplicateReasons(identity: AccountIdentity, candidate: LocalCandidate, canOpen = true): { reasons: DuplicateReason[]; similarity: number | null } {
  const dot = normalizeNumber(identity.dotNumber);
  const mc = normalizeNumber(identity.mcNumber);
  const cDot = normalizeNumber(candidate.dotNumber);
  const cMc = normalizeNumber(candidate.mcNumber);
  let name = normalizeAccountName(identity.name);
  let key = accountNameKey(identity.name);
  if (name.length < MIN_NAME) name = key = '';
  const cName = normalizeAccountName(candidate.namedInsured);
  const cKey = accountNameKey(candidate.namedInsured);
  const reasons: DuplicateReason[] = [];
  if (dot && dot === cDot) reasons.push('same_dot');
  if (mc && mc === cMc) reasons.push('same_mc');
  const conflict = (!!dot && !!cDot && dot !== cDot) || (!!mc && !!cMc && mc !== cMc);
  const sameName = !!name && name === cName;
  const reordered = !!key && key === cKey && !sameName;
  const sim = key && cKey && key.replace(/ /g, '').length >= MIN_FUZZY && cKey.replace(/ /g, '').length >= MIN_FUZZY ? nameSimilarity(key, cKey) : null;
  if (!conflict) {
    if (sameName) reasons.push('same_name');
    if (reordered) reasons.push('reordered_name');
    if (canOpen && !sameName && !reordered && (sim ?? 0) >= SIMILARITY_THRESHOLD) reasons.push('similar_name');
  }
  return { reasons, similarity: canOpen ? sim : null };
}

/** The same check against accounts on this device (all of which the user can open). Strongest first, at most 5. */
export function findLocalDuplicates(identity: AccountIdentity, candidates: LocalCandidate[]): AccountDuplicate[] {
  const strong = (r: DuplicateReason[]) => (r.includes('same_dot') || r.includes('same_mc') ? 2 : r.includes('same_name') || r.includes('reordered_name') ? 1 : 0);
  return candidates
    .map((c) => ({ c, ...duplicateReasons(identity, c) }))
    .filter((x) => x.reasons.length > 0)
    .sort((a, b) => strong(b.reasons) - strong(a.reasons) || (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, 5)
    .map(({ c, reasons, similarity }) => ({
      accountId: c.accountId,
      namedInsured: c.namedInsured,
      assignedUserId: c.assignedUserId ?? null,
      assignedName: c.assignedName ?? null,
      canOpen: true,
      archived: !!c.archived,
      reasons,
      similarity,
    }));
}

export function localAccountCandidates(accounts: Account[], riskProfiles: Record<string, RiskProfile>): LocalCandidate[] {
  return accounts.map((account) => {
    const profile = riskProfiles[account.id];
    const read = (path: string) => (profile ? (getFieldValueByPath(profile, path)?.value as string | null | undefined) : null);
    return {
      accountId: account.id,
      namedInsured: account.namedInsured,
      dotNumber: read('transportation.dotNumber'),
      mcNumber: read('transportation.mcNumber'),
      assignedUserId: account.assignedBroker?.userId ?? null,
      assignedName: account.assignedBroker?.name ?? null,
      archived: account.archived,
    };
  });
}

/** One plain-language line per reason, e.g. "Same USDOT number (1234567)". Numbers shown are the ones the user entered. */
export function describeReasons(match: AccountDuplicate, identity: AccountIdentity): string[] {
  return match.reasons.map((r) => {
    switch (r) {
      case 'same_dot':
        return `Same USDOT number (${normalizeNumber(identity.dotNumber)})`;
      case 'same_mc':
        return `Same MC number (${normalizeNumber(identity.mcNumber)})`;
      case 'same_name':
        return 'Same company name (ignoring punctuation and suffixes like LLC or Inc)';
      case 'reordered_name':
        return 'Same company name with the words in a different order';
      case 'similar_name':
        return `Very similar company name${match.similarity ? ` (${Math.round(match.similarity * 100)}% alike)` : ''}`;
    }
  });
}

const matchKey = (m: AccountDuplicate) => m.accountId ?? `${m.namedInsured}\u0000${m.assignedUserId ?? ''}`;

/**
 * One check. `remote` is the database's agency-wide check (absent without the cloud): its answer plus any
 * accounts on this device it doesn't know yet (not saved yet). It answering `null` (0072 not installed)
 * means only this device's accounts were compared: `complete: false`, which the page says. A failure is
 * returned as such — never as "no duplicates".
 */
export async function runDuplicateCheck(
  identity: AccountIdentity,
  opts: { remote?: () => Promise<{ ok: true; data: AccountDuplicate[] | null } | { ok: false; message: string }>; local: LocalCandidate[] }
): Promise<{ ok: true; result: DuplicateCheckResult } | { ok: false; message: string }> {
  const local = findLocalDuplicates(identity, opts.local);
  if (!opts.remote) return { ok: true, result: { matches: local, complete: true } };
  let r;
  try {
    r = await opts.remote();
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not check for existing accounts.' };
  }
  if (!r.ok) return { ok: false, message: r.message };
  if (r.data === null) return { ok: true, result: { matches: local, complete: false } };
  const seen = new Set(r.data.map(matchKey));
  return { ok: true, result: { matches: [...r.data, ...local.filter((m) => !seen.has(matchKey(m)))].slice(0, 5), complete: true } };
}

/** Matches in `now` that weren't in what the broker was shown (so a re-check before saving asks again). */
export function unseenMatches(shown: AccountDuplicate[], now: AccountDuplicate[]): AccountDuplicate[] {
  const keys = new Set(shown.map(matchKey));
  return now.filter((m) => !keys.has(matchKey(m)));
}
