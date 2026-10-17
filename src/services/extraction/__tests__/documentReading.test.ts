import { describe, expect, it } from 'vitest';
import { buildLines, findTables, lineTexts, type PdfTextPiece } from '../../ingestion/pdfLayout';
import { classifyTable, hasValidVinCheckDigit, mapDriverTable, mapLossTable, mapVehicleTable, normalizeVin } from '../fieldExtraction/tableMappers';
import { extractInsuranceFields } from '../fieldExtraction/extractInsuranceFields';
import { mergeIntoRiskProfile } from '../extractionService';
import { createEmptyRiskProfile } from '../emptyRiskProfile';
import { settleLossRuns } from '../lossRunRecords';
import type { RawDocument } from '../../ingestion';
import type { LossRun } from '../../../types';

/** A PDF page laid out like the real thing: each [x, text] at one baseline. Right-aligned cells use a negative x (right edge). */
function page(rows: { y: number; cells: [number, string][]; size?: number }[], pageNo = 1) {
  const pieces: PdfTextPiece[] = [];
  for (const r of rows) {
    const size = r.size ?? 9;
    for (const [x, str] of r.cells) {
      const width = str.length * size * 0.5;
      pieces.push({ str, x: x < 0 ? -x - width : x, y: r.y, width, height: size });
    }
  }
  return buildLines(pieces, pageNo);
}

function pdfDoc(lines: ReturnType<typeof buildLines>, name = 'doc.pdf'): RawDocument {
  const text = lines.flatMap(lineTexts).join('\n');
  return { documentName: name, fileType: 'pdf', text, pages: [{ pageNumber: 1, text }], layout: lines, warnings: [] };
}

const LOSS_RUN = page([
  { y: 570, cells: [[36, 'PROGRESSIVE COMMERCIAL'], [-756, 'Loss Run Report']], size: 12 },
  { y: 552, cells: [[36, 'Progressive Casualty Insurance Company'], [-756, 'Valuation Date: 09/15/2026']] },
  { y: 528, cells: [[36, 'Insured:'], [110, 'ABC TRANSPORTATION LLC'], [420, 'Agent:'], [480, 'Smith Insurance Agency']] },
  { y: 514, cells: [[36, 'Policy Number:'], [110, 'CA 04471932']] },
  { y: 500, cells: [[36, 'Policy Period:'], [110, '01/15/2025 - 01/15/2026']] },
  { y: 476, cells: [[36, 'Claim Number'], [120, 'Date of Loss'], [255, 'Description'], [440, 'Coverage'], [520, 'Status'], [-610, 'Paid'], [-680, 'Reserve'], [-756, 'Total Incurred']] },
  { y: 460, cells: [[36, '25-1187342'], [120, '03/22/2025'], [255, 'Rear-ended third party'], [440, 'Bodily Injury'], [520, 'Closed'], [-610, '18,450.00'], [-680, '0.00'], [-756, '18,450.00']] },
  { y: 447, cells: [[36, '25-1203917'], [120, '06/09/2025'], [255, 'Backing into dock, damage to'], [440, 'Collision'], [520, 'Closed'], [-610, '6,210.55'], [-680, '0.00'], [-756, '6,210.55']] },
  { y: 434, cells: [[255, 'trailer door']] },
  { y: 421, cells: [[36, '25-1311408'], [120, '11/02/2025'], [255, 'Cargo shifted in transit'], [440, 'Cargo'], [520, 'Open'], [-610, '2,500.00'], [-680, '7,500.00'], [-756, '10,000.00']] },
  { y: 400, cells: [[36, 'Policy Totals:'], [190, '3 Claims'], [-610, '27,160.55'], [-680, '7,500.00'], [-756, '34,660.55']] },
  { y: 370, cells: [[36, 'Policy Number:'], [110, 'CA 03982210']] },
  { y: 356, cells: [[36, 'Policy Period:'], [110, '01/15/2024 - 01/15/2025']] },
  { y: 336, cells: [[36, 'No losses reported for this policy period.']] },
]);

