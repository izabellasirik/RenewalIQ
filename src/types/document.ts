export type DocumentCategory =
  | 'application'
  | 'loss_run'
  | 'vehicle_schedule'
  | 'driver_schedule'
  | 'financials'
  | 'driver_license'
  | 'vehicle_registration'
  | 'insurance_id_card'
  | 'insurance_declarations'
  | 'other';

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  application: 'Insurance Application',
  loss_run: 'Loss Run',
  vehicle_schedule: 'Vehicle Schedule',
  driver_schedule: 'Driver Schedule',
  financials: 'Financials',
  driver_license: "Driver's License",
  vehicle_registration: 'Vehicle Registration',
  insurance_id_card: 'Insurance ID Card',
  insurance_declarations: 'Insurance Declarations Page',
  other: 'Other',
};

export type DocumentFileType = 'pdf' | 'xlsx' | 'csv' | 'docx' | 'txt' | 'image' | 'other';

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
  /** Non-fatal parse warnings, e.g. a scanned PDF with no extractable text. */
  warnings?: string[];
  /**
   * A resized, compressed JPEG data URL — image documents only, so a broker can view the photo
   * that produced an extracted value (see components/upload/DocumentList.tsx). Capped small
   * (long edge ~1000px) specifically so it survives localStorage persistence; this is a viewable
   * copy, not the original full-resolution file, which is never retained after processing.
   */
  previewDataUrl?: string;
  /** Path within the private `submission-documents` Storage bucket, set once the file finishes uploading to a signed-in broker's cloud account. Absent for a local-only (not signed in, or not yet synced) document — see services/supabase/submissionsRepo.ts. */
  storagePath?: string;
}
