import Papa from 'papaparse';
import type { RawDocument, RawTable } from './types';

/** Parses a CSV file into a single table (headers = first row). */
export async function parseCsv(file: File): Promise<RawDocument> {
  const warnings: string[] = [];
  const text = await file.text();

  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  if (result.errors.length > 0) {
    warnings.push(`Encountered ${result.errors.length} parsing issue${result.errors.length === 1 ? '' : 's'} in this CSV.`);
  }

  const rows = result.data;
  if (rows.length === 0) {
    warnings.push('No rows found in this CSV.');
    return { documentName: file.name, fileType: 'csv', text, tables: [], warnings };
  }

  const [headers, ...dataRows] = rows;
  const tables: RawTable[] = [{ headers, rows: dataRows }];

  return { documentName: file.name, fileType: 'csv', text, tables, warnings };
}
