/**
 * Synthetic documents shaped like the real ones that went wrong — a Florida-style license, an MVR
 * with a medical-certificate section, a scanned vehicle title full of printed form labels, a
 * multi-vehicle schedule, pure OCR noise. Every name, number, address and VIN here is invented;
 * no real customer document is (or may be) committed to this repository.
 *
 * Each fixture says what a careful human would take from it (`expected`) — the yardstick for
 * auto-apply precision (see extractionIntegrity.test.ts).
 */
import { buildLines, lineTexts, type PdfTextPiece } from '../../../ingestion/pdfLayout';
import type { RawDocument, RawTable } from '../../../ingestion';

/** A VIN with a correct check digit (position 9) — `pattern` has "?" there. */
export function vinWithCheckDigit(pattern: string): string {
  const map: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) if (i !== 8) sum += (/\d/.test(pattern[i]) ? Number(pattern[i]) : map[pattern[i]]) * weights[i];
  const check = sum % 11;
  return pattern.slice(0, 8) + (check === 10 ? 'X' : String(check)) + pattern.slice(9);
}

/** A PDF page as positioned text: each row's [x, text] cells on one baseline. */
function layoutDoc(name: string, rows: { y: number; cells: [number, string][] }[], scanned: boolean): RawDocument {
  const pieces: PdfTextPiece[] = [];
  for (const r of rows) for (const [x, str] of r.cells) pieces.push({ str, x, y: r.y, width: str.length * 4.5, height: 9 });
  const layout = buildLines(pieces, 1);
  const text = layout.flatMap(lineTexts).join('\n');
  return { documentName: name, fileType: 'pdf', text, pages: [{ pageNumber: 1, text }], layout, warnings: [], ...(scanned ? { ocrConfidence: 71 } : {}) };
}

function textDoc(name: string, text: string, fileType: RawDocument['fileType'] = 'txt'): RawDocument {
  return { documentName: name, fileType, text, warnings: [] };
}

export interface Expected {
  drivers: { name: string; licenseNumber?: string }[];
  vehicles: { vin?: string; year?: number; make?: string }[];
  /** Scalar fields a human would accept from this document, value as stored. */
  fields: Record<string, unknown>;
}

export interface Fixture {
  id: string;
  doc: RawDocument;
  scanned: boolean;
  expected: Expected;
}

export const TITLE_VIN = vinWithCheckDigit('1FUJGLDR?FLGA1234');
export const MISREAD_VIN = (() => {
  // The same VIN with one character misread (8 → B) — its check digit no longer matches.
  const v = vinWithCheckDigit('3AKJHHDR?MSMB5678');
  return v.slice(0, 12) + (v[12] === 'B' ? '8' : 'B') + v.slice(13);
})();

// A — a driver's license (OCR'd photo text)
export const LICENSE: Fixture = {
  id: 'A-license',
  scanned: true,
  doc: textDoc(
    'IMG_2044.jpg',
    [
      'FLORIDA',
      'DRIVER LICENSE',
      'DL# M512-781-85-264-0',
      'Name: ALEX R MORGAN',
      'Address: 100 SAMPLE ST',
      'MIAMI, FL 33101',
      'DOB: 07/24/1985',
      'ISS: 05/23/2022',
      'EXP: 07/24/2030',
      'CLASS: A',
      'RESTR: NONE',
    ].join('\n'),
    'image'
  ),
  expected: { drivers: [{ name: 'Alex R Morgan', licenseNumber: 'M512-781-85-264-0' }], vehicles: [], fields: {} },
};

