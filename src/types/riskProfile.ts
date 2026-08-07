import type { BusinessInfo } from './business';
import type { TransportationInfo } from './transportation';
import type { LossEntry } from './loss';
import type { CoverageLine } from './coverage';

export interface RiskProfile {
  id: string;
  accountId: string;
  business: BusinessInfo;
  transportation: TransportationInfo;
  lossHistory: LossEntry[];
  coverage: CoverageLine[];
  updatedAt: string;
}

/** A flattened pointer to any FieldValue-bearing field in the profile, used by the UI to render/edit generically. */
export type RiskProfileSection = 'business' | 'transportation';