describe('PDF layout', () => {
  it('splits "Label: value   Label: value" printed on one line', () => {
    const insured = LOSS_RUN.find((l) => l.cells[0].text === 'Insured:')!;
    expect(lineTexts(insured)).toEqual(['Insured: ABC TRANSPORTATION LLC', 'Agent: Smith Insurance Agency']);
    const company = LOSS_RUN.find((l) => l.cells[0].text.startsWith('Progressive Casualty'))!;
    expect(lineTexts(company)).toEqual(['Progressive Casualty Insurance Company', 'Valuation Date: 09/15/2026']);
  });

  it('rebuilds a table by column, joins a wrapped description, and reads the totals line', () => {
    const [t] = findTables(LOSS_RUN, (h) => classifyTable(h) !== 'unrecognized');
    expect(t.headers).toEqual(['Claim Number', 'Date of Loss', 'Description', 'Coverage', 'Status', 'Paid', 'Reserve', 'Total Incurred']);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[1]).toEqual(['25-1203917', '06/09/2025', 'Backing into dock, damage to trailer door', 'Collision', 'Closed', '6,210.55', '0.00', '6,210.55']);
    expect(t.totals?.[7]).toBe('34,660.55');
  });
});

describe('column mapping', () => {
  it('never reads "Years Driving" as a VIN column; first + last name make the driver', () => {
    const table = { headers: ['First Name', 'Last Name', 'CDL #', 'CDL State', 'Hire Date', 'Years Driving'], rows: [['Luis', 'Ortega', 'D1234567', 'NM', '05/01/2020', '12']] };
    expect(classifyTable(table.headers)).toBe('drivers');
    expect(mapDriverTable(table)[0].entry).toEqual({ name: 'Luis Ortega', licenseNumber: 'D1234567', licenseState: 'NM', hireDate: '2020-05-01', yearsExperience: 12 });
  });

  it('a driver list without DOB is still a driver list; "License #" is the number, "State" the license state', () => {
    const table = { headers: ['Driver Name', 'License #', 'State', 'Class', 'Date of Hire'], rows: [['John Smith', 's530-4471', 'tx', 'Class A', '2019-02-01'], ['Totals', '', '', '', '']] };
    expect(classifyTable(table.headers)).toBe('drivers');
    const rows = mapDriverTable(table);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry).toMatchObject({ name: 'John Smith', licenseNumber: 'S530-4471', licenseState: 'TX', licenseClass: 'A', hireDate: '2019-02-01' });
  });

  it('reads VINs as scanned (O→0, I→1), a Make/Model column, and stated values', () => {
    expect(normalizeVin('1XKYD49X9KJ12345 6')).toBe('1XKYD49X9KJ123456');
    expect(normalizeVin('1XKYD49X9KJI23456')).toBe('1XKYD49X9KJ123456');
    expect(normalizeVin('not a vin')).toBeNull();
    expect(hasValidVinCheckDigit('1M8GDM9AXKP042788')).toBe(true);
    expect(hasValidVinCheckDigit('1M8GDM9A1KP042788')).toBe(false);
    const table = { headers: ['Unit', 'Year', 'Make/Model', 'VIN', 'Stated Amount'], rows: [['101', '2021', 'Freightliner Cascadia', '3AKJHHDR5MSMA1234', '$125,000']] };
    expect(classifyTable(table.headers)).toBe('vehicles');
    expect(mapVehicleTable(table)[0].entry).toEqual({ vin: '3AKJHHDR5MSMA1234', make: 'Freightliner', model: 'Cascadia', year: 2021, value: 125000 });
  });

  it('loss tables: claim number, description, missing amounts derived, status from reserve', () => {
    const table = { headers: ['Claim #', 'Accident Date', 'Loss Description', 'Paid', 'Outstanding'], rows: [['C-1', '3/22/25', 'Rear-ended', '$1,000', '$500'], ['C-2', '2024-06-09', 'Glass', '250', '0']] };
    expect(classifyTable(table.headers)).toBe('losses');
    const [a, b] = mapLossTable(table).map((r) => r.entry);
    expect(a).toEqual({ lossDate: '2025-03-22', claimType: 'Unspecified', paid: 1000, reserved: 500, incurred: 1500, status: 'open', claimNumber: 'C-1', description: 'Rear-ended' });
    expect(b).toMatchObject({ lossDate: '2024-06-09', incurred: 250, status: 'closed' });
  });
});

