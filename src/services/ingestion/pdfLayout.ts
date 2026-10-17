import type { RawTable } from './types';

/**
 * Rebuilds a PDF page's layout from pdf.js's positioned text pieces: lines (by vertical position),
 * cells within a line (by the gaps between pieces), and tables (a header line followed by rows whose
 * cells sit under its columns). pdf.js alone only gives a stream of text, so a driver list, vehicle
 * schedule or loss run laid out as a table came through as one long run of words per line, with no
 * way to tell which value belonged to which column.
 *
 * Pure (no pdf.js), so it can be tested with hand-built pieces.
 */

export interface PdfTextPiece {
  str: string;
  /** Left edge, in PDF units. */
  x: number;
  /** Baseline, in PDF units (grows upwards). */
  y: number;
  width: number;
  /** Font height. */
  height: number;
}

export interface LayoutCell {
  text: string;
  x0: number;
  x1: number;
}

export interface LayoutLine {
  page: number;
  y: number;
  height: number;
  cells: LayoutCell[];
}

/** Decides which lines are table headers — the caller knows the domain (see classifyTable). */
export type HeaderTest = (headers: string[]) => boolean;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Groups pieces into lines (top to bottom) and each line into cells (left to right). */
export function buildLines(pieces: PdfTextPiece[], page: number): LayoutLine[] {
  const items = pieces.filter((p) => p.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; height: number; items: PdfTextPiece[] }[] = [];
  for (const it of items) {
    const h = it.height || 10;
    const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.height, h) * 0.45));
    if (line) {
      line.items.push(it);
      line.height = Math.max(line.height, h);
    } else lines.push({ y: it.y, height: h, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map((l) => {
    const sorted = [...l.items].sort((a, b) => a.x - b.x);
    const cells: LayoutCell[] = [];
    for (const it of sorted) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.x1 : Infinity;
      // More than about one character's width apart = a new cell (a column gap), not a word space.
      if (last && gap < Math.max(2.5, l.height * 0.55)) {
        last.text = clean(`${last.text}${gap > l.height * 0.12 ? ' ' : ''}${it.str}`);
        last.x1 = Math.max(last.x1, it.x + it.width);
      } else cells.push({ text: clean(it.str), x0: it.x, x1: it.x + it.width });
    }
    return { page, y: l.y, height: l.height, cells: cells.filter((c) => c.text) };
  });
}

const isNumericCell = (t: string) => /^[($-]*\$?\s*[\d,]+(?:\.\d+)?\)?$/.test(t.trim());
const LABEL_CELL = /[:：]$/;

/**
 * The text of one line for the label/value patterns. "Insured: ABC LLC   Agent: Smith Agency" on one
 * printed line becomes two lines, so a value never swallows the next label and its value; so does
 * "Progressive Casualty Insurance Company   Valuation Date: 09/15/2026".
 */
export function lineTexts(line: LayoutLine): string[] {
  const { cells } = line;
  const labelIdx = cells.map((c, i) => (LABEL_CELL.test(c.text) || /^[^:]{2,40}:\s+\S/.test(c.text) ? i : -1)).filter((i) => i >= 0);
  // No label, or one label that starts the line: the line as printed.
  if (labelIdx.length === 0 || (labelIdx.length === 1 && labelIdx[0] === 0)) return [cells.map((c) => c.text).join('  ')];
  const out: string[] = [];
  const starts = labelIdx[0] === 0 ? labelIdx : [0, ...labelIdx];
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : cells.length;
    out.push(
      cells
        .slice(s, end)
        .map((c) => c.text)
        .join(' ')
    );
  });
  return out;
}

interface Column {
  header: string;
  x0: number;
  x1: number;
}

