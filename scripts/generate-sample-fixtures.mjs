// Generates real sample submission documents for ABC Transportation LLC, used to exercise the
// real ingestion pipeline (parsePdf/parseDocx/parseSpreadsheet/parseCsv/parseText) end to end.
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

// ---- 1. Loss Runs PDF ----
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
  draw('Commercial Auto Loss Run — 5 Year History', { bold: true, size: 13, gap: 24 });
  draw('Named Insured: ABC Transportation LLC');
  draw('USDOT Number: 1234567');
  draw('MC Number: 765432');
  draw('Report Date: 2026-06-30', { gap: 30 });

  draw('Date          Claim Type          Status    Paid        Reserve     Incurred', { bold: true, gap: 20 });
  const rows = [
    ['03/14/2023', 'Auto Liability', 'Closed', '18,400', '0', '18,400'],
    ['09/02/2023', 'Cargo', 'Closed', '6,750', '0', '6,750'],
    ['01/22/2024', 'Auto Liability', 'Open', '32,000', '10,000', '42,000'],
    ['11/08/2024', 'Physical Damage', 'Closed', '4,200', '0', '4,200'],
    ['06/30/2025', 'Cargo', 'Open', '9,100', '2,500', '11,600'],
  ];
  for (const [date, type, status, paid, reserve, incurred] of rows) {
    const line = `${date}    ${type.padEnd(18)}  ${status.padEnd(8)}  $${paid.padEnd(10)}  $${reserve.padEnd(10)}  $${incurred}`;
    draw(line, { gap: 18 });
  }

  y -= 12;
  draw('5-year loss summary: 5 claims, 2 open, 3 closed. No claims exceed policy limits.', { size: 10, gap: 16 });

  return pdfDoc.save();
}

// ---- 2. Client Questionnaire DOCX ----
async function buildQuestionnaireDocx() {
  const labelValue = (label, value) =>
    new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)], spacing: { after: 120 } });

  const coverageTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: ['Coverage', 'Requested Limit'].map(
          (t) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })] })
        ),
      }),
      ...[
        ['Auto Liability', '1,000,000'],
        ['Motor Truck Cargo', '100,000'],
        ['Physical Damage', '250,000'],
        ['General Liability', '1,000,000'],
      ].map(
        ([a, b]) =>
          new TableRow({ children: [a, b].map((t) => new TableCell({ children: [new Paragraph(t)] })) })
      ),
    ],
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Client Questionnaire — Commercial Auto Insurance', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: 'Applicant Information', heading: HeadingLevel.HEADING_2 }),
          labelValue('Named Insured', 'ABC Transportation LLC'),
          labelValue('Legal Entity', 'Limited Liability Company'),
          labelValue('Mailing Address', '4100 Freight Way, Dallas, TX 75201'),
          labelValue('Domicile State', 'TX'),
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
          labelValue('States of Operation', 'TX, OK, AR, LA'),
          labelValue('Operating Radius', '500 miles'),
          labelValue('Commodities Hauled', 'General Freight'),
          labelValue('Telematics', 'Yes'),
          labelValue('Dashcams', 'Yes'),
          labelValue('Number of Drivers', '26'),
          labelValue('Minimum Driver Age', '23'),
          labelValue('Minimum Driver Experience (years)', '2'),
          new Paragraph({ text: 'Coverage Requested', heading: HeadingLevel.HEADING_2, spacing: { before: 200 } }),
          coverageTable,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ---- 3 & 4. Vehicle / Driver schedule XLSX ----
const MAKES_MODELS = [
  ['Freightliner', 'Cascadia'],
  ['Peterbilt', '579'],
  ['Kenworth', 'T680'],
  ['Volvo', 'VNL'],
  ['International', 'LT'],
  ['Mack', 'Anthem'],
];

function vin(i) {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  let s = `1FUJ${String(i).padStart(4, '0')}`;
  while (s.length < 17) s += chars[(i * 7 + s.length * 13) % chars.length];
  return s.slice(0, 17).toUpperCase();
}

async function buildVehicleScheduleXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Vehicles');
  ws.addRow(['VIN', 'Make', 'Model', 'Year', 'Value']);
  for (let i = 1; i <= 24; i++) {
    const [make, model] = MAKES_MODELS[i % MAKES_MODELS.length];
    const year = 2018 + (i % 8);
    const value = 95000 + (i % 6) * 12500;
    ws.addRow([vin(i), make, model, year, value]);
  }
  return wb.xlsx.writeBuffer();
}

const FIRST_NAMES = ['James', 'Maria', 'Robert', 'Linda', 'Michael', 'Patricia', 'David', 'Jennifer', 'Carlos', 'Susan', 'Kevin', 'Angela', 'Brian', 'Nicole'];
const LAST_NAMES = ['Johnson', 'Garcia', 'Williams', 'Brown', 'Martinez', 'Davis', 'Rodriguez', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas'];
const LICENSE_STATES = ['TX', 'OK', 'AR', 'LA'];

async function buildDriverScheduleXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Drivers');
  ws.addRow(['Driver Name', 'DOB', 'License State', 'Years Experience', 'Violations']);
  for (let i = 1; i <= 26; i++) {
    const name = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[i % LAST_NAMES.length]}`;
    const dob = `19${70 + (i % 30)}-0${1 + (i % 9)}-${String(10 + (i % 18)).padStart(2, '0')}`;
    const state = LICENSE_STATES[i % LICENSE_STATES.length];
    const years = 2 + (i % 15);
    const violations = i % 7 === 0 ? '1 speeding (minor)' : 'None';
    ws.addRow([name, dob, state, years, violations]);
  }
  return wb.xlsx.writeBuffer();
}

// ---- 5. Client email TXT ----
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
    "We've been in business for 11 years now and our revenue this past year was roughly $5.2 million. " +
      'Our USDOT number is 1234567 and MC number is 765432.',
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
