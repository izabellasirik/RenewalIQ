import type { ApplicationTemplate } from '../../types';
import { COVERAGE_LABELS } from '../../types';

const COVERAGE_TYPES = ['auto_liability', 'motor_truck_cargo', 'physical_damage', 'general_liability'] as const;

/**
 * Two templates on purpose: proving the mapping engine is reusable means showing the same
 * RiskProfile data land in two differently-shaped target forms, not just asserting it in prose.
 * Adding a third carrier/MGA application is adding a third entry here — no engine or extraction
 * changes required.
 */
export const APPLICATION_TEMPLATES: ApplicationTemplate[] = [
  {
    id: 'acord_commercial_auto',
    name: 'Sample Commercial Auto Application (ACORD-inspired)',
    description: 'A demo pre-fill layout modeled on standard ACORD commercial auto submission fields. Not a certified/regulatory form.',
    sections: [
      {
        title: 'Applicant Information',
        fields: [
          { targetFieldId: 'named_insured', targetLabel: 'Named Insured', riskProfilePath: 'business.namedInsured' },
          { targetFieldId: 'legal_entity', targetLabel: 'Legal Entity', riskProfilePath: 'business.legalEntity' },
          { targetFieldId: 'mailing_address', targetLabel: 'Mailing Address', riskProfilePath: 'business.address' },
          { targetFieldId: 'state', targetLabel: 'State', riskProfilePath: 'business.state' },
          { targetFieldId: 'years_in_business', targetLabel: 'Years in Business', riskProfilePath: 'business.yearsInBusiness' },
          { targetFieldId: 'annual_revenue', targetLabel: 'Annual Revenue', riskProfilePath: 'business.annualRevenue' },
        ],
      },
      {
        title: 'Business Operations',
        fields: [
          { targetFieldId: 'description_of_operations', targetLabel: 'Description of Operations', riskProfilePath: 'business.descriptionOfOperations' },
          { targetFieldId: 'dot_number', targetLabel: 'USDOT Number', riskProfilePath: 'transportation.dotNumber' },
          { targetFieldId: 'mc_number', targetLabel: 'MC Number', riskProfilePath: 'transportation.mcNumber' },
          { targetFieldId: 'commodities_hauled', targetLabel: 'Commodities Hauled', riskProfilePath: 'transportation.commoditiesHauled' },
          { targetFieldId: 'states_of_operation', targetLabel: 'States of Operation', riskProfilePath: 'transportation.statesOfOperation' },
          { targetFieldId: 'operating_radius', targetLabel: 'Operating Radius', riskProfilePath: 'transportation.operatingRadius' },
        ],
      },
      {
        title: 'Fleet & Driver Information',
        fields: [
          { targetFieldId: 'fleet_size', targetLabel: 'Fleet Size (Power Units)', riskProfilePath: 'transportation.fleetSize' },
          { targetFieldId: 'vehicle_types', targetLabel: 'Vehicle Types', riskProfilePath: 'transportation.vehicleTypes' },
          { targetFieldId: 'driver_count', targetLabel: 'Number of Drivers', riskProfilePath: 'transportation.driverCount' },
          { targetFieldId: 'min_driver_age', targetLabel: 'Minimum Driver Age', riskProfilePath: 'transportation.minDriverAge' },
          { targetFieldId: 'min_driver_experience', targetLabel: 'Minimum Driver Experience (yrs)', riskProfilePath: 'transportation.minDriverExperienceYears' },
          { targetFieldId: 'telematics', targetLabel: 'Telematics Installed', riskProfilePath: 'transportation.telematics' },
          { targetFieldId: 'dashcams', targetLabel: 'Dashcams Installed', riskProfilePath: 'transportation.dashcams' },
        ],
      },
      {
        title: 'Coverage Requested',
        fields: COVERAGE_TYPES.map((type) => ({
          targetFieldId: `coverage_${type}`,
          targetLabel: COVERAGE_LABELS[type],
          riskProfilePath: `coverage.${type}.requestedLimit`,
        })),
      },
    ],
  },
  {
    id: 'northfield_mutual_commercial_auto',
    name: 'Northfield Mutual — Commercial Auto Submission Form',
    description: "A sample of how the same Risk Profile maps onto one carrier's own submission form layout and field naming.",
    marketName: 'Northfield Mutual',
    sections: [
      {
        title: 'Named Insured & Location',
        fields: [
          { targetFieldId: 'ni_name', targetLabel: 'Named Insured', riskProfilePath: 'business.namedInsured' },
          { targetFieldId: 'ni_entity_type', targetLabel: 'Entity Type', riskProfilePath: 'business.legalEntity' },
          { targetFieldId: 'ni_address', targetLabel: 'Business Address', riskProfilePath: 'business.address' },
          { targetFieldId: 'ni_state', targetLabel: 'Domicile State', riskProfilePath: 'business.state' },
          { targetFieldId: 'ni_years', targetLabel: 'Years Established', riskProfilePath: 'business.yearsInBusiness' },
          { targetFieldId: 'gross_receipts', targetLabel: 'Gross Receipts', riskProfilePath: 'business.annualRevenue' },
        ],
      },
      {
        title: 'Motor Carrier Details',
        fields: [
          { targetFieldId: 'usdot', targetLabel: 'USDOT Number', riskProfilePath: 'transportation.dotNumber' },
          { targetFieldId: 'mc', targetLabel: 'MC Number', riskProfilePath: 'transportation.mcNumber' },
          { targetFieldId: 'operations_narrative', targetLabel: 'Nature of Operations', riskProfilePath: 'business.descriptionOfOperations' },
          { targetFieldId: 'commodities', targetLabel: 'Primary Commodities', riskProfilePath: 'transportation.commoditiesHauled' },
          { targetFieldId: 'radius', targetLabel: 'Radius of Operation', riskProfilePath: 'transportation.operatingRadius' },
          { targetFieldId: 'states', targetLabel: 'States/Territories Traveled', riskProfilePath: 'transportation.statesOfOperation' },
        ],
      },
      {
        title: 'Power Units & Drivers',
        fields: [
          { targetFieldId: 'power_units', targetLabel: 'Number of Power Units', riskProfilePath: 'transportation.fleetSize' },
          { targetFieldId: 'unit_types', targetLabel: 'Unit Type(s)', riskProfilePath: 'transportation.vehicleTypes' },
          { targetFieldId: 'driver_count', targetLabel: 'Total Drivers', riskProfilePath: 'transportation.driverCount' },
          { targetFieldId: 'driver_min_age', targetLabel: 'Driver Age Minimum', riskProfilePath: 'transportation.minDriverAge' },
          { targetFieldId: 'driver_min_exp', targetLabel: 'Driver Experience Minimum (yrs)', riskProfilePath: 'transportation.minDriverExperienceYears' },
          { targetFieldId: 'telematics_yn', targetLabel: 'Telematics? (Y/N)', riskProfilePath: 'transportation.telematics' },
          { targetFieldId: 'dashcam_yn', targetLabel: 'In-Cab Cameras? (Y/N)', riskProfilePath: 'transportation.dashcams' },
        ],
      },
      {
        title: 'Limits Requested',
        fields: [
          { targetFieldId: 'nf_auto_liability', targetLabel: 'Auto Liability CSL', riskProfilePath: 'coverage.auto_liability.requestedLimit' },
          { targetFieldId: 'nf_cargo', targetLabel: 'Motor Truck Cargo Limit', riskProfilePath: 'coverage.motor_truck_cargo.requestedLimit' },
          { targetFieldId: 'nf_phys_damage', targetLabel: 'Physical Damage Limit', riskProfilePath: 'coverage.physical_damage.requestedLimit' },
          { targetFieldId: 'nf_gl', targetLabel: 'General Liability Limit', riskProfilePath: 'coverage.general_liability.requestedLimit' },
        ],
      },
    ],
  },
];

export const DEFAULT_APPLICATION_TEMPLATE_ID = APPLICATION_TEMPLATES[0].id;