describe('loss runs', () => {
  const results = extractInsuranceFields(pdfDoc(LOSS_RUN, 'Progressive_Loss_Run.pdf'), { documentId: 'doc1', documentName: 'Progressive_Loss_Run.pdf' });
  const runs = results.filter((r) => r.fieldPath === 'lossRun').map((r) => r.value as Record<string, unknown>);
  const claims = results.filter((r) => r.fieldPath === 'lossHistory').map((r) => r.value as Record<string, unknown>);

  it('one record per policy term: carrier, policy, period, report date, stated totals; "no losses" terms', () => {
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      carrier: 'Progressive Casualty Insurance Company',
      policyNumber: 'CA 04471932',
      reportDate: '2026-09-15',
      coverageStart: '2025-01-15',
      coverageEnd: '2026-01-15',
      claimCount: 3,
      totalPaid: 27160.55,
      totalReserve: 7500,
      totalIncurred: 34660.55,
    });
    expect(runs[1]).toMatchObject({ policyNumber: 'CA 03982210', coverageStart: '2024-01-15', claimCount: 0, totalIncurred: 0 });
  });

  it('claims belong to the term they are printed under; the insured name is not polluted by the agent', () => {
    expect(claims).toHaveLength(3);
    expect(new Set(claims.map((c) => c.lossRunKey))).toEqual(new Set([runs[0].key]));
    expect(claims[0]).toMatchObject({ claimNumber: '25-1187342', lossDate: '2025-03-22', claimType: 'Bodily Injury', incurred: 18450 });
    expect(results.find((r) => r.fieldPath === 'business.namedInsured')?.value).toBe('ABC TRANSPORTATION LLC');
  });

  it('become the account records with claims linked; re-uploading does not duplicate; broker edits stay', () => {
    const profile = mergeIntoRiskProfile(createEmptyRiskProfile('a1'), results);
    const first = settleLossRuns([], profile, '2026-09-20T00:00:00Z');
    expect(first.lossRuns).toHaveLength(2);
    expect(first.profile.pendingLossRuns).toBeUndefined();
    const linked = first.profile.lossHistory.filter((l) => l.lossRunId === first.lossRuns.find((r) => r.policyNumber === 'CA 04471932')!.id);
    expect(linked).toHaveLength(3);
    expect(first.profile.lossHistory.every((l) => l.lossRunKey === undefined)).toBe(true);

    // The broker corrects the carrier; the same report is uploaded again.
    const edited: LossRun[] = first.lossRuns.map((r) => ({ ...r, carrier: 'Progressive (edited)' }));
    const again = extractInsuranceFields(pdfDoc(LOSS_RUN), { documentId: 'doc2', documentName: 'copy.pdf' });
    const second = settleLossRuns(edited, mergeIntoRiskProfile(first.profile, again));
    expect(second.lossRuns).toHaveLength(2);
    expect(second.lossRuns.every((r) => r.carrier === 'Progressive (edited)')).toBe(true);
    expect(second.profile.lossHistory).toHaveLength(3);
  });
});

