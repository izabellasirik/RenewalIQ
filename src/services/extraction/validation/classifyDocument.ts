import type { DocumentCategory, ExtractedFieldResult } from '../../../types';
import { detectApplication, detectDriverLicense, detectVehicleRegistration, detectDeclarationsPage, detectInsuranceIdCard } from '../fieldExtraction/idDocumentPatterns';
import { inferCategory, inferCategoryFromText } from '../../../utils/documents';

/**
 * What a document is, decided BEFORE anything read from it is applied — because the type limits
 * what it can contain: a license or an MVR is about one driver, a title or a registration about one
 * vehicle, while a schedule can list many. `certainty` says how much to lean on that:
 *
 *  - 'high'   — the document's own text says what it is ("Certificate of Title", "Motor Vehicle Record").
 *  - 'medium' — a weaker hint: what the vision model reported, what the rows read look like, the file name.
 *  - 'low'    — nothing says; whatever it contains is held for review unless strongly anchored.
 */
export interface DocumentClassification {
  category: DocumentCategory;
  certainty: 'high' | 'medium' | 'low';
  /** Why — for tests and debugging (never shown with values). */
  signal: string;
}

const MVR = /\bmvr\b|motor\s+vehicle\s+(?:record|report)|driving\s+record|driver\s+record\s+abstract|record\s+of\s+convictions|driver\s+history\s+record/i;
/** A driver record with a medical certificate section (CDL self-certification / medical examiner). */
const MEDICAL_SECTION = /medical\s+(?:examiner|certificate|certification)|self[\s-]*certification/i;
const TITLE = /certificate\s+of\s+title|\bmotor\s+vehicle\s+title\b|\bvessel\s+title\b|\btitle\s*(?:no\.?|number|#)\s*:?\s*[A-Z0-9]/i;
const IFTA = /\bifta\b|international\s+fuel\s+tax|fuel\s+tax\s+(?:return|report)/i;
const LOSS_RUN = /\bloss\s+runs?\b|\bclaims?\s+history\b|\bloss\s+history\b|\bloss\s+experience\b/i;

/** How many of these results are table rows (a schedule's shape). */
function tableRows(results: ExtractedFieldResult[], fieldPath: 'drivers' | 'vehicles'): number {
  return results.filter((r) => r.fieldPath === fieldPath && r.extractionMethod === 'deterministic_import').length;
}

export function classifyDocument(input: { text: string; fileName: string; visionCategory?: DocumentCategory | null; results: ExtractedFieldResult[] }): DocumentClassification {
  const { text, fileName, visionCategory, results } = input;
  // An application first: its driver section says "Driver License #", "CDL" and "MVR" — read as a
  // license or an MVR, its business fields would all be held back.
  if (detectApplication(text)) return { category: 'application', certainty: 'high', signal: 'text: application' };
  // Single-subject documents next: their text also mentions licenses, VINs, makes and dates, which
  // is exactly what makes them look like schedules to a table reader.
  if (MVR.test(text)) return { category: 'mvr', certainty: 'high', signal: 'text: driving record' };
  if (detectDriverLicense(text) && MEDICAL_SECTION.test(text)) return { category: 'mvr', certainty: 'high', signal: 'text: driver license record with a medical certificate' };
  if (TITLE.test(text)) return { category: 'vehicle_title', certainty: 'high', signal: 'text: certificate of title' };
  if (detectVehicleRegistration(text)) return { category: 'vehicle_registration', certainty: 'high', signal: 'text: vehicle registration' };
  if (results.some((r) => r.fieldPath === 'lossRun') || (LOSS_RUN.test(text) && results.some((r) => r.fieldPath === 'lossHistory'))) {
    return { category: 'loss_run', certainty: 'high', signal: 'text: loss run' };
  }
  if (IFTA.test(text)) return { category: 'ifta', certainty: 'high', signal: 'text: IFTA' };
  // A schedule: several rows under recognized column headers.
  if (tableRows(results, 'vehicles') >= 2) return { category: 'vehicle_schedule', certainty: 'high', signal: 'rows: vehicle table' };
  if (tableRows(results, 'drivers') >= 2) return { category: 'driver_schedule', certainty: 'high', signal: 'rows: driver table' };
  if (detectDriverLicense(text) && !/\bschedule\b|\broster\b|\bdriver\s+list\b/i.test(text)) return { category: 'driver_license', certainty: 'high', signal: 'text: driver license' };
  if (detectDeclarationsPage(text)) return { category: 'insurance_declarations', certainty: 'high', signal: 'text: declarations' };
  if (detectInsuranceIdCard(text)) return { category: 'insurance_id_card', certainty: 'medium', signal: 'text: insurance ID card' };
  if (tableRows(results, 'vehicles') === 1) return { category: 'vehicle_schedule', certainty: 'medium', signal: 'rows: one-row vehicle table' };
  if (tableRows(results, 'drivers') === 1) return { category: 'driver_schedule', certainty: 'medium', signal: 'rows: one-row driver table' };
  if (visionCategory && visionCategory !== 'other') return { category: visionCategory, certainty: 'medium', signal: 'vision' };
  const fromText = inferCategoryFromText(text);
  if (fromText) return { category: fromText, certainty: 'medium', signal: 'text keywords' };
  const fromName = inferCategory(fileName);
  if (fromName !== 'other') return { category: fromName, certainty: 'medium', signal: 'file name' };
  return { category: 'other', certainty: 'low', signal: 'none' };
}

/** The most drivers/vehicles a document of this type can hold. Absent = no limit (schedules, applications, loss runs). */
export const ENTITY_LIMITS: Partial<Record<DocumentCategory, { drivers: number; vehicles: number }>> = {
  driver_license: { drivers: 1, vehicles: 0 },
  mvr: { drivers: 1, vehicles: 0 },
  vehicle_registration: { drivers: 0, vehicles: 1 },
  vehicle_title: { drivers: 0, vehicles: 1 },
  insurance_id_card: { drivers: 0, vehicles: 20 },
  ifta: { drivers: 0, vehicles: 1000 },
  financials: { drivers: 0, vehicles: 0 },
};
