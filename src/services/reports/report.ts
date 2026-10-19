/**
 * Analytics reports as files: one description of a table (title, the filters it was made with, columns,
 * rows, a totals row) turned into CSV, Excel or PDF. The rows are exactly what's on screen — the
 * filtered list — so a download never shows more than the filters do. Money is kept in cents until the
 * file is written. Built in the browser; nothing is uploaded.
 */

export type ColumnKind = 'text' | 'money' | 'date' | 'count';

export interface ReportColumn {
  header: string;
  kind?: ColumnKind;
}

/** Money cells are cents; dates are YYYY-MM-DD; null is an empty cell. */
export type Cell = string | number | null;

export interface Report {
  title: string;
  /** One line each: the period, the filters, who it's for. */
  subtitle: string[];
  columns: ReportColumn[];
  rows: Cell[][];
  totals?: Cell[];
  /** File name without extension. */
  fileBase: string;
}

export type ReportFormat = 'csv' | 'xlsx' | 'pdf';
export const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' };

const plainCents = (c: number) => (c / 100).toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function plainCell(col: ReportColumn, v: Cell): string {
  if (v === null || v === '') return '';
  if (col.kind === 'money' && typeof v === 'number') return plainCents(v);
  return String(v);
}

/** The table as CSV: a header row, the rows, then the totals row. Amounts as plain numbers (negatives with a minus). */
export function reportCsv(r: Report): string {
  const lines = [r.columns.map((c) => c.header), ...r.rows.map((row) => r.columns.map((c, i) => plainCell(c, row[i] ?? null))), ...(r.totals ? [r.columns.map((c, i) => plainCell(c, r.totals![i] ?? null))] : [])];
  return lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
}

/** "Oct 7, 2026" for the files' readable dates. */
const readableDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const money = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function displayCell(col: ReportColumn, v: Cell): string {
  if (v === null || v === '') return '';
  if (col.kind === 'money' && typeof v === 'number') return money(v);
  if (col.kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return readableDate(v);
  return String(v);
}

/** The table as an Excel workbook: title and filters on top, a bold header (frozen), real numbers and dates. */
export async function reportXlsx(r: Report): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  for (const line of r.subtitle) ws.addRow([line]).font = { color: { argb: 'FF555555' } };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F6' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD2DB' } } };
  });
  ws.views = [{ state: 'frozen', ySplit: header.number }];
  const value = (c: ReportColumn, v: Cell): string | number | Date | null => {
    if (v === null || v === '') return null;
    if (c.kind === 'money' && typeof v === 'number') return v / 100;
    if (c.kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    }
    return v;
  };
  const add = (cells: Cell[], bold = false) => {
    const row = ws.addRow(r.columns.map((c, i) => value(c, cells[i] ?? null)));
    if (bold) row.font = { bold: true };
  };
  for (const row of r.rows) add(row);
  if (r.totals) add(r.totals, true);
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.kind === 'money') col.numFmt = '#,##0.00;[Red]-#,##0.00';
    if (c.kind === 'date') col.numFmt = 'yyyy-mm-dd';
    const longest = Math.max(c.header.length, ...r.rows.map((row) => displayCell(c, row[i] ?? null).length));
    col.width = Math.min(48, Math.max(10, longest + 2));
  });
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** The standard PDF fonts only have the Windows-1252 characters: map the few others the app uses, drop the rest. */
const WINANSI_EXTRA = new Set('‘’“”–—•…€'.split(''));
export function pdfSafe(text: string): string {
  return text
    .replace(/−/g, '-')
    .replace(/→/g, '->')
    .replace(/[   ]/g, ' ')
    .split('')
    .map((ch) => (ch.charCodeAt(0) <= 0xff || WINANSI_EXTRA.has(ch) ? ch : '?'))
    .join('');
}

