import { describe, expect, it } from 'vitest';
import { gmailThreadUrl, relatedEmailsView, suggestThreadLinks, type EmailAccountLink, type EmailThreadMeta } from '../relatedEmails';
import { AGENCY_A, candidates } from '../../emailAssistant/__tests__/world';

// Synthetic accounts and mail only (the Email Assistant's test world).
const pool = candidates();
const thread = (subject: string, fromEmail: string, fromName = 'Someone') => ({ subject, fromEmail, fromName });
const suggest = (subject: string, fromEmail: string, snippet = '', linked: string[] = []) =>
  suggestThreadLinks(thread(subject, fromEmail), snippet, pool, linked, { agencyId: AGENCY_A }).map((s) => s.accountId);

describe('which accounts a Gmail thread may be about (the existing deterministic matcher)', () => {
  it('a known contact writing: suggested, with why', () => {
    const s = suggestThreadLinks(thread('MVRs', 'dana@northwindfreight.example', 'Dana Reyes'), 'Attached are the MVRs.', pool, [], { agencyId: AGENCY_A });
    expect(s.map((x) => x.accountId)).toEqual(['acct-northwind']);
    expect(s[0].reasons.some((r) => r.kind === 'sender_contact')).toBe(true);
  });
  it('the account’s USDOT in the subject or snippet', () => {
    expect(suggest('Loss runs USDOT 3141592', 'claims@carrier.example')).toEqual(['acct-northwind']);
  });
  it('the account’s name from an unknown sender: still suggested (only ever as possible)', () => {
    expect(suggest('Quote for Northwind Freight LLC', 'underwriter@market.example')).toEqual(['acct-northwind']);
  });
  it('one sender who is a contact on two accounts: both suggested, neither assumed', () => {
    expect(suggest('Renewal', 'pat@owensholdings.example').sort()).toEqual(['acct-owens-c', 'acct-owens-h']);
  });
  it('a different USDOT rules the account out', () => {
    expect(suggest('USDOT 7777777 docs', 'dana@northwindfreight.example')).toEqual([]);
  });
  it('a market named on its own is never enough', () => {
    expect(suggest('Granite Mutual appetite update', 'news@granitemutual.example')).toEqual([]);
  });
  it('accounts already linked (including Not Related) are never suggested again', () => {
    expect(suggest('Quote for Northwind Freight LLC', 'underwriter@market.example', '', ['acct-northwind'])).toEqual([]);
  });
  it('another agency’s account is never suggested', () => {
    expect(suggest('Northwind Freight Inc USDOT 9999999', 'contact@other-agency-client.example')).toEqual([]);
  });
  it('a newsletter naming many accounts suggests none', () => {
    expect(suggest('Market news', 'news@example.example', 'Northwind Freight LLC, ABC Trucking, ABC Trucking Express, Owens Hauling, Owens Cold Chain')).toEqual([]);
  });
});

describe('what the Overview shows', () => {
  const t = (id: string, at: string, subject = `Subject ${id}`): EmailThreadMeta => ({ id, gmailThreadId: `g${id}`, subject, fromName: 'X', fromEmail: 'x@x.example', lastMessageId: `m${id}`, lastMessageAt: at, messageCount: 1 });
  const l = (id: string, threadId: string, reviewStatus: EmailAccountLink['reviewStatus'], accountId = 'acct-1'): EmailAccountLink => ({ id, accountId, threadId, matchStatus: 'possible', reviewStatus, reasons: [] });
  const threads = Array.from({ length: 7 }, (_, i) => t(`t${i}`, `2026-10-1${i}T10:00:00Z`));
  const links = [...threads.slice(0, 6).map((x, i) => l(`l${i}`, x.id, 'active')), l('ld', 't6', 'reviewed'), l('lx', 't0', 'not_related', 'acct-1b'), l('ly', 't1', 'not_related')];

  it('newest To Review first; at most 5 in the preview; Reviewed and Not Related kept apart', () => {
    const v = relatedEmailsView('acct-1', links.filter((x) => x.id !== 'ly'), threads);
    expect(v.awaitingCount).toBe(6);
    expect(v.preview.map((r) => r.link.id)).toEqual(['l5', 'l4', 'l3', 'l2', 'l1']);
    expect(v.reviewed.map((r) => r.link.id)).toEqual(['ld']);
    expect(v.latestSubject).toBe('Subject t5');
  });
  it('Not Related ones don’t show; other accounts’ links don’t either', () => {
    const v = relatedEmailsView('acct-1', [l('ly', 't1', 'not_related'), l('lz', 't2', 'active', 'acct-2')], threads);
    expect(v.awaitingCount).toBe(0);
    expect(v.latestSubject).toBeNull();
  });
  it('links to the thread in the right mailbox', () => {
    expect(gmailThreadUrl('agent.a@agency.example', '18c2f0a1b')).toBe('https://mail.google.com/mail/?authuser=agent.a%40agency.example#all/18c2f0a1b');
  });
});
