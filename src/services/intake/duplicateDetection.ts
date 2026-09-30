import type { Account, IntakeSubmission, RiskProfile } from '../../types';
import { getFieldValueByPath } from '../../utils/riskProfilePath';

const NAME_SUFFIXES = /\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited)\b\.?/g;

/** Case/punctuation/common-suffix-insensitive so "ABC Trucking, LLC" and "abc trucking" compare equal. */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(NAME_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Digits only, so "USDOT 1234567" and "1234567" compare equal. */
export function normalizeDot(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

const normalizeEmail = (raw: string | null | undefined) => (raw ?? '').trim().toLowerCase();
/** Last 10 digits — "+1 (555) 010-2000" and "555-010-2000" compare equal. */
const normalizePhone = (raw: string | null | undefined) => (raw ?? '').replace(/\D/g, '').slice(-10);
const ADDRESS_WORDS: Record<string, string> = { street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', lane: 'ln', suite: 'ste', highway: 'hwy' };
function normalizeAddress(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ADDRESS_WORDS[w] ?? w)
    .join(' ');
}
/** Same street line: the first part of both addresses (number + street), ignoring suite/city formatting. */
function sameAddress(a: string, b: string): boolean {
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  if (!na || !nb || !/\d/.test(na) || !/\d/.test(nb)) return false;
  const street = (s: string) => s.split(' ').slice(0, 3).join(' ');
  return na === nb || street(na) === street(nb);
}

/** What the new submission says about the business. */
export interface IntakeIdentity {
  name?: string | null;
  dotNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

/** An existing account in the same organization (from find_intake_duplicate_accounts, 0039). */
export interface DuplicateCandidate {
  accountId: string;
  namedInsured: string;
  dotNumber?: string | null;
  address?: string | null;
  emails?: string[];
  phones?: string[];
  /** Server-side comparison for accounts whose contact details the caller can't read. */
  emailMatch?: boolean;
  phoneMatch?: boolean;
  assignedName?: string | null;
  canOpen: boolean;
  archived?: boolean;
}

export interface DuplicateMatch {
  candidate: DuplicateCandidate;
  strength: 'exact_dot' | 'name_and_identifier';
  /** Plain-language reason (e.g. "same USDOT number, 1234567"). */
  reason: string;
}

/**
 * Which existing accounts are likely the same business as a new submission — never an automatic
 * merge, only what the broker is shown before deciding. In priority order:
 *   1. the same USDOT number (exact, after normalizing) — a likely match whatever the name;
 *   2. otherwise the same company name AND at least one supporting identifier (address, email or phone).
 * Two different USDOT numbers are two different businesses, even with the same name. A name alone
 * (no USDOT on one side, nothing else in common) is not enough.
 */
export function classifyDuplicates(identity: IntakeIdentity, candidates: DuplicateCandidate[]): DuplicateMatch[] {
  const dot = normalizeDot(identity.dotNumber);
  const name = normalizeName(identity.name);
  const email = normalizeEmail(identity.email);
  const phone = normalizePhone(identity.phone);
  const matches: DuplicateMatch[] = [];

  for (const c of candidates) {
    const cDot = normalizeDot(c.dotNumber);
    if (dot && cDot) {
      if (dot === cDot) matches.push({ candidate: c, strength: 'exact_dot', reason: `same USDOT number, ${dot}` });
      continue; // both have a USDOT and they differ: a different business
    }
    if (!name || normalizeName(c.namedInsured) !== name) continue;
    const support: string[] = [];
    if (identity.address && c.address && sameAddress(identity.address, c.address)) support.push('address');
    if (email && (c.emailMatch || (c.emails ?? []).some((e) => normalizeEmail(e) === email))) support.push('email');
    if (phone.length >= 7 && (c.phoneMatch || (c.phones ?? []).some((p) => normalizePhone(p) === phone))) support.push('phone');
    if (support.length > 0) matches.push({ candidate: c, strength: 'name_and_identifier', reason: `same company name and ${support.join(' and ')}` });
  }
  return matches.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'exact_dot' ? -1 : 1));
}

export function intakeIdentity(submission: IntakeSubmission): IntakeIdentity {
  return { name: submission.namedInsured, dotNumber: submission.dotNumber, email: submission.contactEmail, phone: submission.contactPhone };
}

/**
 * Before the server check (0039) is available: the same rules against the accounts on this device.
 * These are only the accounts this user can see, so the server check is what covers the whole agency.
 */
export function localDuplicateCandidates(accounts: Account[], riskProfiles: Record<string, RiskProfile>): DuplicateCandidate[] {
  return accounts.map((account) => {
    const profile = riskProfiles[account.id];
    const read = (path: string) => (profile ? (getFieldValueByPath(profile, path)?.value as string | null | undefined) : null);
    const contacts = account.contacts ?? [];
    return {
      accountId: account.id,
      namedInsured: account.namedInsured,
      dotNumber: read('transportation.dotNumber'),
      address: read('business.address'),
      emails: [account.contactEmail, ...contacts.map((c) => c.email)].filter((e): e is string => !!e),
      phones: [account.contactPhone, ...contacts.map((c) => c.phone)].filter((p): p is string => !!p),
      assignedName: account.assignedBroker?.name ?? null,
      canOpen: true,
      archived: account.archived,
    };
  });
}
