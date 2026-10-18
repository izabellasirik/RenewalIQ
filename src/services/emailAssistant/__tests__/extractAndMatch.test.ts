import { describe, expect, it } from 'vitest';
import { parseEmailInput } from '../parseEmail';
import { extractWithRules, referenceDateFor } from '../rulesExtractor';
import { buildMatchInputs, matchAccount } from '../matchAccount';
import { isHighRisk, safetyChecks } from '../safetyChecks';
import { AGENCY_A, ALL_ACCOUNTS, candidates, DOTS, otherAgencyNorthwind, TODAY } from './world';
import carrierRequest from './fixtures/carrier-request.eml?raw';
import clientSendsDocs from './fixtures/client-sends-docs.eml?raw';
import spoofed from './fixtures/spoofed-sender.eml?raw';
import malicious from './fixtures/malicious.eml?raw';
import crossAgency from './fixtures/cross-agency.eml?raw';
import threadReply from './fixtures/thread-reply.eml?raw';
import sharedContact from './fixtures/shared-contact.txt?raw';
import ambiguousName from './fixtures/ambiguous-name.txt?raw';
import twoNames from './fixtures/two-names.txt?raw';
import decline from './fixtures/decline.txt?raw';
import noMatch from './fixtures/no-match.txt?raw';

const read = (raw: string, source: 'paste' | 'eml' = 'eml') => {
  const email = parseEmailInput(raw, source);
  return { email, x: extractWithRules(email, { referenceDate: referenceDateFor(email, TODAY) }) };
};
const docs = (x: ReturnType<typeof extractWithRules>) => Object.fromEntries(x.documents.map((d) => [d.requirementKey, d.stance]));

describe('rules extraction', () => {
  it('a carrier request: documents, driver names, instructions, deadline, intent', () => {
    const { x } = read(carrierRequest);
    expect(x.extractor).toEqual({ id: 'rules', version: '1' });
    expect(x.intent).toBe('document_request');
    expect(x.senderRoleGuess).toBe('carrier');
    expect(docs(x)).toEqual({ loss_runs: 'requested', 'mvr|jordan pike': 'requested', 'mvr|casey lin': 'requested', ifta: 'requested' });
    expect(x.documents.find((d) => d.requirementKey === 'loss_runs')!.instructions).toBe('last 5 years, currently valued');
    expect(x.documents.find((d) => d.requirementKey === 'ifta')!.instructions).toBeUndefined(); // the label already says it
    expect(x.documents.find((d) => d.requirementKey === 'mvr|casey lin')!.label).toBe('MVR — Casey Lin');
    // "by Friday, October 23" is the date named — not the next Friday after the email (Oct 16).
    expect(x.deadlines.map((d) => d.date)).toEqual(['2026-10-23']);
    expect(x.identifiers.dotNumbers).toEqual(['3141592']);
  });

  it('a client sending documents: "attached" is not a request, an aside is only a mention', () => {
    const { x } = read(clientSendsDocs);
    expect(x.intent).toBe('documents_sent');
    expect(docs(x)).toEqual({ loss_runs: 'provided', ifta: 'mentioned' });
  });

  it('a reply never re-extracts the request quoted from the earlier email', () => {
    const { x } = read(threadReply);
    expect(x.documents.every((d) => d.stance === 'mentioned')).toBe(true);
    expect(x.deadlines).toEqual([]);
    expect(x.intent).toBe('other');
  });

  it('"received X but still need Y" splits into two answers', () => {
    const { x } = read('From: u@granitemutual.example\nSubject: update\n\nWe received the loss runs but still need the IFTA and the signed application.', 'paste');
    expect(docs(x)).toEqual({ loss_runs: 'already_have', ifta: 'requested', application: 'requested' });
    expect(x.documents.find((d) => d.requirementKey === 'application')!.instructions).toBe('signed and dated');
  });

  it('relative deadlines count from the email date; "effective" dates are not deadlines', () => {
    const { x } = read(ambiguousName, 'paste');
    expect(x.deadlines.map((d) => d.date)).toEqual(['2026-10-21']); // 3 business days after Fri Oct 16
    const e = read('From: a@b.example\nDate: Mon, 12 Oct 2026 09:00:00 -0500\nSubject: x\n\nPolicy effective 11/01. Please send MVRs by 10/20.', 'paste');
    expect(e.x.deadlines.map((d) => d.date)).toEqual(['2026-10-20']);
  });

  it('decline and quote intents', () => {
    expect(read(decline, 'paste').x.intent).toBe('decline');
    expect(read('From: a@b.example\nSubject: Quote\n\nPleased to offer terms; total premium of $48,200. Quote is attached.', 'paste').x.intent).toBe('quote');
  });

  it('text hidden in HTML is never extracted', () => {
    const { x } = read(malicious);
    expect(docs(x)).toEqual({ unit_list: 'requested' });
  });
});

