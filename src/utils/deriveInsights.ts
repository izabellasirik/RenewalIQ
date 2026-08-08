import type { DriverEntry, DriverScheduleSummary, LossEntry, LossSummary, VehicleEntry, VehicleScheduleSummary } from '../types';

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function ageFromDob(dob: string, asOf: Date = new Date()): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  let age = asOf.getFullYear() - d.getFullYear();
  const hadBirthdayThisYear = asOf.getMonth() > d.getMonth() || (asOf.getMonth() === d.getMonth() && asOf.getDate() >= d.getDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

/** Rolls up an itemized vehicle schedule into fleet-level insurance facts. Pure — recompute whenever profile.vehicles changes. */
export function deriveVehicleSummary(vehicles: VehicleEntry[]): VehicleScheduleSummary {
  const currentYear = new Date().getFullYear();
  const ages = vehicles.map((v) => (v.year ? currentYear - v.year : null)).filter((a): a is number => a !== null);
  const values = vehicles.map((v) => v.value).filter((v): v is number => v !== undefined);
  const withYear = vehicles.filter((v): v is VehicleEntry & { year: number } => v.year !== undefined);

  // Only from an explicit body-type column — never guessed from make/model.
  const vehicleTypes = Array.from(new Set(vehicles.map((v) => v.bodyType).filter((t): t is string => !!t)));
  const manufacturers = Array.from(new Set(vehicles.map((v) => v.make).filter((m): m is string => !!m)));

  const oldest = withYear.reduce<(VehicleEntry & { year: number }) | null>((min, v) => (!min || v.year < min.year ? v : min), null);
  const newest = withYear.reduce<(VehicleEntry & { year: number }) | null>((max, v) => (!max || v.year > max.year ? v : max), null);

  return {
    totalVehicleCount: vehicles.length,
    vehicleTypes,
    averageVehicleAge: average(ages),
    totalInsuredValue: values.length > 0 ? values.reduce((sum, v) => sum + v, 0) : null,
    manufacturers,
    oldestVehicle: oldest ? { year: oldest.year, make: oldest.make, model: oldest.model } : null,
    newestVehicle: newest ? { year: newest.year, make: newest.make, model: newest.model } : null,
  };
}

/** Rolls up an itemized driver schedule into fleet-level insurance facts. Pure — recompute whenever profile.drivers changes. */
export function deriveDriverSummary(drivers: DriverEntry[]): DriverScheduleSummary {
  const ages = drivers.map((d) => (d.dob ? ageFromDob(d.dob) : null)).filter((a): a is number => a !== null);
  const experience = drivers.map((d) => d.yearsExperience).filter((e): e is number => e !== undefined);

  const withViolations = drivers.filter((d) => d.violations && d.violations.trim().toLowerCase() !== 'none' && d.violations.trim() !== '');

  return {
    driverCount: drivers.length,
    minDriverAge: ages.length > 0 ? Math.min(...ages) : null,
    averageDriverAge: average(ages),
    minExperience: experience.length > 0 ? Math.min(...experience) : null,
    averageExperience: average(experience),
    violations: {
      driversWithViolations: withViolations.length,
      totalDrivers: drivers.length,
      details: withViolations.map((d) => `${d.name ?? 'Unnamed driver'}: ${d.violations}`),
    },
  };
}

/** Rolls up itemized loss history into underwriting-facing facts, including a simple recency trend. Pure — recompute whenever profile.lossHistory changes. */
export function deriveLossSummary(lossHistory: LossEntry[]): LossSummary {
  const totalPaid = lossHistory.reduce((sum, l) => sum + l.paid, 0);
  const totalReserved = lossHistory.reduce((sum, l) => sum + l.reserved, 0);
  const totalIncurred = lossHistory.reduce((sum, l) => sum + l.incurred, 0);

  const largest = lossHistory.reduce<LossEntry | null>((max, l) => (!max || l.incurred > max.incurred ? l : max), null);

  const sorted = [...lossHistory].sort((a, b) => (a.lossDate < b.lossDate ? -1 : 1));
  let trend: LossSummary['trend'] = 'insufficient_data';
  let trendDescription = 'Not enough claims to establish a trend.';
  if (sorted.length >= 2) {
    const mid = Math.ceil(sorted.length / 2);
    const older = sorted.slice(0, mid);
    const newer = sorted.slice(mid);
    if (older.length > 0 && newer.length > 0) {
      const olderAvg = average(older.map((l) => l.incurred)) ?? 0;
      const newerAvg = average(newer.map((l) => l.incurred)) ?? 0;
      if (olderAvg === 0 && newerAvg === 0) {
        trend = 'stable';
        trendDescription = 'Average incurred per claim has stayed flat across this loss history.';
      } else {
        const change = olderAvg === 0 ? 1 : (newerAvg - olderAvg) / olderAvg;
        if (change > 0.15) {
          trend = 'increasing';
          trendDescription = `Average incurred per claim is up ${Math.round(change * 100)}% in the more recent half of this loss history.`;
        } else if (change < -0.15) {
          trend = 'decreasing';
          trendDescription = `Average incurred per claim is down ${Math.round(Math.abs(change) * 100)}% in the more recent half of this loss history.`;
        } else {
          trend = 'stable';
          trendDescription = 'Average incurred per claim has stayed roughly flat across this loss history.';
        }
      }
    }
  }

  return {
    totalClaims: lossHistory.length,
    openClaims: lossHistory.filter((l) => l.status === 'open').length,
    closedClaims: lossHistory.filter((l) => l.status === 'closed').length,
    totalPaid,
    totalReserved,
    totalIncurred,
    largestLoss: largest ? { amount: largest.incurred, claimType: largest.claimType, lossDate: largest.lossDate } : null,
    trend,
    trendDescription,
  };
}