// B — an MVR: one subject driver, plus a medical certificate and its examiner
export const MVR: Fixture = {
  id: 'B-mvr',
  scanned: false,
  doc: textDoc(
    'SUBJECT_RECORD.pdf',
    [
      'MOTOR VEHICLE RECORD — DRIVER HISTORY',
      'Driver Information',
      'Name: ALEX R MORGAN',
      'DOB: 07/24/1985',
      'License Number: M512-781-85-264-0',
      'License State: FL',
      'Class: A',
      'Issue Date: 05/23/2022',
      'Expiration Date: 07/24/2030',
      'Address:',
      'City/State/Zip: Driver Information',
      'Medical Certificate Information',
      'Status: Certified',
      'Expiration: 01/15/2027',
      'Medical Examiner Name: JORDAN P LEE',
      'License Number: ME99887766',
      'Jurisdiction: FL',
      'Reg. Number: 4455667788',
      'Speciality Code: CE',
      'Phone: 305-555-0100',
      'Additional Messages: NONE',
    ].join('\n')
  ),
  expected: { drivers: [{ name: 'Alex R Morgan', licenseNumber: 'M512-781-85-264-0' }], vehicles: [], fields: {} },
};

// B2 — the same kind of record laid out in columns, labels under the Name/DOB/License headers
export const MVR_COLUMNS: Fixture = {
  id: 'B2-mvr-columns',
  scanned: true,
  doc: layoutDoc(
    'SERGEY_like_record.pdf',
    [
      { y: 760, cells: [[40, 'MOTOR VEHICLE RECORD']] },
      { y: 730, cells: [[40, 'Name'], [220, 'DOB'], [360, 'License Number']] },
      { y: 716, cells: [[40, 'Alex R Morgan'], [220, '07/24/1985'], [360, 'M512-781-85-264-0']] },
      { y: 702, cells: [[40, 'Address:'], [220, 'City/State/Zip:'], [360, 'Driver Information']] },
      { y: 688, cells: [[40, 'Jurisdiction:'], [220, '—'], [360, 'REG. NUMBER:']] },
      { y: 674, cells: [[40, 'Speciality Code:'], [220, '—'], [360, 'PHONE: ADDITIONAL MESSAGES']] },
      { y: 660, cells: [[40, 'Jordan P Lee'], [220, '—'], [360, 'ME99887766']] },
    ],
    true
  ),
  // A column layout can't say which person is the subject — held for review, never guessed.
  expected: { drivers: [{ name: 'Alex R Morgan', licenseNumber: 'M512-781-85-264-0' }], vehicles: [], fields: {} },
};

// C — a scanned vehicle title: one vehicle, many printed labels, the owner's address
export const TITLE: Fixture = {
  id: 'C-title',
  scanned: true,
  doc: layoutDoc(
    'Receipt_2026-09-05.pdf',
    [
      { y: 780, cells: [[40, 'CERTIFICATE OF TITLE']] },
      { y: 760, cells: [[40, `VIN: ${TITLE_VIN}`]] },
      { y: 746, cells: [[40, 'Year: 2015'], [200, 'Make: FRHT'], [340, 'Title Number: 104455667']] },
      { y: 720, cells: [[40, 'Year'], [160, 'Make'], [300, 'Model'], [440, 'Plate']] },
      { y: 706, cells: [[160, '2015 [FRHT | TR 17000'], [440, '—']] },
      { y: 692, cells: [[160, 'Color ——— Primary Brand ——— Secondary Brand ——-'], [300, 'gf']] },
      { y: 678, cells: [[160, '| | PRIVATEfoazasatee ='], [300, '|']] },
      { y: 664, cells: [[160, 'Odometer Status or Vessel Manufacturer ——— Engine Drive'], [300, 'Hull Material']] },
      { y: 650, cells: [[160, 'N SAMPLE CLUB DR APT 204'], [440, '33180']] },
      { y: 620, cells: [[40, 'Registered Owner: ALEX R MORGAN']] },
      { y: 606, cells: [[40, 'Address: {=a']] },
    ],
    true
  ),
  expected: { drivers: [], vehicles: [{ vin: TITLE_VIN, year: 2015, make: 'Freightliner' }], fields: {} },
};

