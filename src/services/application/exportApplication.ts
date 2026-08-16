import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { MappedApplication } from '../../types';

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK_900 = rgb(0.11, 0.13, 0.16);
const INK_600 = rgb(0.32, 0.36, 0.42);
const INK_400 = rgb(0.58, 0.62, 0.68);
const RULE = rgb(0.85, 0.87, 0.9);

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Renders a MappedApplication as a clean, paginated PDF via pdf-lib (already a project
 * dependency, previously unused). Purely a display layer over data the mapping engine already
 * produced — no field mapping/extraction logic lives here.
 */
export async function generateApplicationPdf(application: MappedApplication, accountName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function text(value: string, x: number, size: number, f: typeof font, color = INK_900) {
    page.drawText(value, { x, y, size, font: f, color });
  }

  function rule() {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.75, color: RULE });
  }

  // --- Header ---
  text(application.templateName, MARGIN, 16, bold);
  y -= 20;
  text(accountName, MARGIN, 12, font, INK_600);
  y -= 16;
  text(`Generated ${new Date(application.generatedAt).toLocaleDateString('en-US')} · Demo template — not a certified/regulatory form`, MARGIN, 8, italic, INK_400);
  y -= 10;
  rule();
  y -= 22;

  // --- Scalar sections, two columns ---
  for (const section of application.sections) {
    ensureSpace(30);
    text(section.title.toUpperCase(), MARGIN, 10, bold, INK_600);
    y -= 6;
    rule();
    y -= 16;

    const colWidth = CONTENT_WIDTH / 2;
    for (let i = 0; i < section.fields.length; i += 2) {
      ensureSpace(30);
      const rowY = y;
      for (let c = 0; c < 2; c++) {
        const field = section.fields[i + c];
        if (!field) continue;
        const x = MARGIN + c * colWidth;
        page.drawText(field.targetLabel.toUpperCase(), { x, y: rowY, size: 7, font, color: INK_400 });
        const display = field.value || (field.status === 'missing' ? 'Not provided' : '');
        page.drawText(truncate(display || '—', 42), { x, y: rowY - 12, size: 10, font, color: field.value ? INK_900 : INK_400 });
      }
      y -= 28;
    }
    y -= 8;
  }

  // --- Table sections ---
  for (const table of application.tableSections) {
    ensureSpace(40);
    text(table.title.toUpperCase(), MARGIN, 10, bold, INK_600);
    y -= 6;
    rule();
    y -= 16;

    if (table.rows.length === 0) {
      text(`No ${table.title.toLowerCase()} on file.`, MARGIN, 9, italic, INK_400);
      y -= 20;
      continue;
    }

    const colWidth = CONTENT_WIDTH / table.columns.length;
    ensureSpace(20);
    table.columns.forEach((col, i) => {
      page.drawText(truncate(col.label, 16), { x: MARGIN + i * colWidth, y, size: 7, font: bold, color: INK_600 });
    });
    y -= 10;
    rule();
    y -= 14;

    for (const row of table.rows) {
      ensureSpace(16);
      table.columns.forEach((col, i) => {
        const cell = row.cells[col.key];
        const display = cell?.status === 'missing' ? '—' : truncate(cell?.value ?? '', 16);
        page.drawText(display, { x: MARGIN + i * colWidth, y, size: 8, font, color: cell?.status === 'missing' ? INK_400 : INK_900 });
      });
      y -= 14;
    }
    y -= 14;
  }

  // --- Missing / Needs Review ---
  const flaggedFields = application.sections.flatMap((section) =>
    section.fields.filter((f) => f.status === 'missing' || f.status === 'conflict' || f.status === 'needs_review').map((f) => ({ label: f.targetLabel, text: `${f.targetLabel}: ${f.reviewReason ?? 'Needs review.'}` }))
  );
  // Submission-quality warnings restate some of the same facts a flagged field already covers
  // (e.g. "MC Number is missing" vs. the MC Number field's own reviewReason) — only the ones that
  // add information no field above already carries (fleet/vehicle-count conflicts, a missing
  // vehicle schedule) are worth a second line.
  const warningsNotAlreadyFlagged = application.warnings.filter((w) => !flaggedFields.some((f) => w.includes(f.label)));
  const reviewItems = [...flaggedFields.map((f) => f.text), ...warningsNotAlreadyFlagged];

  if (reviewItems.length > 0) {
    ensureSpace(30);
    text('MISSING / NEEDS REVIEW', MARGIN, 10, bold, INK_600);
    y -= 6;
    rule();
    y -= 16;

    for (const item of reviewItems) {
      ensureSpace(14);
      page.drawText('•', { x: MARGIN, y, size: 8, font, color: INK_600 });
      page.drawText(truncate(item, 100), { x: MARGIN + 10, y, size: 8, font, color: INK_900 });
      y -= 14;
    }
  }

  return doc.save();
}

export function generateApplicationJson(application: MappedApplication): string {
  return JSON.stringify(application, null, 2);
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Flat CSV — one row per scalar field, plus one row per itemized cell — for debugging/testing, not intended as the primary deliverable. */
export function generateApplicationCsv(application: MappedApplication): string {
  const rows: string[][] = [['Section', 'Field', 'Value', 'Status']];

  for (const section of application.sections) {
    for (const field of section.fields) {
      rows.push([section.title, field.targetLabel, field.value, field.status]);
    }
  }

  for (const table of application.tableSections) {
    table.rows.forEach((row, i) => {
      for (const col of table.columns) {
        const cell = row.cells[col.key];
        rows.push([table.title, `Row ${i + 1} — ${col.label}`, cell?.value ?? '', cell?.status ?? 'missing']);
      }
    });
  }

  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}
