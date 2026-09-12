import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { MappedApplication } from '../../types';

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK_900 = rgb(0.11, 0.13, 0.16);
const INK_600 = rgb(0.32, 0.36, 0.42);
const INK_400 = rgb(0.58, 0.62, 0.68);
const RULE = rgb(0.85, 0.87, 0.9);

// Text metrics — deliberately NOT character-count truncation. A fixed "max 42 characters" cutoff
// (the previous approach) has no relationship to how wide those 42 characters actually render in a
// proportional font, so a normal-looking value could still overflow its column and print on top of
// the adjacent column's text at the same y-coordinate — that was the actual mechanism behind the
// reported overlap, not any one specific field. Every measurement below goes through pdf-lib's own
// font.widthOfTextAtSize, so wrapping always matches what will actually be drawn.
const LABEL_SIZE = 7;
const VALUE_SIZE = 10;
const TABLE_LABEL_SIZE = 7;
const TABLE_VALUE_SIZE = 8;
const LABEL_LINE_STEP = 9;
const VALUE_LINE_STEP = 12;
const TABLE_LINE_STEP = 11;
const GAP_LABEL_VALUE = 3;
const ROW_BOTTOM_PADDING = 4;
const TABLE_ROW_BOTTOM_PADDING = 4;
// Extra breathing room subtracted from a column's raw width before wrapping — belt-and-suspenders
// on top of exact width measurement, so text never sits flush against a neighboring column even if
// a font metric is slightly optimistic.
const COLUMN_GUTTER = 14;
const TABLE_COLUMN_GUTTER = 6;

/**
 * Greedy word-wrap using the font's own metrics — returns the lines `text` needs to occupy no more
 * than `maxWidth` at `size`. A single "word" wider than `maxWidth` on its own (a long unbroken
 * token — a URL, a run-on number) is hard-broken character by character rather than left to overflow,
 * so nothing this function returns can ever render wider than `maxWidth` regardless of content.
 * Returns `['']` for empty input (not `[]`) so callers can always rely on at least one line's worth
 * of vertical space being reserved, matching the pre-wrap layout's rhythm for an empty field.
 */
