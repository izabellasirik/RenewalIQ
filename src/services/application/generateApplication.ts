import type { ApplicationForm, ApplicationSection, FieldValue, RiskProfile } from '../../types';
import { COVERAGE_LABELS } from '../../types';

function displayValue<T>(field: FieldValue<T>): string {
  if (field.value === null) return '';
  if (Array.isArray(field.value)) return field.value.join(', ');
  if (typeof field.value === 'boolean') return field.value ? 'Yes' : 'No';
  if (typeof field.value === 'number' && field.value >= 1000) return field.value.toLocaleString('en-US');
  return String(field.value);
}

/**
 * Maps a RiskProfile onto a simplified, ACORD-inspired sample commercial application.
 * This is a demo pre-fill layout, not a certified/regulatory form.
 */
export function generateApplication(profile: RiskProfile): ApplicationForm {
  const { business, transportation, coverage } = profile;

  const applicantSection: ApplicationSection = {
    title: 'Applicant Information',
    fields: [
      { label: 'Named Insured', value: displayValue(business.namedInsured), sourceFieldPath: 'business.namedInsured', editable: true },
      { label: 'Legal Entity', value: displayValue(business.legalEntity), sourceFieldPath: 'business.legalEntity', editable: true },
      { label: 'Mailing Address', value: displayValue(business.address), sourceFieldPath: 'business.address', editable: true },
      { label: 'State', value: displayValue(business.state), sourceFieldPath: 'business.state', editable: true },
      { label: 'Years in Business', value: displayValue(business.yearsInBusiness), sourceFieldPath: 'business.yearsInBusiness', editable: true },
      { label: 'Annual Revenue', value: displayValue(business.annualRevenue), sourceFieldPath: 'business.annualRevenue', editable: true },
    ],
  };

  const operationsSection: ApplicationSection = {
    title: 'Business Operations',
    fields: [
      { label: 'Description of Operations', value: displayValue(business.descriptionOfOperations), sourceFieldPath: 'business.descriptionOfOperations', editable: true },
      { label: 'USDOT Number', value: displayValue(transportation.dotNumber), sourceFieldPath: 'transportation.dotNumber', editable: true },
      { label: 'MC Number', value: displayValue(transportation.mcNumber), sourceFieldPath: 'transportation.mcNumber', editable: true },
      { label: 'Commodities Hauled', value: displayValue(transportation.commoditiesHauled), sourceFieldPath: 'transportation.commoditiesHauled', editable: true },
      { label: 'States of Operation', value: displayValue(transportation.statesOfOperation), sourceFieldPath: 'transportation.statesOfOperation', editable: true },
      { label: 'Operating Radius', value: displayValue(transportation.operatingRadius), sourceFieldPath: 'transportation.operatingRadius', editable: true },
    ],
  };

  const fleetSection: ApplicationSection = {
    title: 'Fleet & Driver Information',
    fields: [
      { label: 'Fleet Size (Power Units)', value: displayValue(transportation.fleetSize), sourceFieldPath: 'transportation.fleetSize', editable: true },
      { label: 'Vehicle Types', value: displayValue(transportation.vehicleTypes), sourceFieldPath: 'transportation.vehicleTypes', editable: true },
      { label: 'Number of Drivers', value: displayValue(transportation.driverCount), sourceFieldPath: 'transportation.driverCount', editable: true },
      { label: 'Minimum Driver Age', value: displayValue(transportation.minDriverAge), sourceFieldPath: 'transportation.minDriverAge', editable: true },
      { label: 'Minimum Driver Experience (yrs)', value: displayValue(transportation.minDriverExperienceYears), sourceFieldPath: 'transportation.minDriverExperienceYears', editable: true },
      { label: 'Telematics Installed', value: displayValue(transportation.telematics), sourceFieldPath: 'transportation.telematics', editable: true },
      { label: 'Dashcams Installed', value: displayValue(transportation.dashcams), sourceFieldPath: 'transportation.dashcams', editable: true },
    ],
  };

  const lossSummarySection: ApplicationSection = {
    title: 'Loss History Summary',
    fields:
      profile.lossHistory.length === 0
        ? [{ label: 'Loss Runs on File', value: 'None uploaded', editable: false }]
        : profile.lossHistory
            .slice()
            .sort((a, b) => (a.lossDate < b.lossDate ? 1 : -1))
            .map((entry) => ({
              label: `${entry.lossDate} — ${entry.claimType}`,
              value: `Paid $${entry.paid.toLocaleString('en-US')} · Reserved $${entry.reserved.toLocaleString('en-US')} · Incurred $${entry.incurred.toLocaleString('en-US')} · ${entry.status === 'open' ? 'Open' : 'Closed'}`,
              editable: false,
            })),
  };

  const coverageSection: ApplicationSection = {
    title: 'Coverage Requested',
    fields: coverage.map((line) => ({
      label: COVERAGE_LABELS[line.type],
      value: displayValue(line.requestedLimit),
      sourceFieldPath: `coverage.${line.type}.requestedLimit`,
      editable: true,
    })),
  };

  return {
    accountId: profile.accountId,
    generatedAt: new Date().toISOString(),
    templateName: 'Sample Commercial Auto Application (ACORD-inspired)',
    sections: [applicantSection, operationsSection, fleetSection, lossSummarySection, coverageSection],
  };
}
