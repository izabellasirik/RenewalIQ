import ExcelJS from 'exceljs';
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

/** Reads every sheet of an XLSX/XLS workbook, preserving headers (first non-empty row) and data rows. */
export async function parseSpreadsheet(file: File): Promise<RawDocument> {
  const warnings: string[] = [];
  const arrayBuffer = await file.arrayBuffer();

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(arrayBuffer);
  } catch (err) {
    warnings.push(`Could not read this spreadsheet: ${err instanceof Error ? err.message : 'unknown error'}.`);
    return { documentName: file.name, fileType: 'xlsx', text: '', tables: [], warnings };
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
