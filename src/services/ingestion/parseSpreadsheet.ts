import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { RawDocument, RawTable } from './types';

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
    if ('result' in value) return String(value.result ?? '');
  }
  return String(value);
}

/**
 * Some spreadsheet generators emit every OOXML element under a single namespace prefix (e.g.
 * `<x:workbook>`, `<x:sheetData>`) instead of the unprefixed convention every major writer (Excel,
 * Google Sheets, LibreOffice) uses. exceljs's parser matches element tag names literally
 * ('workbook', not 'x:workbook'), so a prefixed file silently parses to zero sheets and load()
 * throws. This repairs the zip by stripping element-name namespace prefixes — never touching
 * attributes, so relationship ids like `r:id` are preserved — and returns a buffer worth retrying.
 * `xl/theme/*.xml` is skipped: exceljs stores that part raw rather than parsing it, and its `a:`
 * prefix is the standard drawingml convention, not the bug this works around.
 */
async function repairPrefixedWorkbookXml(buffer: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    let changed = false;
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !name.endsWith('.xml') || name.startsWith('xl/theme/')) continue;
      const content = await entry.async('string');
      const stripped = content.replace(/<(\/?)[a-zA-Z_][\w.-]*:/g, '<$1');
      if (stripped !== content) {
        zip.file(name, stripped);
        changed = true;
      }
    }
    if (!changed) return null;
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch {
    return null;
  }
}

/** Reads every sheet of an XLSX/XLS workbook, preserving headers (first non-empty row) and data rows. */
export async function parseSpreadsheet(file: File): Promise<RawDocument> {
  const warnings: string[] = [];
  const arrayBuffer = await file.arrayBuffer();

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(arrayBuffer);
  } catch (err) {
    const repaired = await repairPrefixedWorkbookXml(arrayBuffer);
    try {
      if (!repaired) throw err;
      await workbook.xlsx.load(repaired);
    } catch {
      warnings.push(`Could not read this spreadsheet: ${err instanceof Error ? err.message : 'unknown error'}.`);
      return { documentName: file.name, fileType: 'xlsx', text: '', tables: [], warnings };
    }
  }

  const tables: RawTable[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1);
      rows.push(values.map(cellToString));
    });
    const [headers, ...dataRows] = rows;
    if (!headers || headers.every((h) => h === '')) return;
    tables.push({ sheetName: sheet.name, headers, rows: dataRows });
  });

  if (tables.length === 0) {
    warnings.push('No data found in this spreadsheet.');
  }

  const text = tables.map((t) => `${t.sheetName}\n${t.headers.join(', ')}\n${t.rows.map((r) => r.join(', ')).join('\n')}`).join('\n\n');

  return { documentName: file.name, fileType: 'xlsx', text, tables, warnings };
}
