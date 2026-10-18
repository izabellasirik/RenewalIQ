import { describe, expect, it } from 'vitest';
import { aBoolean, aString, defined, loadPreferences, oneOf, preferenceKey, savePreferences, type PreferenceStore } from '../viewPreferences';
import { ALL_BROKERS, ASSIGNED_TO_ME, UNASSIGNED, matchesBroker } from '../../workflow/brokerFilter';

const memory = (): PreferenceStore & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), m };
};
interface View {
  stage: 'all' | 'quoted' | 'bound';
  broker: string;
  renewalSoon: boolean;
}
const DEFAULTS: View = { stage: 'all', broker: ALL_BROKERS, renewalSoon: false };
const sanitize = (s: Record<string, unknown>) => defined<View>({ stage: oneOf(['all', 'quoted', 'bound'] as const)(s.stage), broker: aString(s.broker), renewalSoon: aBoolean(s.renewalSoon) });

describe('remembered view settings', () => {
  it('saves only what differs from the defaults and reads it back', () => {
    const s = memory();
    savePreferences('accounts', 'user-a', { ...DEFAULTS, stage: 'quoted', renewalSoon: true }, DEFAULTS, s);
    expect(JSON.parse(s.m.get(preferenceKey('accounts', 'user-a'))!)).toEqual({ stage: 'quoted', renewalSoon: true });
    expect(loadPreferences('accounts', 'user-a', DEFAULTS, sanitize, s)).toEqual({ stage: 'quoted', broker: ALL_BROKERS, renewalSoon: true });
  });
  it('each user on the device has their own; signed out has its own too', () => {
    const s = memory();
    savePreferences('accounts', 'user-a', { ...DEFAULTS, stage: 'bound' }, DEFAULTS, s);
    expect(loadPreferences('accounts', 'user-b', DEFAULTS, sanitize, s)).toEqual(DEFAULTS);
    expect(loadPreferences('accounts', null, DEFAULTS, sanitize, s)).toEqual(DEFAULTS);
    expect(preferenceKey('accounts', null)).toBe('renewaliq.view.v1.local.accounts');
  });
  it('going back to the defaults removes the saved entry', () => {
    const s = memory();
    savePreferences('accounts', 'user-a', { ...DEFAULTS, stage: 'bound' }, DEFAULTS, s);
    savePreferences('accounts', 'user-a', DEFAULTS, DEFAULTS, s);
    expect(s.m.size).toBe(0);
  });
  it('broken or outdated saved values fall back to the defaults, one by one', () => {
    const s = memory();
    s.setItem(preferenceKey('accounts', 'u'), '{not json');
    expect(loadPreferences('accounts', 'u', DEFAULTS, sanitize, s)).toEqual(DEFAULTS);
    s.setItem(preferenceKey('accounts', 'u'), JSON.stringify({ stage: 'no-such-stage', broker: 42, renewalSoon: true, extra: 'x' }));
    expect(loadPreferences('accounts', 'u', DEFAULTS, sanitize, s)).toEqual({ ...DEFAULTS, renewalSoon: true });
    s.setItem(preferenceKey('accounts', 'u'), '[1,2]');
    expect(loadPreferences('accounts', 'u', DEFAULTS, sanitize, s)).toEqual(DEFAULTS);
  });
  it('no usable storage: defaults, and saving does nothing', () => {
    expect(loadPreferences('accounts', 'u', DEFAULTS, sanitize, null)).toEqual(DEFAULTS);
    expect(() => savePreferences('accounts', 'u', DEFAULTS, DEFAULTS, null)).not.toThrow();
    const throwing: PreferenceStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
    expect(loadPreferences('accounts', 'u', DEFAULTS, sanitize, throwing)).toEqual(DEFAULTS);
    expect(() => savePreferences('accounts', 'u', { ...DEFAULTS, stage: 'bound' }, DEFAULTS, throwing)).not.toThrow();
  });
});

describe('broker filter (same rule on Accounts and Today’s Plate)', () => {
  const acct = (assignedUserId: string | null, collaboratorIds: string[] = [], name?: string) => ({ assignedUserId, collaboratorIds, assignedBroker: name ? { name } : undefined });
  it('in an agency: assigned or collaborating; Unassigned; All', () => {
    const ctx = { byAgent: true };
    expect(matchesBroker(acct('u1'), 'u1', ctx)).toBe(true);
    expect(matchesBroker(acct('u2', ['u1']), 'u1', ctx)).toBe(true);
    expect(matchesBroker(acct('u2'), 'u1', ctx)).toBe(false);
    expect(matchesBroker(acct(null), UNASSIGNED, ctx)).toBe(true);
    expect(matchesBroker(acct('u2'), ALL_BROKERS, ctx)).toBe(true);
  });
  it('“Assigned to me” keeps the earlier checkbox’s meaning: assigned only, not collaborating', () => {
    expect(matchesBroker(acct('me'), ASSIGNED_TO_ME, { byAgent: true, myUserId: 'me' })).toBe(true);
    expect(matchesBroker(acct('u2', ['me']), ASSIGNED_TO_ME, { byAgent: true, myUserId: 'me' })).toBe(false);
    expect(matchesBroker(acct('me'), ASSIGNED_TO_ME, { byAgent: true, myUserId: null })).toBe(false);
  });
  it('outside an agency: by assigned name, case-insensitively', () => {
    expect(matchesBroker(acct(null, [], ' Roman '), 'roman', { byAgent: false })).toBe(true);
    expect(matchesBroker(acct(null, [], 'Sara'), 'roman', { byAgent: false })).toBe(false);
    expect(matchesBroker(acct(null), UNASSIGNED, { byAgent: false })).toBe(true);
  });
});
