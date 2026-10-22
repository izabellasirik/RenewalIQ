import { describe, expect, it } from 'vitest';
import { gmailThreadUrl, linkSearchView, linkableInputs, relatedEmailsView, saveSuggestions, suggestThreadLinks, threadsToMatch, type EmailAccountLink, type EmailThreadMeta } from '../relatedEmails';
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

describe('Refresh re-matches threads fetched earlier (contact saved after the first sync)', () => {
  const stored: EmailThreadMeta = { id: 'th-old', gmailThreadId: 'g-old', subject: 'MVRs attached', fromName: 'Dana Reyes', fromEmail: 'dana@northwindfreight.example', lastMessageId: 'm-old', lastMessageAt: '2026-10-01T10:00:00Z', messageCount: 1 };
  const fresh = { ...stored, id: 'th-new', gmailThreadId: 'g-new', subject: 'Unrelated newsletter', fromEmail: 'news@example.example', snippet: 'Weekly news' };

  it('a stored thread not in this sync is matched — and suggested — once its sender is a contact', () => {
    const pool = threadsToMatch([fresh], [stored, { ...fresh, snippet: undefined } as unknown as EmailThreadMeta]);
    expect(pool.map((p) => p.thread.id)).toEqual(['th-new', 'th-old']); // each once, the synced copy first
    const suggested = pool.flatMap((p) => suggestThreadLinks(p.thread, p.snippet, candidates(), [], { agencyId: AGENCY_A }).map((s) => `${p.thread.id}→${s.accountId}`));
    expect(suggested).toEqual(['th-old→acct-northwind']);
  });

  it('before the fix, only this sync’s threads were matched, so the stored one was never suggested', () => {
    const onlySynced = [fresh].flatMap((t) => suggestThreadLinks(t, t.snippet, candidates(), [], { agencyId: AGENCY_A }));
    expect(onlySynced).toEqual([]);
  });
});

describe('Refresh reports suggestions the database refused (no silent "0 new suggestions")', () => {
  const s = { accountId: 'acct-northwind', reasons: [] };
  it('a refused save is counted and its message kept; successful ones still count', async () => {
    const results = [{ ok: false as const, message: 'You can’t open that account.' }, { ok: true as const }, { ok: false as const, message: 'other' }];
    const r = await saveSuggestions([{ threadId: 't1', suggestion: s }, { threadId: 't2', suggestion: s }, { threadId: 't3', suggestion: s }], async () => results.shift()!);
    expect(r).toEqual({ saved: 1, failed: 2, firstError: 'You can’t open that account.' });
  });
});

describe('Refresh saves suggestions a few at a time (was one by one)', () => {
  const s = { accountId: 'acct-northwind', reasons: [] };
  it('never more than the limit at once, every item saved once, failures still reported', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: string[] = [];
    const items = Array.from({ length: 20 }, (_, i) => ({ threadId: `t${i}`, suggestion: s }));
    const r = await saveSuggestions(items, async (threadId) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      seen.push(threadId);
      await new Promise((res) => setTimeout(res, 2));
      inFlight--;
      return threadId === 't7' ? { ok: false as const, message: 'refused' } : { ok: true as const };
    }, 6);
    expect(peak).toBe(6);
    expect([...seen].sort()).toEqual(items.map((i) => i.threadId).sort());
    expect(r).toEqual({ saved: 19, failed: 1, firstError: 'refused' });
  });
});

describe('Related Emails suggests only the agency’s own accounts (the database refuses the rest)', () => {
  const personal = { ...pool[0], account: { ...pool[0].account, id: 'acct-personal', agencyId: undefined } };
  it('personal and other-agency accounts are left out; agency accounts kept; no agency, none', () => {
    const kept = linkableInputs([...pool, personal], AGENCY_A);
    expect(kept.every((i) => i.account.agencyId === AGENCY_A)).toBe(true);
    expect(kept.length).toBe(pool.filter((i) => i.account.agencyId === AGENCY_A).length);
    expect(linkableInputs(pool, null)).toEqual([]);
  });
  it('the same agency accounts are still suggested (coverage unchanged)', () => {
    const t = thread('Renewal docs', pool.find((i) => i.account.agencyId === AGENCY_A && i.contacts.some((c) => c.email))!.contacts.find((c) => c.email)!.email!);
    const before = suggestThreadLinks(t, '', pool, [], { agencyId: AGENCY_A }).filter((x) => pool.find((i) => i.account.id === x.accountId)!.account.agencyId === AGENCY_A);
    expect(suggestThreadLinks(t, '', linkableInputs(pool, AGENCY_A), [], { agencyId: AGENCY_A })).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });
});

describe('"Link an email" shows "No emails found" only after a search succeeded empty', () => {
  it('loading, error and empty are distinct', () => {
    expect(linkSearchView({ status: 'loading' })).toBe('loading');
    expect(linkSearchView({ status: 'error', message: 'x' })).toBe('error');
    expect(linkSearchView({ status: 'done', rows: [] })).toBe('empty');
    expect(linkSearchView({ status: 'done', rows: [{ id: '1' } as EmailThreadMeta] })).toBe('rows');
  });
});