/** The table as a landscape PDF: title, filters, a header repeated on every page, totals last, page numbers. */
export async function reportPdf(r: Report): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(r.title));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 792;
  const H = 612;
  const M = 36;
  const size = 8;
  const rowH = 14;
  const cells = [r.columns.map((c) => c.header), ...r.rows.map((row) => r.columns.map((c, i) => pdfSafe(displayCell(c, row[i] ?? null)))), ...(r.totals ? [r.columns.map((c, i) => pdfSafe(displayCell(c, r.totals![i] ?? null)))] : [])];
  // Column widths from the content, scaled to the page; long text is cut with an ellipsis.
  const natural = r.columns.map((_, i) => Math.min(220, Math.max(40, ...cells.map((row) => bold.widthOfTextAtSize(row[i] ?? '', size) + 10))));
  const scale = Math.min(1, (W - 2 * M) / natural.reduce((a, b) => a + b, 0));
  const widths = natural.map((w) => w * scale);
  const fit = (text: string, f: typeof font, width: number) => {
    if (f.widthOfTextAtSize(text, size) <= width) return text;
    let t = text;
    while (t.length > 1 && f.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
    return `${t}...`;
  };
  const pages: ReturnType<typeof doc.addPage>[] = [];
  let page = doc.addPage([W, H]);
  pages.push(page);
  let y = H - M;
  page.drawText(pdfSafe(r.title), { x: M, y: y - 14, size: 14, font: bold, color: rgb(0.1, 0.12, 0.16) });
  y -= 22;
  for (const line of r.subtitle) {
    page.drawText(fit(pdfSafe(line), font, W - 2 * M), { x: M, y: y - 10, size: 9, font, color: rgb(0.35, 0.38, 0.42) });
    y -= 13;
  }
  y -= 6;
  const drawRow = (row: string[], f: typeof font, shade: boolean) => {
    if (shade) page.drawRectangle({ x: M, y: y - rowH + 3, width: W - 2 * M, height: rowH, color: rgb(0.94, 0.95, 0.97) });
    let x = M;
    row.forEach((text, i) => {
      const width = widths[i] - 8;
      const t = fit(text, f, width);
      const right = r.columns[i].kind === 'money' || r.columns[i].kind === 'count';
      const tx = right ? x + widths[i] - 4 - f.widthOfTextAtSize(t, size) : x + 4;
      page.drawText(t, { x: tx, y: y - rowH + 7, size, font: f, color: rgb(0.12, 0.14, 0.18) });
      x += widths[i];
    });
    y -= rowH;
  };
  const header = cells[0];
  drawRow(header, bold, true);
  const body = cells.slice(1);
  body.forEach((row, n) => {
    if (y - rowH < M + 14) {
      page = doc.addPage([W, H]);
      pages.push(page);
      y = H - M;
      drawRow(header, bold, true);
    }
    const isTotal = !!r.totals && n === body.length - 1;
    if (isTotal) page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.6, color: rgb(0.6, 0.63, 0.68) });
    drawRow(row, isTotal ? bold : font, false);
  });
  if (!body.length) page.drawText('Nothing matches these filters.', { x: M + 4, y: y - 12, size: 9, font, color: rgb(0.4, 0.42, 0.46) });
  const made = `Made ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
  pages.forEach((p, i) => p.drawText(pdfSafe(`${made} · Page ${i + 1} of ${pages.length}`), { x: M, y: M - 18, size: 7.5, font, color: rgb(0.45, 0.48, 0.52) }));
  const bytes = await doc.save();
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadReport(r: Report, format: ReportFormat): Promise<void> {
  if (format === 'csv') return downloadBlob(`${r.fileBase}.csv`, new Blob([reportCsv(r)], { type: 'text/csv;charset=utf-8' }));
  if (format === 'xlsx') return downloadBlob(`${r.fileBase}.xlsx`, await reportXlsx(r));
  return downloadBlob(`${r.fileBase}.pdf`, await reportPdf(r));
}