function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  if (!text) return [''];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  function hardBreak(word: string): string {
    let chunk = '';
    for (const ch of word) {
      const candidate = chunk + ch;
      if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = candidate;
      }
    }
    return chunk;
  }

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      current = hardBreak(word);
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * Renders a MappedApplication as a clean, paginated PDF via pdf-lib (already a project
 * dependency, previously unused). Purely a display layer over data the mapping engine already
 * produced — no field mapping/extraction logic lives here.
 *
 * Every row (a label + its value, or a table row) computes its own height from its actual wrapped
 * line count before anything is drawn, and a row is only ever placed once it's confirmed to fit in
 * the remaining space on the current page — otherwise the WHOLE row moves to a fresh page, so a
 * label and its value (or a table row's cells) are never split across two pages. Section/table
 * headers are re-drawn at the top of a new page whenever a section or table continues onto it.
 */
export async function generateApplicationPdf(application: MappedApplication, accountName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  /** Starts a fresh page (never mid-row) and, if given, redraws whatever continuation header the caller needs at the top of it. */
  function newPage(onNewPage?: () => void) {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    onNewPage?.();
  }

  /** Guarantees `needed` points of vertical space on the current page, starting a new one first if there isn't room — the one place page-break decisions happen. */
  function ensureSpace(needed: number, onNewPage?: () => void) {
    if (y - needed < MARGIN) newPage(onNewPage);
  }

  function text(value: string, x: number, size: number, f: PDFFont, color = INK_900) {
    if (!value) return;
    page.drawText(value, { x, y, size, font: f, color });
  }

  function rule() {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.75, color: RULE });
  }

  /** Draws a pre-wrapped block of lines starting at a given top y, one line per LINE_STEP — never called for more lines than were already confirmed to fit via ensureSpace. */
  function drawLines(lines: string[], x: number, topY: number, size: number, f: PDFFont, color: typeof INK_900, lineStep: number) {
    lines.forEach((line, i) => {
      if (line) page.drawText(line, { x, y: topY - i * lineStep, size, font: f, color });
    });
  }

  // --- Header --- accountName is the named insured's own value (the same field that gets wrapped
  // in the Business Information section below), so it goes through the same wrapping as everything
  // else — an unwrapped single drawText call here would run a long company name past the page's
  // right edge, clipped rather than overlapping other text, but still a "long text" failure the same
  // fix belongs to.
  const titleLines = wrapText(bold, application.templateName, 16, CONTENT_WIDTH);
  drawLines(titleLines, MARGIN, y, 16, bold, INK_900, 19);
  y -= titleLines.length * 19 + 4;
  const accountLines = wrapText(font, accountName, 12, CONTENT_WIDTH);
  drawLines(accountLines, MARGIN, y, 12, font, INK_600, 15);
  y -= accountLines.length * 15 + 4;
  text(`Generated ${new Date(application.generatedAt).toLocaleDateString('en-US')}`, MARGIN, 8, italic, INK_400);
  y -= 10;
  rule();
  y -= 22;

  // --- Scalar sections, two columns ---
  for (const section of application.sections) {
    const colWidth = CONTENT_WIDTH / 2;
    const usableWidth = colWidth - COLUMN_GUTTER;

    function sectionHeader(titleSuffix = '') {
      text(`${section.title.toUpperCase()}${titleSuffix}`, MARGIN, 10, bold, INK_600);
      y -= 6;
      rule();
      y -= 16;
    }

    /** Wraps both fields of one visual row and returns everything needed to size and draw it. */
    function layoutRow(i: number) {
      const left = section.fields[i];
      const right = section.fields[i + 1];
      const leftLabel = left ? wrapText(font, left.targetLabel.toUpperCase(), LABEL_SIZE, usableWidth) : [];
      const rightLabel = right ? wrapText(font, right.targetLabel.toUpperCase(), LABEL_SIZE, usableWidth) : [];
      const leftValue = left?.value ? wrapText(font, left.value, VALUE_SIZE, usableWidth) : [];
      const rightValue = right?.value ? wrapText(font, right.value, VALUE_SIZE, usableWidth) : [];

      function blockHeight(labelLines: string[], valueLines: string[]) {
        const labelHeight = labelLines.length * LABEL_LINE_STEP;
        const valueHeight = valueLines.length > 0 && valueLines[0] !== '' ? GAP_LABEL_VALUE + valueLines.length * VALUE_LINE_STEP : 0;
        return labelHeight + valueHeight;
      }

      const height = Math.max(blockHeight(leftLabel, leftValue), blockHeight(rightLabel, rightValue), LABEL_LINE_STEP) + ROW_BOTTOM_PADDING;
      return { left, right, leftLabel, rightLabel, leftValue, rightValue, height };
    }

    function drawRow(row: ReturnType<typeof layoutRow>) {
      const rowTop = y;
      [
        { field: row.left, label: row.leftLabel, value: row.leftValue, x: MARGIN },
        { field: row.right, label: row.rightLabel, value: row.rightValue, x: MARGIN + colWidth },
      ].forEach(({ field, label, value, x }) => {
        if (!field) return;
        drawLines(label, x, rowTop, LABEL_SIZE, font, INK_400, LABEL_LINE_STEP);
        if (value.length > 0 && value[0] !== '') {
          const valueTop = rowTop - label.length * LABEL_LINE_STEP - GAP_LABEL_VALUE;
          drawLines(value, x, valueTop, VALUE_SIZE, font, INK_900, VALUE_LINE_STEP);
        }
      });
      y -= row.height;
    }

    // Look ahead at the first row so a section header is never left orphaned at the bottom of a
    // page with its first row pushed to the next one — if the header and its first row don't fit
    // together, both move to the new page as a unit.
    const firstRow = section.fields.length > 0 ? layoutRow(0) : null;
    const headerHeight = 6 + 16; // title line + rule + gap, matches sectionHeader()'s own offsets
    ensureSpace(headerHeight + (firstRow?.height ?? 0));
    sectionHeader();

    for (let i = 0; i < section.fields.length; i += 2) {
      const row = i === 0 && firstRow ? firstRow : layoutRow(i);
      ensureSpace(row.height, () => sectionHeader(' (CONTINUED)'));
      drawRow(row);
    }
    y -= 8;
  }

  // --- Table sections ---
  for (const table of application.tableSections) {
    const colWidth = CONTENT_WIDTH / table.columns.length;
    const usableWidth = colWidth - TABLE_COLUMN_GUTTER;

    function tableTitle(suffix = '') {
      text(`${table.title.toUpperCase()}${suffix}`, MARGIN, 10, bold, INK_600);
      y -= 6;
      rule();
      y -= 16;
    }

    function columnHeaders() {
      table.columns.forEach((col, i) => {
        const lines = wrapText(bold, col.label.toUpperCase(), TABLE_LABEL_SIZE, usableWidth);
        drawLines(lines, MARGIN + i * colWidth, y, TABLE_LABEL_SIZE, bold, INK_600, LABEL_LINE_STEP);
      });
      y -= 10;
      rule();
      y -= 14;
    }

    if (table.rows.length === 0) {
      ensureSpace(40);
      tableTitle();
      text(`No ${table.title.toLowerCase()} on file.`, MARGIN, 9, italic, INK_400);
      y -= 20;
      continue;
    }

    function layoutTableRow(rowIndex: number) {
      const row = table.rows[rowIndex];
      const cellLines = table.columns.map((col) => {
        const cell = row.cells[col.key];
        const value = cell?.status === 'missing' ? '' : (cell?.value ?? '');
        return wrapText(font, value, TABLE_VALUE_SIZE, usableWidth);
      });
      const lineCount = Math.max(1, ...cellLines.map((l) => l.length));
      const height = lineCount * TABLE_LINE_STEP + TABLE_ROW_BOTTOM_PADDING;
      return { cellLines, height };
    }

    function drawTableRow(laid: ReturnType<typeof layoutTableRow>) {
      const rowTop = y;
      laid.cellLines.forEach((lines, i) => {
        drawLines(lines, MARGIN + i * colWidth, rowTop, TABLE_VALUE_SIZE, font, INK_900, TABLE_LINE_STEP);
      });
      y -= laid.height;
    }

    const firstRow = layoutTableRow(0);
    ensureSpace(40 + 24 + firstRow.height);
    tableTitle();
    columnHeaders();

    for (let r = 0; r < table.rows.length; r++) {
      const laid = r === 0 ? firstRow : layoutTableRow(r);
      ensureSpace(laid.height, () => {
        tableTitle(' (CONTINUED)');
        columnHeaders();
      });
      drawTableRow(laid);
    }
    y -= 14;
  }

  // Deliberately no "Missing / Needs Review" section here — this exported PDF is the client-facing
  // application, not an internal QA report. That information (missing required/recommended fields,
  // conflicts, needs-review items, missing recommended documents) lives in the broker UI's
  // "What's Missing?" panel (see services/application/completeness.ts) instead.

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
