import { describe, expect, it } from 'vitest';
import type { Account, AccountRenewal, MarketQuote } from '../../../types';
import {
  addRenewal,
  addYears,
  canManageRenewals,
  checkRenewalInput,
  closeRenewal,
  isRenewalDue,
  isRenewalRecord,
  leadDaysFor,
  nextOpenRenewal,
  prepareNextRenewal,
  receivesRenewalReminders,
  reopenRenewal,
  renewalPhase,
  renewalTaskId,
  resolveRenewals,
  updateRenewal,
} from '../renewals';
import { actionDoneKey, deriveAccountActions } from '../nextActions';

const TODAY = '2026-10-17';
let n = 0;
const clock = () => ({ now: '2026-10-17T12:00:00Z', newId: () => `r${++n}` });
const account = (over: Partial<Account> = {}): Account => ({ id: 'a1', namedInsured: 'Lone Pine (sample)', state: 'TX', createdAt: '', updatedAt: '', status: 'new', archived: false, ...over });
const quote = (id: string, status: MarketQuote['status'], renewalId?: string): MarketQuote => ({ id, accountId: 'a1', marketName: `M-${id}`, status, notes: [], createdAt: '', updatedAt: '', ...(renewalId ? { renewalId } : {}) });
const renewalTasks = (acct: Account, effectiveDate: string | null, quotes: MarketQuote[] = [], today = TODAY) =>
  deriveAccountActions({ account: acct, items: [], quotes, contacts: [], effectiveDate }, today).now.filter((a) => a.kind === 'renewal');

describe('accounts from before renewal tracking keep the original reminder', () => {
  it('45 days before the effective date, until any market is bound, gone after the date', () => {
    expect(renewalTasks(account(), '2026-12-05')).toEqual([]); // 49 days out: not yet
    expect(renewalTasks(account(), '2026-12-01')).toHaveLength(1); // exactly 45 days out: starts
    expect(renewalTasks(account(), '2026-11-16').map((t) => [t.id, t.title, t.detail])).toEqual([['renewal-a1', 'Renewal effective Nov 16', '30 days out · not bound yet']]);
    expect(renewalTasks(account(), '2026-11-16', [quote('q1', 'bound')])).toEqual([]);
    expect(renewalTasks(account(), '2026-10-16')).toEqual([]);
  });
  it('a new venture’s effective date is not a renewal', () => {
    expect(renewalTasks(account({ businessType: 'new_venture' }), '2026-11-16')).toEqual([]);
  });
});

