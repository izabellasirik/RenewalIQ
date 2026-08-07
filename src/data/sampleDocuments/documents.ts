import type { UploadedDocument } from '../../types';
import { SAMPLE_ACCOUNT_ID } from '../sampleAccounts';

export const DOC_APPLICATION = 'doc_application_01';
export const DOC_LOSS_RUN = 'doc_lossrun_01';
export const DOC_VEHICLE_SCHEDULE = 'doc_vehicle_01';
export const DOC_DRIVER_SCHEDULE = 'doc_driver_01';

/** Static metadata for the four sample documents a broker can drag-and-drop in the demo. */
export const sampleDocumentTemplates: Omit<UploadedDocument, 'status' | 'uploadedAt'>[] = [
  {
    id: DOC_APPLICATION,
    accountId: SAMPLE_ACCOUNT_ID,
    name: 'ACORD_Commercial_Application_Summit_Freight.pdf',
    fileType: 'pdf',
    category: 'application',
    sizeBytes: 412_000,
  },
  {
    id: DOC_LOSS_RUN,
    accountId: SAMPLE_ACCOUNT_ID,
    name: 'Loss_Run_5yr_Summit_Freight.pdf',
    fileType: 'pdf',
    category: 'loss_run',
    sizeBytes: 268_000,
  },
  {
    id: DOC_VEHICLE_SCHEDULE,
    accountId: SAMPLE_ACCOUNT_ID,
    name: 'Vehicle_Schedule_Summit_Freight.xlsx',
    fileType: 'xlsx',
    category: 'vehicle_schedule',
    sizeBytes: 54_000,
  },
  {
    id: DOC_DRIVER_SCHEDULE,
    accountId: SAMPLE_ACCOUNT_ID,
    name: 'Driver_Schedule_Summit_Freight.xlsx',
    fileType: 'xlsx',
    category: 'driver_schedule',
    sizeBytes: 39_000,
  },
];
