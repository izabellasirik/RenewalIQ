import type { Account } from '../types';

export const SAMPLE_ACCOUNT_ID = 'acct_abc_transportation';

export const sampleAccount: Account = {
  id: SAMPLE_ACCOUNT_ID,
  namedInsured: 'ABC Transportation LLC',
  state: 'TX',
  createdAt: '2026-07-28T14:00:00.000Z',
  updatedAt: '2026-07-28T14:00:00.000Z',
  status: 'new',
  archived: false,
};