describe('tracked renewals', () => {
  const main: AccountRenewal = { id: 'm', main: true, status: 'open', leadDays: 60, createdAt: '', updatedAt: '' };
  const cargo: AccountRenewal = { id: 'c', renewalDate: '2026-11-01', label: 'Cargo', status: 'open', createdAt: '', updatedAt: '' };

  it('the main renewal follows the account’s effective date; work starts lead days before', () => {
    const [r] = resolveRenewals(account({ renewals: [main] }), '2026-12-10', []);
    expect(r).toMatchObject({ main: true, renewalDate: '2026-12-10', leadDays: 60, workStart: '2026-10-11' });
    expect(renewalPhase(r, TODAY)).toBe('working');
    expect(renewalPhase(r, '2026-10-10')).toBe('not_started');
  });
  it('binding one policy does not dismiss another renewal', () => {
    const acct = account({ renewals: [main, { ...cargo, status: 'bound', boundQuoteId: 'q2' }] });
    // Cargo bound for its own renewal; the main renewal still reminds.
    const tasks = renewalTasks(acct, '2026-12-10', [quote('q2', 'bound', 'c')]);
    expect(tasks.map((t) => t.id)).toEqual(['renewal-a1']);
    // A market bound without being tied to a renewal closes nothing.
    expect(renewalTasks(account({ renewals: [main, cargo] }), '2026-12-10', [quote('q3', 'bound')]).map((t) => t.id)).toEqual(['renewal-a1-c', 'renewal-a1']);
  });
  it('each renewal has its own task; the main one keeps the original id (a “done” mark carries over)', () => {
    const tasks = renewalTasks(account({ renewals: [main, cargo] }), '2026-12-10');
    expect(tasks.map((t) => [t.id, t.title])).toEqual([
      ['renewal-a1-c', 'Cargo renewal effective Nov 1'],
      ['renewal-a1', 'Renewal effective Dec 10'],
    ]);
    const legacyKey = actionDoneKey(renewalTasks(account(), '2026-11-16')[0]);
    const tracked = account({ renewals: [{ ...main, leadDays: undefined }], doneActions: { [legacyKey]: '2026-10-10T00:00:00Z' } });
    expect(renewalTasks(tracked, '2026-11-16')).toEqual([]);
  });
  it('past the renewal date and not bound: stays, marked overdue (the original reminder just vanished)', () => {
    const [t] = renewalTasks(account({ renewals: [cargo] }), null, [], '2026-11-05');
    expect(t).toMatchObject({ overdue: true, detail: '4 days past the renewal date · not bound yet' });
  });
  it('closed renewals and renewals without a date have no task', () => {
    expect(renewalTasks(account({ renewals: [{ ...cargo, status: 'not_renewing' }] }), null)).toEqual([]);
    expect(renewalTasks(account({ renewals: [main] }), null)).toEqual([]);
    expect(isRenewalDue(resolveRenewals(account({ renewals: [main] }), null, [])[0], TODAY)).toBe(false);
  });
  it('the soonest open renewal is the one shown on account cards', () => {
    expect(nextOpenRenewal(resolveRenewals(account({ renewals: [main, cargo] }), '2026-12-10', []))?.id).toBe('c');
  });
});

describe('changing renewals', () => {
  it('the main renewal is never added twice', () => {
    let list = addRenewal([], { main: true, leadDays: 45 }, clock());
    list = addRenewal(list, { main: true, leadDays: 30 }, clock());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ main: true, leadDays: 30, status: 'open' });
    expect(list[0].renewalDate).toBeUndefined();
  });
  it('the default lead time is not stored; a label can be cleared', () => {
    let list = addRenewal([], { renewalDate: '2027-03-01', leadDays: 45, label: ' Cargo ' }, clock());
    expect(list[0]).not.toHaveProperty('leadDays');
    expect(list[0].label).toBe('Cargo');
    list = updateRenewal(list, list[0].id, { leadDays: 90, label: '' }, 'later');
    expect(list[0]).toMatchObject({ leadDays: 90, updatedAt: 'later' });
    expect(list[0]).not.toHaveProperty('label');
  });
  it('closing the main renewal keeps the date it was for; reopening follows the account again', () => {
    let list = addRenewal([], { main: true }, clock());
    const id = list[0].id;
    list = closeRenewal(list, id, { status: 'bound', boundQuoteId: 'q1', date: '2026-11-16' }, 'now');
    expect(list[0]).toMatchObject({ status: 'bound', boundQuoteId: 'q1', renewalDate: '2026-11-16' });
    list = reopenRenewal(list, id, 'now');
    expect(list[0].status).toBe('open');
    expect(list[0]).not.toHaveProperty('renewalDate');
    expect(list[0]).not.toHaveProperty('boundQuoteId');
  });
  it('next year’s renewal is set up once, and the old one can’t reopen over it', () => {
    let list = addRenewal([], { main: true, leadDays: 60 }, clock());
    const first = list[0].id;
    list = closeRenewal(list, first, { status: 'bound', boundQuoteId: 'q1', date: '2026-11-16' }, 'now');
    const once = prepareNextRenewal(list, first, { renewalDate: '2027-11-16' }, clock());
    expect(once.created).toMatchObject({ main: true, status: 'open', previousRenewalId: first, leadDays: 60 });
    const twice = prepareNextRenewal(once.list, first, { renewalDate: '2027-11-16' }, clock());
    expect(twice.created).toBeUndefined();
    expect(twice.list).toHaveLength(2);
    expect(reopenRenewal(once.list, first, 'now')).toBe(once.list);
  });
  it('another policy’s next renewal carries its own date and label', () => {
    let list = addRenewal([], { renewalDate: '2027-03-01', label: 'Cargo' }, clock());
    list = closeRenewal(list, list[0].id, { status: 'bound', boundQuoteId: 'q9', date: '2027-03-01' }, 'now');
    expect(prepareNextRenewal(list, list[0].id, { renewalDate: '2028-03-01' }, clock()).created).toMatchObject({ renewalDate: '2028-03-01', label: 'Cargo' });
  });
});