// D — a multi-vehicle schedule (typed spreadsheet)
const SCHEDULE_VINS = ['1XKYD49X9KJ123456', '3AKJHHDR5MSMA1234', '1FUJGLDR3FLGC7788', '1GRAA0620KB123456'];
const SCHEDULE_TABLE: RawTable = {
  sheetName: 'Units',
  headers: ['Unit', 'Year', 'Make', 'Model', 'VIN', 'Stated Value'],
  rows: [
    ['101', '2019', 'Kenworth', 'T680', SCHEDULE_VINS[0], '$98,000'],
    ['102', '2021', 'Freightliner', 'Cascadia', SCHEDULE_VINS[1], '$125,000'],
    ['103', '2015', 'Freightliner', 'Cascadia', SCHEDULE_VINS[2], '$61,000'],
    ['T1', '2019', 'Great Dane', 'Reefer Trailer', SCHEDULE_VINS[3], '$42,000'],
  ],
};
export const SCHEDULE: Fixture = {
  id: 'D-schedule',
  scanned: false,
  doc: { documentName: 'Unit_List.xlsx', fileType: 'xlsx', text: 'Unit List', tables: [SCHEDULE_TABLE], warnings: [] },
  expected: {
    drivers: [],
    vehicles: SCHEDULE_VINS.map((vin) => ({ vin })),
    fields: { 'transportation.fleetSize': 4 },
  },
};

// E — nothing but noise and labels
export const GARBAGE: Fixture = {
  id: 'E-garbage',
  scanned: true,
  doc: layoutDoc(
    'scan_0007.pdf',
    [
      { y: 760, cells: [[40, 'Address: {=a']] },
      { y: 730, cells: [[40, 'Year'], [160, 'Make'], [300, 'Model']] },
      { y: 716, cells: [[40, '|'], [160, '|||||'], [300, '_____']] },
      { y: 702, cells: [[40, '{='], [160, 'Color ____ Primary Brand ____'], [300, '|||']] },
      { y: 670, cells: [[40, 'Name'], [220, 'DOB'], [360, 'License Number']] },
      { y: 656, cells: [[40, 'Address:'], [220, '_____'], [360, 'Phone:']] },
      { y: 642, cells: [[40, 'Additional Messages'], [220, '—'], [360, 'REG. NUMBER:']] },
    ],
    true
  ),
  expected: { drivers: [], vehicles: [], fields: {} },
};

// F — readable, one critical identifier uncertain: a scanned registration whose VIN fails its check digit
export const UNCERTAIN_VIN: Fixture = {
  id: 'F-uncertain-vin',
  scanned: true,
  doc: textDoc('registration_scan.pdf', ['VEHICLE REGISTRATION', `VIN: ${MISREAD_VIN}`, 'Year: 2021', 'Make: FRHT', 'Plate: TRK4412'].join('\n'), 'pdf'),
  // A human would keep it — with the VIN checked. Not auto-applied, not thrown away.
  expected: { drivers: [], vehicles: [], fields: {} },
};

// H — a known-good driver schedule
export const DRIVER_SCHEDULE: Fixture = {
  id: 'H-driver-schedule',
  scanned: false,
  doc: {
    documentName: 'Driver_Schedule.xlsx',
    fileType: 'xlsx',
    text: 'Driver Schedule',
    tables: [
      {
        sheetName: 'Drivers',
        headers: ['Driver Name', 'DOB', 'License State', 'License Number', 'Years Experience'],
        rows: [
          ['Jamie Carter', '03/14/1980', 'TX', 'TX1234567', '15'],
          ['Morgan Diaz', '11/02/1990', 'OK', 'OK7654321', '6'],
          ['Riley Chen', '06/30/1976', 'AR', 'AR5550001', '22'],
        ],
      },
    ],
    warnings: [],
  },
  expected: {
    drivers: [{ name: 'Jamie Carter' }, { name: 'Morgan Diaz' }, { name: 'Riley Chen' }],
    vehicles: [],
    fields: { 'transportation.driverCount': 3 },
  },
};

export const ALL_FIXTURES: Fixture[] = [LICENSE, MVR, MVR_COLUMNS, TITLE, SCHEDULE, GARBAGE, UNCERTAIN_VIN, DRIVER_SCHEDULE];
