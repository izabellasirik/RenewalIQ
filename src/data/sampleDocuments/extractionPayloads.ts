import type { ExtractedFieldResult } from '../../types';
import { DOC_APPLICATION, DOC_LOSS_RUN, DOC_VEHICLE_SCHEDULE, DOC_DRIVER_SCHEDULE } from './documents';

const APPLICATION_NAME = 'ACORD_Commercial_Application_Summit_Freight.pdf';
const LOSS_RUN_NAME = 'Loss_Run_5yr_Summit_Freight.pdf';
const VEHICLE_NAME = 'Vehicle_Schedule_Summit_Freight.xlsx';
const DRIVER_NAME = 'Driver_Schedule_Summit_Freight.xlsx';

/**
 * Canned "extraction" results standing in for a real document-AI provider.
 * Intentionally includes one cross-document conflict (fleetSize, driverCount)
 * and a few fields the documents simply don't contain (annualRevenue, dashcams)
 * so the review UI has something real to flag.
 */
export const extractionPayloads: Record<string, ExtractedFieldResult[]> = {
  [DOC_APPLICATION]: [
    { fieldPath: 'business.namedInsured', value: 'Summit Freight Logistics LLC', confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 1, excerpt: 'Named Insured: Summit Freight Logistics LLC' } },
    { fieldPath: 'business.legalEntity', value: 'Limited Liability Company', confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 1, excerpt: 'Entity Type: LLC' } },
    { fieldPath: 'business.address', value: '4820 Commerce Park Drive, Suite 100, Columbus, OH 43228', confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 1, excerpt: 'Mailing Address: 4820 Commerce Park Drive...' } },
    { fieldPath: 'business.state', value: 'OH', confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 1 } },
    { fieldPath: 'business.yearsInBusiness', value: 8, confidence: 'medium', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 1, excerpt: 'Business Established: 2018' } },
    { fieldPath: 'business.descriptionOfOperations', value: 'Regional dry van trucking serving the Midwest, hauling general freight and packaged goods for retail and manufacturing clients.', confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 2, excerpt: 'Description of Operations: Regional dry van trucking...' } },
    { fieldPath: 'transportation.dotNumber', value: '2894571', confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 1, excerpt: 'USDOT #: 2894571' } },
    { fieldPath: 'transportation.mcNumber', value: 'MC-987432', confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 1, excerpt: 'MC #: MC-987432' } },
    { fieldPath: 'transportation.fleetSize', value: 18, confidence: 'medium', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 2, excerpt: 'Number of Power Units: 18' } },
    { fieldPath: 'transportation.statesOfOperation', value: ['OH', 'IN', 'KY', 'MI', 'PA', 'IL'], confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 2, excerpt: 'States of Operation: OH, IN, KY, MI, PA, IL' } },
    { fieldPath: 'transportation.commoditiesHauled', value: ['General Freight', 'Packaged Goods', 'Retail Merchandise'], confidence: 'medium', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 2, excerpt: 'Commodities Hauled: general freight, packaged consumer goods...' } },
    { fieldPath: 'transportation.driverCount', value: 20, confidence: 'medium', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 2, excerpt: 'Number of Drivers: 20' } },
    { fieldPath: 'coverage.auto_liability.requestedLimit', value: '$1,000,000 CSL', confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 3, excerpt: 'Auto Liability Limit Requested: $1,000,000 CSL' } },
    { fieldPath: 'coverage.motor_truck_cargo.requestedLimit', value: '$100,000', confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 3, excerpt: 'Motor Truck Cargo Limit Requested: $100,000' } },
    { fieldPath: 'coverage.physical_damage.requestedLimit', value: 'ACV, $2,500 deductible', confidence: 'medium', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 3, excerpt: 'Physical Damage: ACV, $2,500 ded.' } },
    { fieldPath: 'coverage.general_liability.requestedLimit', value: '$1,000,000 / $2,000,000', confidence: 'high', source: { documentId: DOC_APPLICATION, documentName: APPLICATION_NAME, page: 3, excerpt: 'General Liability Limits Requested: $1,000,000/$2,000,000' } },
  ],

  [DOC_LOSS_RUN]: [
    { fieldPath: 'coverage.auto_liability.currentLimit', value: '$1,000,000 CSL', confidence: 'high', source: { documentId: DOC_LOSS_RUN, documentName: LOSS_RUN_NAME, page: 1, excerpt: 'Expiring Policy — Auto Liability: $1,000,000 CSL' } },
    { fieldPath: 'coverage.motor_truck_cargo.currentLimit', value: '$100,000', confidence: 'medium', source: { documentId: DOC_LOSS_RUN, documentName: LOSS_RUN_NAME, page: 1, excerpt: 'Expiring Policy — MTC: $100,000' } },
    { fieldPath: 'coverage.general_liability.currentLimit', value: '$1,000,000 / $2,000,000', confidence: 'high', source: { documentId: DOC_LOSS_RUN, documentName: LOSS_RUN_NAME, page: 1, excerpt: 'Expiring Policy — GL: $1,000,000/$2,000,000' } },
    {
      fieldPath: 'lossHistory',
      value: { lossDate: '2024-03-12', claimType: 'Auto Liability', paid: 12500, reserved: 0, incurred: 12500, status: 'closed' },
      confidence: 'high',
      source: { documentId: DOC_LOSS_RUN, documentName: LOSS_RUN_NAME, page: 2, excerpt: '03/12/2024 — AL — Paid $12,500 — Closed' },
    },
    {
      fieldPath: 'lossHistory',
      value: { lossDate: '2023-11-02', claimType: 'Motor Truck Cargo', paid: 8400, reserved: 0, incurred: 8400, status: 'closed' },
      confidence: 'high',
      source: { documentId: DOC_LOSS_RUN, documentName: LOSS_RUN_NAME, page: 2, excerpt: '11/02/2023 — Cargo — Paid $8,400 — Closed' },
    },
    {
      fieldPath: 'lossHistory',
      value: { lossDate: '2023-06-19', claimType: 'Auto Liability', paid: 45000, reserved: 15000, incurred: 60000, status: 'open' },
      confidence: 'high',
      source: { documentId: DOC_LOSS_RUN, documentName: LOSS_RUN_NAME, page: 3, excerpt: '06/19/2023 — AL — Paid $45,000 / Reserved $15,000 — Open' },
    },
    {
      fieldPath: 'lossHistory',
      value: { lossDate: '2022-09-30', claimType: 'Physical Damage', paid: 6200, reserved: 0, incurred: 6200, status: 'closed' },
      confidence: 'high',
      source: { documentId: DOC_LOSS_RUN, documentName: LOSS_RUN_NAME, page: 3, excerpt: '09/30/2022 — PD — Paid $6,200 — Closed' },
    },
  ],

  [DOC_VEHICLE_SCHEDULE]: [
    { fieldPath: 'transportation.fleetSize', value: 22, confidence: 'high', source: { documentId: DOC_VEHICLE_SCHEDULE, documentName: VEHICLE_NAME, excerpt: '22 units listed across rows 2–23' } },
    { fieldPath: 'transportation.vehicleTypes', value: ['Dry Van Tractor-Trailer', 'Box Truck', 'Straight Truck'], confidence: 'high', source: { documentId: DOC_VEHICLE_SCHEDULE, documentName: VEHICLE_NAME, excerpt: 'Column: Vehicle Type' } },
    { fieldPath: 'transportation.operatingRadius', value: '500 mile radius (regional)', confidence: 'medium', source: { documentId: DOC_VEHICLE_SCHEDULE, documentName: VEHICLE_NAME, excerpt: 'Column: Radius of Operation' } },
    { fieldPath: 'transportation.telematics', value: true, confidence: 'high', source: { documentId: DOC_VEHICLE_SCHEDULE, documentName: VEHICLE_NAME, excerpt: 'Column: Telematics Installed — Yes (22/22)' } },
  ],

  [DOC_DRIVER_SCHEDULE]: [
    { fieldPath: 'transportation.driverCount', value: 24, confidence: 'high', source: { documentId: DOC_DRIVER_SCHEDULE, documentName: DRIVER_NAME, excerpt: '24 drivers listed across rows 2–25' } },
    { fieldPath: 'transportation.minDriverAge', value: 23, confidence: 'high', source: { documentId: DOC_DRIVER_SCHEDULE, documentName: DRIVER_NAME, excerpt: 'Youngest driver DOB yields age 23' } },
    { fieldPath: 'transportation.minDriverExperienceYears', value: 2, confidence: 'high', source: { documentId: DOC_DRIVER_SCHEDULE, documentName: DRIVER_NAME, excerpt: 'Column: Years CDL Experience — min 2' } },
  ],
};
