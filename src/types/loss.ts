import type { FieldSource } from './common';

export type LossStatus = 'open' | 'closed';

export interface LossEntry {
  id: string;
  lossDate: string;
  claimType: string;
  paid: number;
  reserved: number;
  incurred: number;
  status: LossStatus;
  source: FieldSource;
}