describe('more layouts', () => {
  const txt = (text: string, name = 'doc.txt'): RawDocument => ({ documentName: name, fileType: 'txt', text, warnings: [] });

  it('VINs outside a table: labeled or check-digit-valid only, with year/make/model from the line', async () => {
    const doc = txt(
      'COMMERCIAL AUTO DECLARATIONS\nAuto 1: 2019 KENWORTH T680 VIN 1XKYD49X9KJ123456 Stated Amount $98,500\nAuto 2: 2021 Freightliner Cascadia 1M8GDM9AXKP042788\nReference ABCDEFGH123456789\nOrder 3AKJHHDR5MSMA1234'
    );
    const vehicles = extractInsuranceFields(doc, { documentId: 'd', documentName: 'dec.txt' })
      .filter((r) => r.fieldPath === 'vehicles')
      .map((r) => r.value);
    expect(vehicles).toEqual([
      { vin: '1XKYD49X9KJ123456', year: 2019, make: 'Kenworth', model: 'T680' },
      { vin: '1M8GDM9AXKP042788', year: 2021, make: 'Freightliner', model: 'Cascadia' },
    ]);
  });

  it('scanned headers with run-together words or one misread letter still map', () => {
    const table = { headers: ['DriverName', 'DOB', 'License#', 'Safe', 'Class', 'DaleofHire'], rows: [['John A. Smith', '04/12/1979', 'S530-4471-9921', 'TX', 'A', '02/01/2019']] };
    expect(classifyTable(table.headers)).toBe('drivers');
    const [row] = mapDriverTable(table);
    expect(row.entry).toMatchObject({ name: 'John A. Smith', licenseNumber: 'S530-4471-9921', hireDate: '2019-02-01' });
    expect(row.entry.licenseState).toBeUndefined(); // "Safe" is not guessed to be "State"
  });

  it('a license in the numbered card layout: "4d DL" number and the "8" address on two lines', () => {
    const doc = txt('TEXAS DRIVER LICENSE CLASS A CDL\n4d DL 30417729 9 CLASS A\n4b EXP 04/12/2029 4a ISS 04/12/2021\n1 LN SMITH\n2 FN JOHN\n8 1402 ELM STREET\nDALLAS, TX 75201\n3 DOB 04/12/1979 15 SEX M', 'license.jpg');
    const driver = extractInsuranceFields(doc, { documentId: 'd', documentName: 'license.jpg', isImageSource: true }).find((r) => r.fieldPath === 'drivers')!.value;
    expect(driver).toMatchObject({ name: 'John Smith', licenseNumber: '30417729', licenseState: 'TX', licenseClass: 'A', address: '1402 ELM STREET, DALLAS, TX 75201', dob: '04/12/1979' });
  });

  it('a driver list is not read as one driver license', () => {
    const lines = page([
      { y: 570, cells: [[36, 'Driver Name'], [170, 'DOB'], [245, 'License #'], [345, 'State'], [390, 'Class']] },
      { y: 556, cells: [[36, 'John A. Smith'], [170, '04/12/1979'], [245, 'S530-4471-9921'], [345, 'TX'], [390, 'A']] },
      { y: 542, cells: [[36, 'Tamika Reed'], [170, '01/19/1975'], [245, 'R300-7713-5402'], [345, 'AR'], [390, 'A']] },
    ]);
    const drivers = extractInsuranceFields(pdfDoc(lines), { documentId: 'd', documentName: 'drivers.pdf' }).filter((r) => r.fieldPath === 'drivers');
    expect(drivers.map((d) => (d.value as { name?: string }).name)).toEqual(['John A. Smith', 'Tamika Reed']);
  });
});

describe('OCR noise is never read as data', () => {
  // A scanned receipt: a barcode and ruled lines under words that happen to look like a vehicle schedule's headers.
  const RECEIPT = page([
    { y: 700, cells: [[36, 'RECEIPT']], size: 14 },
    { y: 680, cells: [[36, 'Address: {=a']] },
    { y: 650, cells: [[36, 'Item'], [200, 'Make'], [320, 'Model'], [440, 'Qty']] },
    ...Array.from({ length: 8 }, (_, k) => ({ y: 636 - k * 14, cells: [[200, '|||||'], [320, 'IIII'], [440, '—']] as [number, string][] })),
  ]);

  it('adds no vehicles, fleet size or address from a receipt of barcodes', () => {
    const results = extractInsuranceFields(pdfDoc(RECEIPT, 'Receipt.pdf'), { documentId: 'd1', documentName: 'Receipt.pdf' });
    expect(results.filter((r) => r.fieldPath === 'vehicles')).toEqual([]);
    expect(results.find((r) => r.fieldPath === 'transportation.fleetSize')).toBeUndefined();
    expect(results.find((r) => r.fieldPath === 'business.address')).toBeUndefined();
  });

  it('still reads a real vehicle schedule next to a noisy cell', () => {
    const rows = mapVehicleTable({ headers: ['Year', 'Make', 'Model', 'Plate'], rows: [['2021', 'Freightliner', 'Cascadia', '|||'], ['2019', 'Kenworth', 'T680', 'ABC123'], ['', '|||||', '{=', '']] });
    expect(rows.map((r) => r.entry)).toEqual([
      { year: 2021, make: 'Freightliner', model: 'Cascadia' },
      { year: 2019, make: 'Kenworth', model: 'T680', plate: 'ABC123' },
    ]);
  });
});

describe('isReadableText', () => {
  it('tells text from OCR noise', async () => {
    const { isReadableText } = await import('../fieldExtraction/textQuality');
    for (const ok of ['A', 'TX', '2021', '$18,450.00', '(1,200)', '01/15/2025', 'N/A', '123 Main St, Dallas, TX 75201', 'O', '1111']) expect(isReadableText(ok), ok).toBe(true);
    for (const bad of ['|||||', '{=a', 'IIIII', 'lllll', '—', '-----', '', '  ', '|I|l|']) expect(isReadableText(bad), bad).toBe(false);
  });
});

