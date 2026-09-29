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
  | 'mvr'
  | 'vehicle_title'
  | 'ifta'
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
  mvr: 'MVR (Driving Record)',
  vehicle_title: 'Vehicle Title',
  ifta: 'IFTA',
  other: 'Other',
};

export type DocumentFileType = 'pdf' | 'xlsx' | 'csv' | 'docx' | 'txt' | 'image' | 'other';

export type DocumentStatus = 'processing' | 'processed' | 'error';

/** What this specific document contributed, as extracted — persisted so "View extracted data" can show it later without re-running extraction. One entry per ExtractedFieldResult this document produced. */
export interface DocumentExtractedField {
  fieldPath: string;
  value: unknown;
  confidence: import('./common').Confidence;
  extractionMethod?: import('./common').ExtractionMethod;
}

/**
 * Something a document seems to say that Renewal IQ did NOT apply on its own — uncertain, or at
 * odds with what the document is (a second "vehicle" on a vehicle title). It stays here, off the
 * Risk Profile and out of every count, until the broker applies (as read, or corrected) or ignores it.
 */
export interface ReviewCandidate {
  id: string;
  fieldPath: string;
  value: unknown;
  confidence: import('./common').Confidence;
  extractionMethod?: import('./common').ExtractionMethod;
  /** The document, page (when the reader knows it) and text it was read from. */
  source: import('./common').FieldSource;
  /** Why it wasn't applied, in plain words ("VIN could not be read confidently"). */
  reason: string;
  /** Ignored by the broker — kept as a record, no longer shown. */
  ignored?: boolean;
}

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
  /** Every field this document produced at extraction time — the "View extracted data" panel's source of truth for what THIS document contributed (its current disposition in the Risk Profile — applied/needs review/conflict — is looked up live against the current profile, not stored here, since later documents/edits can change it). */
  extractedFields?: DocumentExtractedField[];
  /** What it read but did not apply — see ReviewCandidate. */
  reviewCandidates?: ReviewCandidate[];
  /** How many fragments were thrown away as unreadable or as form labels (never shown as values). */
  rejectedCount?: number;
  /** Vision's free-text fallback for anything readable that didn't map to a known field — never silently discarded, shown in the detail panel instead. */
  candidateNotes?: string;
  /**
   * A resized, compressed JPEG data URL — image documents only, so a broker can view the photo
   * that produced an extracted value (see components/upload/DocumentList.tsx). Capped small
   * (long edge ~1000px) specifically so it survives localStorage persistence; this is a viewable
   * copy, not the original full-resolution file, which is never retained after processing.
   */
  previewDataUrl?: string;
  /** Path within the private `submission-documents` Storage bucket, set once the file finishes uploading to a signed-in broker's cloud account. Absent for a local-only (not signed in, or not yet synced) document — see services/supabase/submissionsRepo.ts. */
  storagePath?: string;
  /** The link this document came from, when it arrived as a URL rather than a file — kept even when the link couldn't be opened. */
  sourceUrl?: string;
  /** What it evidently is (requirement kinds, people named, quarter) — used to check a client's upload against what was requested. */
  signals?: import('../services/requests/documentSignals').DocumentSignals;
}
