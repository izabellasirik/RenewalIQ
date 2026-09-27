import type { DriverEntry, LossEntry, VehicleEntry } from '../../types';
import { isDuration, toMonths } from '../../utils/duration';

/**
 * Risk Profile rows ⇄ database rows (vehicles / drivers / losses). Fields with their own column
 * (0003, 0010) go there; EVERY other field goes in the row's `details` jsonb (0024), so nothing a
 * broker edits is dropped on the next load. Adding a field to DriverEntry etc. needs no change here.
 */

type Row = Record<string, unknown>;
type Source = { documentId: string; documentName: string; page?: number; excerpt?: string };

function sourceColumns(source: Source | undefined) {
  return { source_document_id: source?.documentId ?? null, source_page: source?.page ?? null, source_excerpt: source?.excerpt ?? null };
}
function sourceFrom(r: Row): Source | undefined {
  return r.source_document_id ? { documentId: r.source_document_id as string, documentName: '', page: (r.source_page as number | null) ?? undefined, excerpt: (r.source_excerpt as string | null) ?? undefined } : undefined;
}
const details = (r: Row) => (r.details && typeof r.details === 'object' && !Array.isArray(r.details) ? (r.details as Row) : {});

export function driverToRow(d: DriverEntry, submissionId: string, userId: string): Row {
  const { id, name, dob, licenseState, yearsExperience, violations, isManual, lastUpdatedAt, source, ...rest } = d;
  const months = toMonths(yearsExperience);
  return {
    id,
    submission_id: submissionId,
    user_id: userId,
    name: name ?? null,
    dob: dob ?? null,
    license_state: licenseState ?? null,
    // int column: whole years for older readers; the exact months go in 0010's columns.
    years_experience: months === null ? null : Math.floor(months / 12),
    experience_months: months,
    experience_or_more: months === null ? null : isDuration(yearsExperience) ? !!yearsExperience.orMore : false,
    violations: violations ?? null,
    is_manual: !!isManual,
    ...sourceColumns(source),
    last_updated_at: lastUpdatedAt ?? null,
    details: rest,
  };
}

export function driverFromRow(r: Row): DriverEntry {
  return {
    ...(details(r) as Partial<DriverEntry>),
    id: r.id as string,
    name: (r.name as string | null) ?? undefined,
    dob: (r.dob as string | null) ?? undefined,
    licenseState: (r.license_state as string | null) ?? undefined,
    // 0010's experience_months (exact) when present; otherwise the legacy whole-years int.
    yearsExperience:
      r.experience_months != null
        ? r.experience_or_more
          ? { months: r.experience_months as number, orMore: true }
          : { months: r.experience_months as number }
        : ((r.years_experience as number | null) ?? undefined),
    violations: (r.violations as string | null) ?? undefined,
    isManual: r.is_manual as boolean,
    lastUpdatedAt: (r.last_updated_at as string | null) ?? undefined,
    source: sourceFrom(r),
  };
}

export function vehicleToRow(v: VehicleEntry, submissionId: string, userId: string): Row {
  const { id, vin, make, model, year, value, bodyType, isManual, lastUpdatedAt, source, ...rest } = v;
  return {
    id,
    submission_id: submissionId,
    user_id: userId,
    vin: vin ?? null,
    make: make ?? null,
    model: model ?? null,
    year: year ?? null,
    value: value ?? null,
    body_type: bodyType ?? null,
    is_manual: !!isManual,
    ...sourceColumns(source),
    last_updated_at: lastUpdatedAt ?? null,
    details: rest,
  };
}

export function vehicleFromRow(r: Row): VehicleEntry {
  return {
    ...(details(r) as Partial<VehicleEntry>),
    id: r.id as string,
    vin: (r.vin as string | null) ?? undefined,
    make: (r.make as string | null) ?? undefined,
    model: (r.model as string | null) ?? undefined,
    year: (r.year as number | null) ?? undefined,
    value: (r.value as number | null) ?? undefined,
    bodyType: (r.body_type as string | null) ?? undefined,
    isManual: r.is_manual as boolean,
    lastUpdatedAt: (r.last_updated_at as string | null) ?? undefined,
    source: sourceFrom(r),
  };
}

export function lossToRow(l: LossEntry, submissionId: string, userId: string): Row {
  const { id, lossDate, claimType, paid, reserved, incurred, status, isManual, lastUpdatedAt, source, ...rest } = l;
  return {
    id,
    submission_id: submissionId,
    user_id: userId,
    loss_date: lossDate,
    claim_type: claimType,
    paid,
    reserved,
    incurred,
    status,
    is_manual: !!isManual,
    ...sourceColumns(source),
    last_updated_at: lastUpdatedAt ?? null,
    details: rest,
  };
}

export function lossFromRow(r: Row): LossEntry {
  return {
    ...(details(r) as Partial<LossEntry>),
    id: r.id as string,
    lossDate: r.loss_date as string,
    claimType: r.claim_type as string,
    paid: Number(r.paid),
    reserved: Number(r.reserved),
    incurred: Number(r.incurred),
    status: r.status as LossEntry['status'],
    isManual: r.is_manual as boolean,
    lastUpdatedAt: (r.last_updated_at as string | null) ?? undefined,
    source: sourceFrom(r),
  };
}

/** A row without its `details` — for a database where 0024 hasn't been applied yet. */
export function withoutDetails(row: Row): Row {
  const { details: _d, ...rest } = row;
  return rest;
}
