// Generates real sample submission documents for ABC Transportation LLC, used to exercise the
// real ingestion + extraction pipeline end to end. Deliberately varied labels, layouts, and a
// genuine Fleet Size conflict (questionnaire says 24, vehicle schedule only lists 3) so this
// package is a real regression test, not just a happy-path demo.
// Run with: node scripts/generate-sample-fixtures.mjs
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from 'docx';
import ExcelJS from 'exceljs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sample-fixtures');
await mkdir(outDir, { recursive: true });

async function writeOut(name, bytes) {
  await writeFile(path.join(outDir, name), bytes);
  console.log(`wrote ${name} (${bytes.length.toLocaleString('en-US')} bytes)`);
}

// ---- 1. Loss Runs PDF — repeated labeled claim blocks, not a single-line table ----
async function buildLossRunPdf() {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([612, 792]);
  let y = 740;
  const draw = (text, opts = {}) => {
    page.drawText(text, { x: opts.x ?? 50, y, size: opts.size ?? 11, font: opts.bold ? bold : font });
    y -= opts.gap ?? 18;
  };

  draw('ABC Transportation LLC', { bold: true, size: 16, gap: 22 });
  draw('Commercial Auto Loss Run', { bold: true, size: 13, gap: 24 });
  draw('Named Insured: ABC Transportation LLC');
  draw('USDOT Number: 1234567', { gap: 30 });

  draw('Claim 1', { bold: true, gap: 18 });
  draw('Date of Loss: 03/14/2023');
  draw('Claim Type: Auto Liability');
  draw('Paid: $18,400');
  draw('Reserved: $0');
  draw('Status: Closed', { gap: 30 });

  draw('Claim 2', { bold: true, gap: 18 });
  draw('Date of Loss: 01/22/2024');
  draw('Claim Type: Cargo');
  draw('Paid: $9,100');
  draw('Reserved: $2,500');
  // Incurred deliberately omitted here — extraction should compute paid + reserved.
  draw('Status: Open', { gap: 30 });

  draw('2 claims on file. No claims exceed policy limits.', { size: 10 });

  return pdfDoc.save();
}

// ---- 2. Client Questionnaire DOCX — a Label|Value table for some fields, varied-label paragraphs for the rest ----
async function buildQuestionnaireDocx() {
  const labelValue = (label, value) =>
    new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)], spacing: { after: 120 } });

  const keyValueTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      ['Company', 'ABC Transportation LLC'],
      ['Address', '4100 Freight Way, Dallas, TX 75201'],
      ['State', 'Texas'],
      ['States Operated', 'TX, OK, AR, LA'],
    ].map(([a, b]) => new TableRow({ children: [a, b].map((t) => new TableCell({ children: [new Paragraph(t)] })) })),
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Client Questionnaire — Commercial Auto Insurance', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: 'Applicant Information', heading: HeadingLevel.HEADING_2 }),
          keyValueTable,
          new Paragraph({ text: '', spacing: { before: 160 } }),
          labelValue('Legal Entity', 'Limited Liability Company'),
          labelValue('Years in Business', '11'),
          labelValue('Annual Revenue', '$5,200,000'),
          labelValue(
            'Description of Operations',
            'Long-haul dry van trucking transporting general freight for regional distributors.'
          ),
          new Paragraph({ text: 'Operations', heading: HeadingLevel.HEADING_2 }),
          labelValue('USDOT Number', '1234567'),
          labelValue('MC Number', '765432'),
          labelValue('Number of Power Units', '24'),
          labelValue('Operating Radius', '500 miles'),
          labelValue('Commodities Hauled', 'General Freight'),
          labelValue('Telematics', 'Yes'),
          labelValue('Dashcams', 'Yes'),
          labelValue('Number of Drivers', '26'),
          labelValue('Minimum Driver Age', '23'),
          labelValue('Minimum Driver Experience (years)', '2'),
          new Paragraph({ text: 'Coverage', heading: HeadingLevel.HEADING_2, spacing: { before: 200 } }),
          labelValue('Desired Coverage', 'Auto Liability, Cargo, Physical Damage'),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ---- 3. Vehicle schedule XLSX — only 3 rows (conflicts with the questionnaire's "24 power units"), with an explicit Vehicle Type column ----
async function buildVehicleScheduleXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Vehicles');
  ws.addRow(['VIN', 'Make', 'Model', 'Year', 'Value', 'Vehicle Type']);
  ws.addRow(['1FUJA6CV88LAB1234', 'Freightliner', 'Cascadia', 2021, 135000, 'Tractor']);
  ws.addRow(['1GRAA0620KB123456', 'Great Dane', 'Reefer Trailer', 2019, 42000, 'Trailer']);
  ws.addRow(['1FUJA6CV88LAB5678', 'Freightliner', 'Cascadia', 2022, 142000, 'Tractor']);
  return wb.xlsx.writeBuffer();
}

// ---- 4. Driver schedule XLSX — bare "Driver" header, experience given as "N years" strings ----
const FIRST_NAMES = ['James', 'Maria', 'Robert', 'Linda', 'Michael', 'Patricia'];
const LAST_NAMES = ['Johnson', 'Garcia', 'Williams', 'Brown', 'Martinez', 'Davis'];
const LICENSE_STATES = ['TX', 'OK', 'AR', 'LA'];
const EXPERIENCE_YEARS = [15, 8, 3, 11, 6, 2];

async function buildDriverScheduleXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Drivers');
  ws.addRow(['Driver', 'DOB', 'License State', 'Experience', 'Violations']);
  for (let i = 0; i < 6; i++) {
    const name = `${FIRST_NAMES[i]} ${LAST_NAMES[i]}`;
    const dob = `19${70 + i * 4}-0${1 + (i % 9)}-${String(10 + i).padStart(2, '0')}`;
    const state = LICENSE_STATES[i % LICENSE_STATES.length];
    const violations = i === 2 ? '1 speeding (minor)' : 'None';
    ws.addRow([name, dob, state, `${EXPERIENCE_YEARS[i]} years`, violations]);
  }
  return wb.xlsx.writeBuffer();
}

// ---- 5. Client email TXT — unstructured prose, exercises the medium-confidence fallback patterns ----
function buildClientEmailTxt() {
  return [
    'Subject: ABC Transportation - Renewal Submission Info',
    '',
    'Hi team,',
    '',
    'Following up with a few more details for our renewal. We currently run 24 trucks out of our Dallas ' +
      'terminal and haul general freight throughout TX, OK, AR, and LA within about a 500 mile radius. ' +
      'All of our trucks have telematics installed, and we also have dashcams installed fleet-wide.',
    '',
    "We've been in business for 11 years now and our revenue this past year was roughly $5.2 million.",
    '',
    'Let me know if you need anything else.',
    '',
    'Thanks,',
    'Jamie',
    'ABC Transportation LLC',
    '',
  ].join('\n');
}

const [lossRun, questionnaire, vehicles, drivers] = await Promise.all([
  buildLossRunPdf(),
  buildQuestionnaireDocx(),
  buildVehicleScheduleXlsx(),
  buildDriverScheduleXlsx(),
]);

await writeOut('ABC_Transportation_Loss_Runs.pdf', lossRun);
await writeOut('ABC_Transportation_Client_Questionnaire.docx', questionnaire);
await writeOut('ABC_Transportation_Vehicle_Schedule.xlsx', vehicles);
await writeOut('ABC_Transportation_Driver_Schedule.xlsx', drivers);
await writeFile(path.join(outDir, 'ABC_Transportation_Client_Email.txt'), buildClientEmailTxt());
console.log('wrote ABC_Transportation_Client_Email.txt');
