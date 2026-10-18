import type { Account, DocumentRequest, MarketQuote, MissingItem } from '../../../types';
import type { MatchCandidateInput } from '../matchAccount';
import { getAccountContacts } from '../../workflow/contacts';
import type { AccountContext } from '../reviewEmail';

/** Synthetic accounts in two agencies — no real customer data. */
export const AGENCY_A = 'agency-a';
export const AGENCY_B = 'agency-b';
export const TODAY = '2026-10-16';
const T = '2026-10-01T12:00:00.000Z';

function account(id: string, namedInsured: string, agencyId: string, contacts: Account['contacts']): Account {
  return { id, namedInsured, state: 'TX', createdAt: T, updatedAt: T, status: 'new', archived: false, agencyId, contacts };
}

export const northwind = account('acct-northwind', 'Northwind Freight LLC', AGENCY_A, [
  { id: 'c-dana', name: 'Dana Reyes', email: 'dana@northwindfreight.example', primary: true },
]);
export const abc = account('acct-abc', 'ABC Trucking', AGENCY_A, [{ id: 'c-sam', name: 'Sam Ortiz', email: 'sam@abctrucking.example', primary: true }]);
export const abcExpress = account('acct-abcx', 'ABC Trucking Express', AGENCY_A, [{ id: 'c-lee', name: 'Lee Park', email: 'lee@abcexpress.example', primary: true }]);
export const owensHauling = account('acct-owens-h', 'Owens Hauling', AGENCY_A, [{ id: 'c-pat1', name: 'Pat Owens', email: 'pat@owensholdings.example', primary: true }]);
export const owensCold = account('acct-owens-c', 'Owens Cold Chain', AGENCY_A, [{ id: 'c-pat2', name: 'Pat Owens', email: 'Pat@OwensHoldings.example', primary: true }]);
export const noEmail = account('acct-noemail', 'Mesa Ridge Haulers', AGENCY_A, [{ id: 'c-phone', name: 'Kim Vo', phone: '555-0100', primary: true }]);
/** Another agency's account with a near-identical name — must never be matched or changed. */
export const otherAgencyNorthwind = account('acct-b-northwind', 'Northwind Freight Inc', AGENCY_B, [{ id: 'c-b', name: 'Other Agency Contact', email: 'contact@other-agency-client.example', primary: true }]);

export const DOTS: Record<string, string> = {
  'acct-northwind': '3141592',
  'acct-abc': '2000001',
  'acct-abcx': '2000002',
  'acct-b-northwind': '9999999',
};

export const QUOTES: Record<string, MarketQuote[]> = {
  'acct-northwind': [
    { id: 'q-granite', accountId: 'acct-northwind', marketName: 'Granite Mutual', status: 'submitted', notes: [], createdAt: T, updatedAt: T },
    { id: 'q-bluepeak', accountId: 'acct-northwind', marketName: 'Bluepeak Specialty', status: 'submitted', notes: [], createdAt: T, updatedAt: T },
  ],
};

export function northwindItems(): MissingItem[] {
  return [
    { id: 'i-loss', accountId: 'acct-northwind', type: 'document', label: 'Loss Runs', status: 'requested', templateKey: 'loss_runs', requestedAt: '2026-10-06T15:00:00.000Z', requestedFromContactId: 'c-dana', followUpDate: '2026-10-13', createdAt: T, updatedAt: T },
    { id: 'i-app', accountId: 'acct-northwind', type: 'document', label: 'Application', status: 'received', templateKey: 'application', receivedAt: '2026-10-02T15:00:00.000Z', verification: 'verified', createdAt: T, updatedAt: T },
    { id: 'i-mvr-jp', accountId: 'acct-northwind', type: 'document', label: 'MVR — Jordan Pike', status: 'missing', createdAt: T, updatedAt: T },
  ];
}

export function northwindRequests(): DocumentRequest[] {
  return [
    {
      id: 'req-1',
      accountId: 'acct-northwind',
      token: '11111111-2222-4333-8444-555555555555',
      contactId: 'c-dana',
      contactName: 'Dana Reyes',
      contactEmail: 'dana@northwindfreight.example',
      channel: 'email',
      status: 'waiting',
      deliveryStatus: 'sent',
      sentAt: '2026-10-06T15:00:00.000Z',
      requestedAt: '2026-10-06T15:00:00.000Z',
      followUpCount: 0,
      nextFollowUp: '2026-10-13',
      expiresAt: '2026-12-01T00:00:00.000Z',
      items: [{ id: 'ri-1', missingItemId: 'i-loss', label: 'Loss Runs', status: 'requested', position: 0 }],
      files: [],
    },
  ];
}

export const ALL_ACCOUNTS = [northwind, abc, abcExpress, owensHauling, owensCold, noEmail, otherAgencyNorthwind];

export function candidates(accounts = ALL_ACCOUNTS): MatchCandidateInput[] {
  return accounts.map((a) => ({ account: a, contacts: getAccountContacts(a), dotNumber: DOTS[a.id] ?? null, mcNumber: null, marketNames: (QUOTES[a.id] ?? []).map((q) => q.marketName) }));
}

export function contextFor(acc: Account, over: Partial<AccountContext> = {}): AccountContext {
  return {
    account: acc,
    items: acc.id === 'acct-northwind' ? northwindItems() : [],
    quotes: QUOTES[acc.id] ?? [],
    contacts: getAccountContacts(acc),
    requests: acc.id === 'acct-northwind' ? northwindRequests() : [],
    effectiveDate: '2026-11-01',
    ...over,
  };
}

let tokenSeq = 0;
export const newToken = () => `00000000-0000-4000-8000-${String(++tokenSeq).padStart(12, '0')}`;
export const linkFor = (token: string) => `https://app.synthetic.example/r/${token}`;
