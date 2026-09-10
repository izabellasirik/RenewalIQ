import { RISK_PROFILE_GROUPS } from '../pages/riskProfileFieldConfig';
import { COVERAGE_LABELS, type CoverageType } from '../types';
import type { FieldValueType } from '../components/riskProfile/FieldRow';

const SCALAR_LABELS: Record<string, string> = {};
const SCALAR_TYPES: Record<string, FieldValueType> = {};
for (const group of RISK_PROFILE_GROUPS) {
  for (const field of group.fields) {
    SCALAR_LABELS[`${field.section}.${field.key}`] = field.label;
    SCALAR_TYPES[`${field.section}.${field.key}`] = field.type;
  }
}
// Derived fields not in the editable form config but still real scalar paths.
SCALAR_LABELS['business.city'] = 'City';
SCALAR_LABELS['business.zip'] = 'ZIP';

/** Human-readable label for any ExtractedFieldResult.fieldPath — the same vocabulary the Risk Profile page itself uses, so "View extracted data" never shows a raw dotted path to a broker. */
export function fieldPathLabel(fieldPath: string): string {
  if (fieldPath === 'coverageLine') return 'Desired Coverage Line';
  if (fieldPath === 'drivers') return 'Driver';
  if (fieldPath === 'vehicles') return 'Vehicle';
  if (fieldPath === 'lossHistory') return 'Loss/Claim';

  if (fieldPath.startsWith('coverage.')) {
    const [, coverageType, sub] = fieldPath.split('.') as [string, CoverageType, string];
    const coverageLabel = COVERAGE_LABELS[coverageType] ?? coverageType;
    const subLabel = sub === 'currentLimit' ? 'Current Limit' : 'Requested Limit';
    return `${coverageLabel} — ${subLabel}`;
  }

  return SCALAR_LABELS[fieldPath] ?? fieldPath;
}

/** The input type to render when editing any editable scalar fieldPath (business.___, transportation.___, or coverage.___) inline — e.g. from the per-document "Extracted Data" panel. Coverage limits are always free text; everything else matches the same type the main Risk Profile form uses for that field, so editing a field from either place behaves identically. */
export function fieldPathValueType(fieldPath: string): FieldValueType {
  if (fieldPath.startsWith('coverage.')) return 'text';
  return SCALAR_TYPES[fieldPath] ?? 'text';
}

export const DRIVER_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  address: 'Address',
  dob: 'Date of Birth',
  licenseState: 'License State',
  licenseNumber: 'License Number',
  licenseClass: 'License Class',
  isCDL: 'CDL',
  issueDate: 'Issue Date',
  expirationDate: 'Expiration Date',
  restrictions: 'Restrictions',
  endorsements: 'Endorsements',
  yearsExperience: 'Years Experience',
  violations: 'Violations',
};

export const VEHICLE_FIELD_LABELS: Record<string, string> = {
  vin: 'VIN',
  make: 'Make',
  model: 'Model',
  year: 'Year',
  plate: 'Plate',
  value: 'Value',
  bodyType: 'Body Type',
};

export const LOSS_FIELD_LABELS: Record<string, string> = {
  lossDate: 'Loss Date',
  claimType: 'Claim Type',
  paid: 'Paid',
  reserved: 'Reserved',
  incurred: 'Incurred',
  status: 'Status',
};
