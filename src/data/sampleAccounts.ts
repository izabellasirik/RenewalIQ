import type { Account } from '../types';

export const SAMPLE_ACCOUNT_ID = 'acct_summit_freight';

export const sampleAccount: Account = {
  id: SAMPLE_ACCOUNT_ID,
  namedInsured: 'Summit Freight Logistics LLC',
  state: 'OH',
  createdAt: '2026-07-28T14:00:00.000Z',
  updatedAt: '2026-07-28T14:00:00.000Z',
  status: 'new',
};
