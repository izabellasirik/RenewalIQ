import type { DocumentCategory, DocumentFileType } from '../types';
import { detectDriverLicense, detectVehicleRegistration, detectInsuranceIdCard, detectDeclarationsPage } from '../services/extraction/fieldExtraction/idDocumentPatterns';

/** Image extensions this app can actually decode/OCR client-side. HEIC/HEIF are deliberately not included yet — see services/ingestion/parseImage.ts for why. */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

export function inferFileType(fileName: string): DocumentFileType {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'csv') return 'csv';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'txt') return 'txt';
  if (ext && (IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image';
  return 'other';
}

export function inferCategory(fileName: string): DocumentCategory {
  const n = fileName.toLowerCase();
  if (n.includes('loss')) return 'loss_run';
  if (n.includes('vehicle')) return 'vehicle_schedule';
  if (n.includes('driver')) return 'driver_schedule';
  if (n.includes('application') || n.includes('acord')) return 'application';
  if (n.includes('financ')) return 'financials';
  return 'other';
}

/**
 * Best-effort category refinement from a document's own text — used for images specifically,
 * since a phone photo's filename ("IMG_1843.jpg") almost never hints at what's in it the way
 * "vehicle_schedule.xlsx" does. Pure keyword heuristic, not a document classifier — only ever
 * upgrades away from the 'other' default, and only on a reasonably specific keyword hit, so it
 * can't override a category the filename already made clear.
 */
export function inferCategoryFromText(text: string): DocumentCategory | null {
  const t = text.toLowerCase();
  // Checked ahead of the schedule/spreadsheet heuristics below: a single license or registration
  // card should classify as itself, not as a "schedule" just because it also mentions a license
  // number or a VIN-adjacent word. Filename is never consulted here — a license photo saved as
  // "IMG_1843.png" or "REGULAR_LICENSE.png" alike is classified from what the image actually says.
  if (detectDriverLicense(text)) return 'driver_license';
  if (detectVehicleRegistration(text)) return 'vehicle_registration';
  if (detectDeclarationsPage(text)) return 'insurance_declarations';
  if (detectInsuranceIdCard(text)) return 'insurance_id_card';
  if (/\bloss run\b|\bclaims? history\b|\bincurred\b.{0,20}\bpaid\b/.test(t)) return 'loss_run';
  if (/\bvehicle schedule\b|\bvin\b.{0,20}\b(year|make|model)\b/.test(t)) return 'vehicle_schedule';
  if (/\bdriver schedule\b|\blicense number\b.{0,20}\bstate\b/.test(t)) return 'driver_schedule';
  if (/\bacord\b|\binsurance application\b|\bnamed insured\b/.test(t)) return 'application';
  if (/\bbalance sheet\b|\bincome statement\b|\bprofit and loss\b/.test(t)) return 'financials';
  return null;
}
