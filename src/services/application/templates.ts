import type { ApplicationTemplate, DriverEntry, LossEntry, VehicleEntry } from '../../types';
import { COVERAGE_LABELS } from '../../types';
import { formatCurrency, formatDateMDY, formatNewVenture, formatStatus } from './formatters';

const CURRENT_POLICY_COVERAGE_TYPES = ['auto_liability', 'motor_truck_cargo', 'physical_damage', 'general_liability'] as const;
const REQUESTED_COVERAGE_TYPES = ['auto_liability', 'motor_truck_cargo', 'physical_damage', 'general_liability', 'warehouse_legal_liability'] as const;

/**
 * One realistic, comprehensive transportation application template for MVP testing — per product
 * direction, not "dozens of carrier applications" yet. Fields with no Risk Profile equivalent
 * (DBA, City, ZIP, FEIN) are declared with no riskProfilePath, so the mapping engine reports them
 * as missing/"enter manually" instead of guessing. Adding a second real carrier/MGA application
 * later is adding a second entry to this array — the engine and extraction pipeline don't change.
 */
export const APPLICATION_TEMPLATES: ApplicationTemplate[] = [
  {
    id: 'renewal_iq_transportation_demo',
    name: 'Renewal IQ Transportation Application - Demo',
    description: 'An internal sample transportation insurance application layout for MVP testing. Not a certified/regulatory form.',
    sections: [
      {
        title: 'Business Information',
        fields: [
          { targetFieldId: 'named_insured', targetLabel: 'Named Insured', riskProfilePath: 'business.namedInsured', required: true },
          { targetFieldId: 'dba', targetLabel: 'DBA', required: false },
          { targetFieldId: 'address', targetLabel: 'Address', riskProfilePath: 'business.address', required: true },
          { targetFieldId: 'city', targetLabel: 'City', riskProfilePath: 'business.city', required: false },
          { targetFieldId: 'state', targetLabel: 'State', riskProfilePath: 'business.state', required: true },
          { targetFieldId: 'zip', targetLabel: 'ZIP', riskProfilePath: 'business.zip', required: false },
          { targetFieldId: 'fein', targetLabel: 'FEIN', required: false },
          { targetFieldId: 'years_in_business', targetLabel: 'Years in Business', riskProfilePath: 'business.yearsInBusiness', required: true },
          { targetFieldId: 'annual_revenue', targetLabel: 'Annual Revenue', riskProfilePath: 'business.annualRevenue', format: formatCurrency, required: true },
          { targetFieldId: 'description_of_operations', targetLabel: 'Description of Operations', riskProfilePath: 'business.descriptionOfOperations', required: true },
          { targetFieldId: 'dot_number', targetLabel: 'DOT Number', riskProfilePath: 'transportation.dotNumber', required: true },
          { targetFieldId: 'mc_number', targetLabel: 'MC Number', riskProfilePath: 'transportation.mcNumber' },
        ],
      },
      {
        title: 'Operations',
        fields: [
          { targetFieldId: 'states_of_operation', targetLabel: 'States of Operation', riskProfilePath: 'transportation.statesOfOperation', required: true },
          { targetFieldId: 'operating_radius', targetLabel: 'Operating Radius', riskProfilePath: 'transportation.operatingRadius' },
          { targetFieldId: 'commodities_hauled', targetLabel: 'Commodities Hauled', riskProfilePath: 'transportation.commoditiesHauled', required: true },
          { targetFieldId: 'new_venture', targetLabel: 'New Venture', riskProfilePath: 'business.yearsInBusiness', format: formatNewVenture, editable: false },
          { targetFieldId: 'fleet_size', targetLabel: 'Fleet Size', riskProfilePath: 'transportation.fleetSize', required: true },
          { targetFieldId: 'telematics', targetLabel: 'Telematics', riskProfilePath: 'transportation.telematics' },
          { targetFieldId: 'dashcams', targetLabel: 'Dashcams', riskProfilePath: 'transportation.dashcams' },
        ],
      },
      {
        title: 'Current Policy Coverage',
        fields: CURRENT_POLICY_COVERAGE_TYPES.map((type) => ({
          targetFieldId: `current_coverage_${type}`,
          targetLabel: COVERAGE_LABELS[type],
          riskProfilePath: `coverage.${type}.currentLimit`,
          required: false,
        })),
      },
      {
        title: 'Requested Renewal Coverage',
        fields: REQUESTED_COVERAGE_TYPES.map((type) => ({
          targetFieldId: `coverage_${type}`,
          targetLabel: COVERAGE_LABELS[type],
          riskProfilePath: `coverage.${type}.requestedLimit`,
        })),
      },
    ],
    tableSections: [
      {
        title: 'Drivers',
        source: 'drivers',
        columns: [
          { key: 'name', label: 'Driver Name' },
          { key: 'dob', label: 'DOB', format: (e) => ((e as DriverEntry).dob ? formatDateMDY((e as DriverEntry).dob) : '') },
          { key: 'licenseState', label: 'License State' },
          { key: 'yearsExperience', label: 'Years Experience' },
          { key: 'violations', label: 'Violations' },
        ],
      },
      {
        title: 'Vehicles',
        source: 'vehicles',
        columns: [
          { key: 'unitNumber', label: 'Unit Number', format: (_e, index) => String(index + 1) },
          { key: 'year', label: 'Year', format: (e) => ((e as VehicleEntry).year !== undefined ? String((e as VehicleEntry).year) : '') },
          { key: 'vin', label: 'VIN' },
          { key: 'make', label: 'Make' },
          { key: 'model', label: 'Model' },
          { key: 'bodyType', label: 'Vehicle Type' },
          { key: 'value', label: 'Stated Value', format: (e) => ((e as VehicleEntry).value !== undefined ? formatCurrency((e as VehicleEntry).value) : '') },
        ],
      },
      {
        title: 'Loss History',
        source: 'losses',
        columns: [
          { key: 'lossDate', label: 'Loss Date', format: (e) => formatDateMDY((e as LossEntry).lossDate) },
          { key: 'claimType', label: 'Claim Type' },
          { key: 'paid', label: 'Paid', format: (e) => formatCurrency((e as LossEntry).paid) },
          { key: 'reserved', label: 'Reserve', format: (e) => formatCurrency((e as LossEntry).reserved) },
          { key: 'incurred', label: 'Incurred', format: (e) => formatCurrency((e as LossEntry).incurred) },
          { key: 'status', label: 'Status', format: (e) => formatStatus((e as LossEntry).status) },
        ],
      },
    ],
  },
];

export const DEFAULT_APPLICATION_TEMPLATE_ID = APPLICATION_TEMPLATES[0].id;
