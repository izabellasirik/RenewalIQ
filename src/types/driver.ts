import type { Confidence, FieldConflict, FieldSource } from './common';

export interface DriverEntry {
  id: string;
  name?: string;
  dob?: string;
  /** The driver's own address as printed on their license — distinct from, and never merged into, the applicant business's address (business.address). */
  address?: string;
  licenseState?: string;
  /** License/DL number as printed on the card. Never guessed from a partially-unreadable value — see fieldExtraction/idDocumentPatterns.ts. */
  licenseNumber?: string;
  /** License class as printed (e.g. "A", "B", "C", "CDL-A"). */
  licenseClass?: string;
  /** True when the license itself indicates a commercial license (class A/B, or an explicit "CDL"/"Commercial Driver License" marking). */
  isCDL?: boolean;
  issueDate?: string;
  expirationDate?: string;
  restrictions?: string;
  endorsements?: string;
  yearsExperience?: number;
  violations?: string;
  /**
   * Per-field confidence for values read off a document (a license photo, most commonly) where
   * some fields are legible and others aren't — lets a broker see that, say, expirationDate was a
   * shakier read than name/licenseNumber on the same card, instead of one confidence for the whole
   * row. Keyed by DriverEntry field name; absent for fields with no independent confidence signal
   * (a manual row, or an extraction path that only ever produces one overall confidence).
   */
  fieldConfidence?: Partial<Record<string, Confidence>>;
  /** Fields where the vision model and OCR read this row differently — see FieldConflict. The row keeps its primary (generally vision's) value; this holds what the other source read instead, so a disagreement is visible rather than silently resolved. */
  conflicts?: Partial<Record<string, FieldConflict[]>>;
  /** Absent for a broker-added row (isManual: true) — there is no document to point to. */
  source?: FieldSource;
  /** True for a row the broker added or edited directly, rather than one extracted from a document. Deleting a document never removes or alters a manual row. */
  isManual?: boolean;
  lastUpdatedAt?: string;
}