describe('dates', () => {
  it('next year: same day; Feb 29 becomes Feb 28', () => {
    expect(addYears('2026-11-16', 1)).toBe('2027-11-16');
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2027-12-31', 1)).toBe('2028-12-31');
  });
  it('work start across year ends, leap days and daylight-saving changes', () => {
    const r = (date: string, leadDays: number) => resolveRenewals(account({ renewals: [{ id: 'x', renewalDate: date, leadDays, status: 'open', createdAt: '', updatedAt: '' }] }), null, [])[0].workStart;
    expect(r('2027-01-15', 45)).toBe('2026-12-01');
    expect(r('2028-03-15', 15)).toBe('2028-02-29');
    expect(r('2026-11-03', 3)).toBe('2026-10-31'); // US clocks change Nov 1
    expect(leadDaysFor('2026-11-03', '2026-10-31')).toBe(3);
    expect(leadDaysFor('2026-11-03', '2026-11-04')).toBeNull();
  });
  it('checks what was typed', () => {
    expect(checkRenewalInput({ renewalDate: '', startDate: '' })).toEqual(['Enter the renewal date.']);
    expect(checkRenewalInput({ renewalDate: '2026-02-30', startDate: '' })).toEqual(['The renewal date isn’t a valid date.']);
    expect(checkRenewalInput({ renewalDate: '2026-12-01', startDate: '2026-12-02' })).toEqual(['Start working on or before the renewal date.']);
    expect(checkRenewalInput({ renewalDate: '2027-12-01', startDate: '2026-11-01' })).toEqual(['Start no more than a year before the renewal date.']);
    expect(checkRenewalInput({ renewalDate: '2026-12-01', startDate: '2026-10-17' })).toEqual([]);
  });
  it('a saved lead time out of range is clamped', () => {
    const [r] = resolveRenewals(account({ renewals: [{ id: 'x', renewalDate: '2026-12-01', leadDays: 9999, status: 'open', createdAt: '', updatedAt: '' }] }), null, []);
    expect(r.leadDays).toBe(365);
  });
  it('malformed saved renewals are left out when loading', () => {
    expect(([{ id: 'a', status: 'open', main: true }, { id: 'b', status: 'open' }, { id: 'c', status: 'weird', renewalDate: '2026-01-01' }, null] as unknown[]).filter(isRenewalRecord).map((r) => r.id)).toEqual(['a']);
  });
});

describe('who works on it', () => {
  const acct = { assignedUserId: 'roman' };
  it('the assigned broker and admins; not someone only helping', () => {
    expect(canManageRenewals(acct, { role: 'agent', userId: 'roman' })).toBe(true);
    expect(canManageRenewals(acct, { role: 'agent', userId: 'helper' })).toBe(false);
    expect(canManageRenewals(acct, { role: 'admin', userId: 'admin1' })).toBe(true);
    expect(canManageRenewals({ assignedUserId: null }, { role: 'agent', userId: 'roman', ownerId: 'roman' })).toBe(true);
    expect(canManageRenewals(acct, { role: null, userId: null })).toBe(true);
  });
  it('reminders go to the assigned broker; admins see all', () => {
    expect(receivesRenewalReminders(acct, { role: 'agent', userId: 'helper' })).toBe(false);
    expect(receivesRenewalReminders(acct, { role: 'admin', userId: 'admin1' })).toBe(true);
  });
  it('task ids', () => {
    expect(renewalTaskId('a1', { id: 'm', main: true })).toBe('renewal-a1');
    expect(renewalTaskId('a1', { id: 'c', main: false })).toBe('renewal-a1-c');
  });
});