function columnFor(cell: LayoutCell, cols: Column[]): number {
  let best = -1;
  let bestOverlap = 0;
  cols.forEach((c, i) => {
    const overlap = Math.min(cell.x1, c.x1) - Math.max(cell.x0, c.x0);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = i;
    }
  });
  if (best !== -1) return best;
  // No overlap with any header: text starts under its header (left-aligned), numbers end under it.
  const numeric = isNumericCell(cell.text);
  let bestDist = Infinity;
  cols.forEach((c, i) => {
    const d = numeric ? Math.abs(cell.x1 - c.x1) : Math.abs(cell.x0 - c.x0);
    const center = Math.abs((cell.x0 + cell.x1) / 2 - (c.x0 + c.x1) / 2);
    const dist = Math.min(d, center);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

/** Two header lines ("Date of" / "Loss") printed as one column heading. */
function mergeHeaderLines(a: LayoutLine, b: LayoutLine): LayoutCell[] {
  const cells = a.cells.map((c) => ({ ...c }));
  for (const bc of b.cells) {
    const target = cells.find((c) => Math.min(c.x1, bc.x1) - Math.max(c.x0, bc.x0) > 0 || Math.abs(c.x0 - bc.x0) < 4);
    if (target) {
      target.text = clean(`${target.text} ${bc.text}`);
      target.x0 = Math.min(target.x0, bc.x0);
      target.x1 = Math.max(target.x1, bc.x1);
    } else cells.push({ ...bc });
  }
  return cells.sort((x, y) => x.x0 - y.x0);
}

export interface LayoutTable extends RawTable {
  /** Index (in the document's line list) of the header line, and of each row's first line. */
  headerLine: number;
  rowLines: number[];
  /** A "Total…" line right under the rows, split into the same columns. */
  totals?: string[];
  totalsLine?: number;
  page: number;
}

/**
 * Finds tables in a document's lines (all pages, in reading order). A table starts at a line the
 * caller recognises as a header (3+ cells), and its rows are the lines below whose cells fall under
 * its columns. A line with a value only in one text column continues the previous row (a wrapped
 * description). It ends at a "Total" line, a new label line or heading, or a large vertical gap.
 */
export function findTables(lines: LayoutLine[], isHeader: HeaderTest): LayoutTable[] {
  const tables: LayoutTable[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let headerCells: LayoutCell[] | null = null;
    let headerSpan = 1;
    if (line.cells.length >= 3 && isHeader(line.cells.map((c) => c.text))) headerCells = line.cells;
    else if (i + 1 < lines.length && line.page === lines[i + 1].page && line.cells.length >= 2 && lines[i + 1].cells.length >= 1 && line.y - lines[i + 1].y < line.height * 1.6) {
      const merged = mergeHeaderLines(line, lines[i + 1]);
      if (merged.length >= 3 && !merged.some((c) => isNumericCell(c.text)) && isHeader(merged.map((c) => c.text))) {
        headerCells = merged;
        headerSpan = 2;
      }
    }
    if (!headerCells) {
      i++;
      continue;
    }

    const cols: Column[] = headerCells.map((c) => ({ header: c.text, x0: c.x0, x1: c.x1 }));
    const rows: string[][] = [];
    const rowLines: number[] = [];
    let totals: string[] | undefined;
    let totalsLine: number | undefined;
    let prevY = lines[i + headerSpan - 1].y;
    const gaps: number[] = [];
    let j = i + headerSpan;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.page !== line.page) break;
      const gap = prevY - l.y;
      const typical = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : l.height * 1.6;
      if (gap > Math.max(typical * 2.6, l.height * 3.2)) break;
      const texts = l.cells.map((c) => c.text);
      if (/^(?:policy\s+)?(?:grand\s+)?totals?\b/i.test(texts[0] ?? '')) {
        totals = new Array(cols.length).fill('');
        for (const c of l.cells) {
          const k = columnFor(c, cols);
          if (k >= 0) totals[k] = clean(`${totals[k]} ${c.text}`);
        }
        totalsLine = j;
        j++;
        break;
      }
      if (l.cells.length >= 3 && isHeader(texts)) break; // another table starts
      if (l.cells.length <= 2 && l.cells.some((c) => LABEL_CELL.test(c.text) || /^[^:]{2,40}:\s/.test(c.text))) break; // a label line — back to the form
      const row: string[] = new Array(cols.length).fill('');
      for (const c of l.cells) {
        const k = columnFor(c, cols);
        if (k >= 0) row[k] = clean(`${row[k]} ${c.text}`);
      }
      const filled = row.filter(Boolean).length;
      if (filled === 0) continue;
      if (filled === 1 && rows.length > 0 && !row.some((v) => v && isNumericCell(v))) {
        const k = row.findIndex(Boolean);
        rows[rows.length - 1][k] = clean(`${rows[rows.length - 1][k]} ${row[k]}`);
      } else if (filled >= 2) {
        rows.push(row);
        rowLines.push(j);
      } else if (rows.length === 0) {
        break; // a lone value right under the header — not a table
      } else continue;
      gaps.push(gap);
      prevY = l.y;
    }
    if (rows.length > 0) {
      tables.push({ headers: cols.map((c) => c.header), rows, headerLine: i, rowLines, totals, totalsLine, page: line.page, sheetName: `Page ${line.page}` });
      i = j;
    } else i += headerSpan;
  }
  return tables;
}
