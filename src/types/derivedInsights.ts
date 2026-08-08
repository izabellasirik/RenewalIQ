/**
 * Computed rollups over the itemized RiskProfile arrays (vehicles/drivers/lossHistory) — never
 * stored, always recomputed live from whatever rows currently exist, so they can't drift out of
 * sync with the underlying data and never need their own conflict-merge logic.
 */

export interface VehicleScheduleSummary {
  totalVehicleCount: number;
  /** Distinct "Make Model" combinations, e.g. "Freightliner Cascadia". */
  vehicleTypes: string[];
  /** Current-year minus model year, averaged across vehicles with a known year. Undefined if no vehicle has a year. */
  averageVehicleAge: number | null;
  /** Sum of every vehicle's stated value. Null if no vehicle has a value. */
  totalInsuredValue: number | null;
  manufacturers: string[];
}

export interface ViolationsSummary {
  driversWithViolations: number;
  totalDrivers: number;
  details: string[];
}

export interface DriverScheduleSummary {
  driverCount: number;
  minDriverAge: number | null;
  averageDriverAge: number | null;
  minExperience: number | null;
  averageExperience: number | null;
  violations: ViolationsSummary;
}

export type LossTrend = 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';

export interface LossSummary {
  totalClaims: number;
  openClaims: number;
  closedClaims: number;
  totalPaid: number;
  totalReserved: number;
  totalIncurred: number;
  largestLoss: { amount: number; claimType: string; lossDate: string } | null;
  trend: LossTrend;
  /** Human-readable explanation of the trend verdict, e.g. "Average incurred per claim is up 40% in the more recent half of this loss history." */
  trendDescription: string;
}