describe('domicile state', () => {
  const read = (text: string) => {
    const doc: RawDocument = { documentName: 'app.pdf', fileType: 'txt', text, warnings: [] };
    return extractInsuranceFields(doc, { documentId: 'd', documentName: 'app.pdf' }).find((r) => r.fieldPath === 'business.state')?.value;
  };

  it('comes from the business address when no state is labeled', () => {
    expect(read('Named Insured: Sergey Gaponov\nMailing Address: 1200 W Lake St, Chicago, IL 60607')).toBe('IL');
    expect(read('Named Insured: Sergey Gaponov\nAddress: 1200 W Lake St, Chicago IL 60607-1234')).toBe('IL');
    expect(read('Insured Address: 45 Oak Ave, Springfield, Illinois 62701')).toBe('IL');
    expect(read('Principal Place of Business: 9 Elm Rd, Dallas, TX 75201, USA')).toBe('TX');
  });

  it('comes from a two-line address and from "City, State, Zip"', () => {
    expect(read('Address: 1200 W Lake St\nChicago, IL 60607-1234')).toBe('IL');
    expect(read('City, State, Zip: Chicago, IL 60607')).toBe('IL');
    expect(read('Base Jurisdiction: IL')).toBe('IL');
  });

  it('a labeled state wins over the address', () => {
    expect(read('Domicile State: Indiana\nMailing Address: 1200 W Lake St, Chicago, IL 60607')).toBe('IN');
  });

  it('never reads a word as a state', () => {
    expect(read('Address: 12 Walk In Way')).toBeUndefined();
    expect(read('Address: 55 Main St or nearby')).toBeUndefined();
  });
});

describe('a form read as a table is not a schedule', () => {
  it('a registration receipt gives its one vehicle, not its labels', () => {
    const rows = mapVehicleTable({
      headers: ['Year', 'Make', 'Model', 'Plate'],
      rows: [
        ['', '2015 [FRHT | TR 17000', '', '—'],
        ['', 'Color ——— Primary Brand ——— Secondary Brand ——- gf —— Use —— Prev fssue Dae', '', ''],
        ['', '| | PRIVATEfoazasatee =', '', ''],
        ['', 'Odometer Status or Vessel Manufactureror OH use ——— Engine Drive —— Hull Material', '', ''],
        ['', '| | FE 5', '', ''],
        ['', 'N COUNTRY CLUB DR APT 204', '', ''],
        ['', '33180', '', ''],
      ],
    });
    expect(rows.map((r) => r.entry)).toEqual([{ make: 'Freightliner', year: 2015 }]);
  });

  it('a license record gives its driver, not "Address:" or "Jurisdiction:"', () => {
    const rows = mapDriverTable({
      headers: ['Name', 'DOB', 'License Number'],
      rows: [
        ['Address:', 'City/State/Zip: Driver Information', ''],
        ['Jurisdiction:', '', 'REG. NUMBER:'],
        ['Speciality Code:', '', 'PHONE: ADDITIONAL MESSAGES'],
        ['Sergey A Gaponov', '07/24/1985', 'G151-781-85-264-0'],
      ],
    });
    expect(rows.map((r) => [r.entry.name, r.entry.licenseNumber])).toEqual([['Sergey A Gaponov', 'G151-781-85-264-0']]);
  });

  it('real schedules still read: "Last, First" names, numeric models, plates', () => {
    expect(mapDriverTable({ headers: ['Driver Name', 'DOB', 'CDL #'], rows: [['Reed, Tamika', '1990-02-01', 'R123456'], ["Mary-Jane O'Neil", '', '']] }).map((r) => r.entry.name)).toEqual(['Reed, Tamika', "Mary-Jane O'Neil"]);
    expect(mapVehicleTable({ headers: ['Year', 'Make', 'Model', 'Plate'], rows: [['2020', 'Peterbilt', '579', 'FL 12AB'], ['2018', 'Great Dane', 'Champion CL', '']] }).map((r) => r.entry)).toEqual([
      { year: 2020, make: 'Peterbilt', model: '579', plate: 'FL12AB' },
      { year: 2018, make: 'Great Dane', model: 'Champion CL' },
    ]);
  });
});