describe('safety checks', () => {
  it('a normal carrier email has no warnings', () => {
    expect(safetyChecks(read(carrierRequest).email)).toEqual([]);
  });

  it('a spoofed sender: failed authentication, different reply-to, payment change', () => {
    const codes = safetyChecks(read(spoofed).email).map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining(['auth_failed', 'reply_to_differs', 'payment_or_credentials']));
    expect(isHighRisk(safetyChecks(read(spoofed).email))).toBe(true);
  });

  it('malicious content: hidden instructions, disguised link, executable attachment', () => {
    const codes = safetyChecks(read(malicious).email).map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining(['instructions_to_software', 'disguised_link', 'dangerous_attachment', 'hidden_text']));
  });

  it('a display name carrying a different address is flagged', () => {
    const email = parseEmailInput('From: "dana@northwindfreight.example" <attacker@evil.example>\nSubject: hi\n\nPlease send the MVRs.', 'paste');
    expect(safetyChecks(email).map((s) => s.code)).toContain('display_name_address');
  });
});

describe('account matching', () => {
  const pool = candidates();
  const match = (raw: string, source: 'paste' | 'eml' = 'eml', agencyId: string | null = AGENCY_A) => {
    const { email, x } = read(raw, source);
    return matchAccount(email, x, pool, { agencyId });
  };

  it('matches on the USDOT number (strong) when the sender is not a contact', () => {
    const m = match(carrierRequest);
    expect(m.status).toBe('matched');
    expect(m.accountId).toBe('acct-northwind');
    expect(m.candidates[0].evidence.map((e) => e.kind)).toEqual(expect.arrayContaining(['dot', 'name', 'market']));
  });

  it('matches on the sender being a contact (strong), case-insensitively', () => {
    const m = match(clientSendsDocs);
    expect(m.status).toBe('matched');
    expect(m.accountId).toBe('acct-northwind');
    expect(m.candidates[0].senderContactId).toBe('c-dana');
  });

  it('a sender who is a contact on two accounts → ambiguous, the broker chooses', () => {
    const m = match(sharedContact, 'paste');
    expect(m.status).toBe('ambiguous');
    expect(m.accountId).toBeUndefined();
    expect(m.candidates.map((c) => c.accountId).sort()).toEqual(['acct-owens-c', 'acct-owens-h']);
  });

  it('a name inside a longer name counts only for the longer one ("ABC Trucking" in "ABC Trucking Express")', () => {
    const m = match(ambiguousName, 'paste');
    expect(m.status).toBe('possible');
    expect(m.accountId).toBe('acct-abcx');
    expect(m.candidates.map((c) => c.accountId)).toEqual(['acct-abcx']);
  });

  it('two similar names both written out → ambiguous', () => {
    const m = match(twoNames, 'paste');
    expect(m.status).toBe('ambiguous');
    expect(m.candidates.map((c) => c.accountId).sort()).toEqual(['acct-abc', 'acct-abcx']);
  });

  it('a name match alone is only "possible" (never automatic)', () => {
    const m = match(decline, 'paste');
    expect(m.status).toBe('possible');
    expect(m.accountId).toBe('acct-northwind');
  });

  it('a different USDOT blocks a name match (wrong-account protection)', () => {
    const m = match(crossAgency);
    expect(m.status).toBe('none');
    expect(m.accountId).toBeUndefined();
    const nw = m.candidates.find((c) => c.accountId === 'acct-northwind')!;
    expect(nw.evidence.map((e) => e.kind)).toContain('dot_conflict');
    // Accounts whose only link is a different USDOT aren't listed at all.
    expect(m.candidates.map((c) => c.accountId)).toEqual(['acct-northwind']);
  });

  it('another agency’s account is never a candidate, even when it would match exactly', () => {
    const m = match(crossAgency);
    expect(m.candidates.map((c) => c.accountId)).not.toContain(otherAgencyNorthwind.id);
    // Without the agency boundary it WOULD be a strong USDOT match — the boundary is what stops it.
    const unbounded = match(crossAgency, 'eml', null);
    expect(unbounded.accountId).toBe(otherAgencyNorthwind.id);
    // buildMatchInputs drops it before matching too.
    const inputs = buildMatchInputs({ accounts: ALL_ACCOUNTS, riskProfiles: {}, quotes: {} }, { agencyId: AGENCY_A });
    expect(inputs.map((i) => i.account.id)).not.toContain(otherAgencyNorthwind.id);
    expect(DOTS[otherAgencyNorthwind.id]).toBe('9999999');
  });

  it('a spoofed contact address still identifies the account it claims — the safety warning is what protects', () => {
    const m = match(spoofed);
    expect(m.status).toBe('matched');
    expect(m.accountId).toBe('acct-northwind');
  });

  it('nothing identifying → no match', () => {
    const m = match(noMatch, 'paste');
    expect(m.status).toBe('none');
    expect(m.candidates).toEqual([]);
  });

  it('archived accounts are left out', () => {
    const archived = candidates().map((c) => (c.account.id === 'acct-northwind' ? { ...c, account: { ...c.account, archived: true } } : c));
    const { email, x } = read(clientSendsDocs);
    expect(matchAccount(email, x, archived, { agencyId: AGENCY_A }).status).toBe('none');
  });
});
