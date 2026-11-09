import type { DocumentCategory, MissingItem, UploadedDocument } from '../../types';
import { detectMvr } from './fieldExtraction/idDocumentPatterns';

/**
 * A driver's license the app couldn't read well enough to rely on. Nothing is ever guessed from an
 * unreadable card — instead the broker is told why, and a checklist item asks for a clearer copy.
 * Stored in the document's `warnings` (already saved with the document), so no new column.
 */

export const LICENSE_UNREADABLE_TITLE = 'Driver license could not be read clearly';
const REASON_PREFIX = 'Reason: ';

/** The fields a license must give us, with the words used in the reason. */
const REQUIRED: [field: string, label: string][] = [
  ['name', 'name'],
  ['licenseNumber', 'license number'],
  ['expirationDate', 'expiration date'],
  ['dob', 'date of birth'],
];

interface Assessment {
  category: DocumentCategory;
  /** Nothing at all could be read from the file. */
  readFailed: boolean;
  /** The driver row this document produced (after vision/OCR reconciliation), if any. */
  driver?: Record<string, unknown> & { fieldConfidence?: Partial<Record<string, string>> };
  /** A driving record (MVR), not a license card: it often has no date of birth or expiration on it, and is never "unclear". */
  isDriverRecord?: boolean;
}

const DRIVER_RECORD_NAME = /\bmvr\b|mvr[\s_-]|driving[\s_-]*record|motor[\s_-]*vehicle[\s_-]*record/i;
/** A driving record (MVR) by its file name or its text — never asked for again as a "clearer license". */
export function isDriverRecordDocument(fileName: string, text = ''): boolean {
  return DRIVER_RECORD_NAME.test(fileName) || (!!text && detectMvr(text));
}

/**
 * "Clearer driver license" items the app added on its own (they carry its note "Needed because … could
 * not be read clearly."; one a person adds never does) — removed while nobody has acted on them. The app
 * no longer adds them: the unreadable license is only flagged on the document.
 */
export function isAutoLicenseRequest(item: Pick<MissingItem, 'label' | 'status' | 'notes'>): boolean {
  return item.status === 'missing' && item.label.startsWith('Clearer driver license') && /^Needed because .+ could not be read clearly\.$/.test(item.notes ?? '');
}

/** Why a license needs a clearer copy (empty = it read fine, or it isn't a license). */
export function licenseReadReasons({ category, readFailed, driver, isDriverRecord }: Assessment): string[] {
  if (category !== 'driver_license' || isDriverRecord) return [];
  if (readFailed) return ['image quality too low — no text could be read'];
  if (!driver) return ['no driver details could be read from the image'];
  const reasons: string[] = [];
  for (const [field, label] of REQUIRED) {
    const value = driver[field];
    if (value === undefined || value === null || String(value).trim() === '') reasons.push(`${label} unreadable`);
    else if (driver.fieldConfidence?.[field] === 'low') reasons.push(`${label} unclear`);
  }
  return reasons;
}

/** The warnings to store on the document for these reasons. */
export function licenseWarnings(reasons: string[]): string[] {
  return reasons.length ? [LICENSE_UNREADABLE_TITLE, `${REASON_PREFIX}${reasons.join('; ')}`] : [];
}

/** The unreadable-license notice on a document, if it has one. */
export function licenseReadIssue(doc: Pick<UploadedDocument, 'warnings'>): { title: string; reason: string } | null {
  if (!doc.warnings?.includes(LICENSE_UNREADABLE_TITLE)) return null;
  const reason = doc.warnings.find((w) => w.startsWith(REASON_PREFIX))?.slice(REASON_PREFIX.length) ?? '';
  return { title: LICENSE_UNREADABLE_TITLE, reason };
}
