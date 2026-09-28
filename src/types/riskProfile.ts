import type { BusinessInfo } from './business';
import type { TransportationInfo } from './transportation';
import type { LossEntry } from './loss';
import type { CoverageLine } from './coverage';
import type { VehicleEntry } from './vehicle';
import type { DriverEntry } from './driver';

export interface RiskProfile {
  id: string;
  accountId: string;
  business: BusinessInfo;
  transportation: TransportationInfo;
  lossHistory: LossEntry[];
  coverage: CoverageLine[];
  /** Itemized fleet, e.g. from a vehicle schedule spreadsheet. Distinct from transportation.fleetSize/vehicleTypes, which are broker-editable summary fields that may be entered independently of any itemized schedule. */
  vehicles: VehicleEntry[];
  /** Itemized drivers, e.g. from a driver schedule spreadsheet. */
  drivers: DriverEntry[];
  updatedAt: string;
  /**
   * Loss-run records just read from a document, waiting to become the account's LossRun records
   * (see settleLossRuns). Transient — never saved; settled as soon as the extraction is merged.
   */
  pendingLossRuns?: import('../services/extraction/fieldExtraction/lossRunPatterns').LossRunDraft[];
}

/** A flattened pointer to any FieldValue-bearing field in the profile, used by the UI to render/edit generically. */
export type RiskProfileSection = 'business' | 'transportation';
