import type { FieldValueType } from '../components/riskProfile/FieldRow';

export type ProfileSection = 'business' | 'transportation';

export interface RiskFieldConfig {
  key: string;
  label: string;
  type: FieldValueType;
  section: ProfileSection;
  /** Why this field matters — shown on the Review page for missing fields. */
  hint?: string;
}

export interface RiskFieldGroup {
  key: string;
  title: string;
  description?: string;
  fields: RiskFieldConfig[];
}

export const RISK_PROFILE_GROUPS: RiskFieldGroup[] = [
  {
    key: 'business',
    title: 'Business Information',
    fields: [
      { key: 'namedInsured', label: 'Named Insured', type: 'text', section: 'business' },
      { key: 'legalEntity', label: 'Legal Entity', type: 'text', section: 'business' },
      { key: 'address', label: 'Address', type: 'textarea', section: 'business' },
      { key: 'city', label: 'City', type: 'text', section: 'business' },
      { key: 'state', label: 'State', type: 'text', section: 'business' },
      { key: 'zip', label: 'ZIP', type: 'text', section: 'business' },
      { key: 'yearsInBusiness', label: 'Years in Business', type: 'number', section: 'business' },
      { key: 'annualRevenue', label: 'Annual Revenue', type: 'number', section: 'business', hint: 'Used for GL rating and required by most carrier appetite checks.' },
    ],
  },
  {
    key: 'operations',
    title: 'Operations',
    fields: [
      { key: 'descriptionOfOperations', label: 'Description of Operations', type: 'textarea', section: 'business' },
      { key: 'dotNumber', label: 'DOT Number', type: 'text', section: 'transportation' },
      { key: 'mcNumber', label: 'MC Number', type: 'text', section: 'transportation' },
      { key: 'statesOfOperation', label: 'States of Operation', type: 'list', section: 'transportation' },
      { key: 'operatingRadius', label: 'Operating Radius', type: 'text', section: 'transportation' },
      { key: 'commoditiesHauled', label: 'Commodities Hauled', type: 'list', section: 'transportation' },
    ],
  },
  {
    key: 'fleet',
    title: 'Fleet',
    fields: [
      { key: 'fleetSize', label: 'Fleet Size (Power Units)', type: 'number', section: 'transportation' },
      { key: 'vehicleTypes', label: 'Vehicle Types', type: 'list', section: 'transportation' },
    ],
  },
  {
    key: 'drivers',
    title: 'Drivers & Safety',
    fields: [
      { key: 'driverCount', label: 'Driver Count', type: 'number', section: 'transportation' },
      { key: 'minDriverAge', label: 'Minimum Driver Age', type: 'number', section: 'transportation' },
      { key: 'minDriverExperienceYears', label: 'Minimum Driver Experience (yrs)', type: 'number', section: 'transportation' },
      { key: 'telematics', label: 'Telematics', type: 'boolean', section: 'transportation' },
      { key: 'dashcams', label: 'Dashcams', type: 'boolean', section: 'transportation', hint: 'Several markets require dashcams — confirm with the account.' },
    ],
  },
];
