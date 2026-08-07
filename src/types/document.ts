export type DocumentCategory =
  | 'application'
  | 'loss_run'
  | 'vehicle_schedule'
  | 'driver_schedule'
  | 'financials'
  | 'other';

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  application: 'Insurance Application',
  loss_run: 'Loss Run',
  vehicle_schedule: 'Vehicle Schedule',
  driver_schedule: 'Driver Schedule',
  financials: 'Financials',
  other: 'Other',
};

export type DocumentFileType = 'pdf' | 'xlsx' | 'csv' | 'docx' | 'other';

export type DocumentStatus = 'processing' | 'processed' | 'error';

export interface UploadedDocument {
  id: string;
  accountId: string;
  name: string;
  fileType: DocumentFileType;
  category: DocumentCategory;
  uploadedAt: string;
  status: DocumentStatus;
  sizeBytes: number;
  fieldsExtracted?: number;
}
