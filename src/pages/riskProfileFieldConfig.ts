import type { FieldValueType } from '../components/riskProfile/FieldRow';

export const BUSINESS_FIELDS: { key: string; label: string; type: FieldValueType }[] = [
  { key: 'namedInsured', label: 'Named Insured', type: 'text' },
  { key: 'legalEntity', label: 'Legal Entity', type: 'text' },
  { key: 'address', label: 'Address', type: 'textarea' },
  { key: 'state', label: 'State', type: 'text' },
  { key: 'yearsInBusiness', label: 'Years in Business', type: 'number' },
  { key: 'annualRevenue', label: 'Annual Revenue', type: 'number' },
  { key: 'descriptionOfOperations', label: 'Description of Operations', type: 'textarea' },
];

export const TRANSPORTATION_FIELDS: { key: string; label: string; type: FieldValueType }[] = [
  { key: 'dotNumber', label: 'DOT Number', type: 'text' },
  { key: 'mcNumber', label: 'MC Number', type: 'text' },
  { key: 'fleetSize', label: 'Fleet Size (Power Units)', type: 'number' },
  { key: 'vehicleTypes', label: 'Vehicle Types', type: 'list' },
  { key: 'operatingRadius', label: 'Operating Radius', type: 'text' },
  { key: 'statesOfOperation', label: 'States of Operation', type: 'list' },
  { key: 'commoditiesHauled', label: 'Commodities Hauled', type: 'list' },
  { key: 'driverCount', label: 'Driver Count', type: 'number' },
  { key: 'minDriverAge', label: 'Minimum Driver Age', type: 'number' },
  { key: 'minDriverExperienceYears', label: 'Minimum Driver Experience (yrs)', type: 'number' },
  { key: 'telematics', label: 'Telematics', type: 'boolean' },
  { key: 'dashcams', label: 'Dashcams', type: 'boolean' },
];
