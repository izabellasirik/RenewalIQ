import type { Account, Contact, MarketQuote, RiskProfile } from '../../types';
import { normalizeDot, normalizeName } from '../intake/duplicateDetection';
import { getAccountContacts } from '../workflow/contacts';
import { getFieldValueByPath } from '../../utils/riskProfilePath';
import type { ParsedEmail } from './parseEmail';
import type { EmailExtraction } from './types';
import { baseDomain } from './safetyChecks';

/**
 * Which account an email is about — deterministic, and only among the accounts the agent can
 * already see (what the database's access rules returned to this browser). Never a guess:
 *   strong evidence  — the sender is a contact on the account; the email's USDOT or MC number is the account's;
 *   medium evidence  — the account's name appears in the email; the sender's company domain is a contact's;
 *   supporting       — a market the account is out to is named (never enough on its own);
 *   conflict         — the email gives a USDOT and the account has a different one.
 * Picked automatically only when exactly one account has strong evidence and nothing contradicts
 * it; otherwise the agent chooses ("possible", "ambiguous" or "no match").
 */

export interface MatchCandidateInput {
  account: Pick<Account, 'id' | 'namedInsured' | 'agencyId' | 'archived'>;
  contacts: Contact[];
  dotNumber?: string | null;
  mcNumber?: string | null;
  marketNames: string[];
}

export type EvidenceStrength = 'strong' | 'medium' | 'supporting' | 'conflict';

export interface MatchEvidence {
  kind: 'sender_contact' | 'dot' | 'mc' | 'name' | 'sender_domain' | 'market' | 'dot_conflict';
  strength: EvidenceStrength;
  detail: string;
}

export interface AccountCandidate {
  accountId: string;
  namedInsured: string;
  evidence: MatchEvidence[];
  score: number;
  /** The contact the sender is, when they are one. */
  senderContactId?: string;
}

export type MatchStatus = 'matched' | 'possible' | 'ambiguous' | 'none';

export interface AccountMatch {
  status: MatchStatus;
  /** Set only for 'matched' (chosen automatically) and 'possible' (pre-selected, the agent confirms). */
  accountId?: string;
  candidates: AccountCandidate[];
  reason: string;
}

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'comcast.net', 'att.net', 'verizon.net', 'gmx.com', 'mail.com']);
/** Single words too common to identify an account by name alone. */
const GENERIC_NAMES = new Set(['trucking', 'transport', 'transportation', 'logistics', 'freight', 'express', 'carriers', 'carrier', 'insurance', 'services', 'company', 'group', 'holdings']);

const WEIGHT: Record<EvidenceStrength, number> = { strong: 10, medium: 4, supporting: 1, conflict: -8 };
const normEmail = (e: string | undefined | null) => (e ?? '').trim().toLowerCase();

/** Candidate inputs from the store — non-archived accounts, and (when the agent is in an agency) only that agency's. */
export function buildMatchInputs(
  state: { accounts: Account[]; riskProfiles: Record<string, RiskProfile>; quotes: Record<string, MarketQuote[]> },
  opts: { agencyId?: string | null } = {}
): MatchCandidateInput[] {
  return state.accounts
    .filter((a) => !a.archived && isSameAgency(a, opts.agencyId))
    .map((account) => {
      const profile = state.riskProfiles[account.id];
      const read = (path: string) => (profile ? ((getFieldValueByPath(profile, path)?.value as string | null | undefined) ?? null) : null);
      return {
        account,
        contacts: getAccountContacts(account),
        dotNumber: read('transportation.dotNumber'),
        mcNumber: read('transportation.mcNumber'),
        marketNames: (state.quotes[account.id] ?? []).map((q) => q.marketName),
      };
    });
}

/** An account from another agency is never a candidate, even if one somehow reached this browser. */
export function isSameAgency(account: Pick<Account, 'agencyId'>, agencyId: string | null | undefined): boolean {
  if (!agencyId) return true;
  return !account.agencyId || account.agencyId === agencyId;
}

interface NameHit {
  accountId: string;
  start: number;
  end: number;
}

function findNameHits(haystack: string, inputs: MatchCandidateInput[]): NameHit[] {
  const hits: NameHit[] = [];
  const padded = ` ${haystack} `;
  for (const input of inputs) {
    const name = normalizeName(input.account.namedInsured);
    if (name.length < 4 || (!name.includes(' ') && GENERIC_NAMES.has(name))) continue;
    let from = 0;
    for (;;) {
      const idx = padded.indexOf(` ${name} `, from);
      if (idx < 0) break;
      hits.push({ accountId: input.account.id, start: idx + 1, end: idx + 1 + name.length });
      from = idx + 1;
    }
  }
  // "ABC Trucking" inside "ABC Trucking Express": only the longer name counts at that spot.
  return hits.filter((h) => !hits.some((o) => o !== h && o.accountId !== h.accountId && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
}

export function matchAccount(email: ParsedEmail, extraction: EmailExtraction, inputs: MatchCandidateInput[], opts: { agencyId?: string | null } = {}): AccountMatch {
  const pool = inputs.filter((i) => !i.account.archived && isSameAgency(i.account, opts.agencyId));
  const sender = normEmail(email.from.address);
  const senderDomain = sender.split('@')[1] ?? '';
  const companyDomain = senderDomain && !FREE_MAIL.has(baseDomain(senderDomain)) ? baseDomain(senderDomain) : '';
  const fullText = `${email.subject}\n${email.from.name ?? ''}\n${email.text}`;
  const normText = normalizeName(fullText);
  const nameHits = findNameHits(normText, pool);
  const emailDots = extraction.identifiers.dotNumbers.map((d) => normalizeDot(d)).filter(Boolean);
  const emailMcs = extraction.identifiers.mcNumbers.map((d) => normalizeDot(d)).filter(Boolean);

  const candidates: AccountCandidate[] = [];
  for (const input of pool) {
    const evidence: MatchEvidence[] = [];
    let senderContactId: string | undefined;
    const contact = sender ? input.contacts.find((c) => normEmail(c.email) === sender) : undefined;
    if (contact) {
      senderContactId = contact.id;
      evidence.push({ kind: 'sender_contact', strength: 'strong', detail: `The sender (${sender}) is ${contact.name}, a contact on this account` });
    } else if (companyDomain && input.contacts.some((c) => baseDomain(normEmail(c.email).split('@')[1] ?? '') === companyDomain)) {
      evidence.push({ kind: 'sender_domain', strength: 'medium', detail: `The sender’s company domain (${companyDomain}) matches a contact on this account` });
    }
    const dot = normalizeDot(input.dotNumber);
    if (dot && emailDots.length) {
      if (emailDots.includes(dot)) evidence.push({ kind: 'dot', strength: 'strong', detail: `USDOT ${dot} in the email is this account’s` });
      else evidence.push({ kind: 'dot_conflict', strength: 'conflict', detail: `The email’s USDOT (${emailDots.join(', ')}) is not this account’s (${dot})` });
    }
    const mc = normalizeDot(input.mcNumber);
    if (mc && emailMcs.includes(mc)) evidence.push({ kind: 'mc', strength: 'strong', detail: `MC ${mc} in the email is this account’s` });
    if (nameHits.some((h) => h.accountId === input.account.id)) evidence.push({ kind: 'name', strength: 'medium', detail: `The email names “${input.account.namedInsured}”` });
    const markets = input.marketNames.filter((m) => marketMentioned(m, normText, senderDomain));
    if (markets.length) evidence.push({ kind: 'market', strength: 'supporting', detail: `Mentions ${markets.join(', ')}, a market this account is out to` });
    // A different USDOT on its own says only that the email is NOT about this account.
    if (evidence.every((e) => e.strength === 'conflict')) continue;
    candidates.push({ accountId: input.account.id, namedInsured: input.account.namedInsured, evidence, score: evidence.reduce((s, e) => s + WEIGHT[e.strength], 0), senderContactId });
  }
  candidates.sort((a, b) => b.score - a.score || a.namedInsured.localeCompare(b.namedInsured));

  const has = (c: AccountCandidate, s: EvidenceStrength) => c.evidence.some((e) => e.strength === s);
  const strong = candidates.filter((c) => has(c, 'strong'));
  if (strong.length === 1 && !has(strong[0], 'conflict')) {
    return { status: 'matched', accountId: strong[0].accountId, candidates, reason: strong[0].evidence.filter((e) => e.strength === 'strong').map((e) => e.detail).join('; ') };
  }
  if (strong.length === 1) {
    return { status: 'ambiguous', candidates, reason: `Conflicting details for ${strong[0].namedInsured}: ${strong[0].evidence.filter((e) => e.strength !== 'supporting').map((e) => e.detail).join('; ')}. Choose the account.` };
  }
  if (strong.length > 1) {
    return { status: 'ambiguous', candidates, reason: `${strong.length} accounts match strongly (${strong.map((c) => c.namedInsured).join(', ')}). Choose the account.` };
  }
  const medium = candidates.filter((c) => has(c, 'medium') && !has(c, 'conflict'));
  if (medium.length === 1) {
    return { status: 'possible', accountId: medium[0].accountId, candidates, reason: `${medium[0].evidence.filter((e) => e.strength === 'medium').map((e) => e.detail).join('; ')} — but the sender isn’t a known contact. Confirm the account.` };
  }
  if (medium.length > 1) {
    return { status: 'ambiguous', candidates, reason: `${medium.length} accounts could fit (${medium.map((c) => c.namedInsured).join(', ')}). Choose the account.` };
  }
  return { status: 'none', candidates, reason: candidates.length ? 'Nothing identifies one account (only markets or a different USDOT). Choose the account, or dismiss.' : 'No account you can see matches this email. Choose one, or dismiss.' };
}

/** A market name in the text, or the sender's domain naming it ("granitemutual" in claims@granitemutual.example). */
function marketMentioned(marketName: string, normText: string, senderDomain: string): boolean {
  const m = normalizeName(marketName);
  if (m.length < 4) return false;
  if (` ${normText} `.includes(` ${m} `)) return true;
  const firstWord = m.split(' ')[0];
  const label = baseDomain(senderDomain).split('.')[0] ?? '';
  return firstWord.length >= 5 && label.includes(firstWord);
}

/** The account's market the email is from or about — only when exactly one fits. */
export function matchQuote(email: ParsedEmail, quotes: MarketQuote[]): { quoteId?: string; candidates: MarketQuote[] } {
  const normText = normalizeName(`${email.subject}\n${email.from.name ?? ''}\n${email.text}`);
  const domain = normEmail(email.from.address).split('@')[1] ?? '';
  const hits = quotes.filter((q) => marketMentioned(q.marketName, normText, domain));
  return { quoteId: hits.length === 1 ? hits[0].id : undefined, candidates: hits };
}
