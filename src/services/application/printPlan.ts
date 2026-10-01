import type { MappedApplication, MappedField, MappedTableRow, MappedTableSection } from '../../types';

/**
 * What the downloaded application contains — the ONE place that decides it. The PDF, the CSV and the
 * on-screen "Review Application" preview all read this, so what the broker reviews is exactly what
 * gets printed.
 *
 * Only real data is printed: a field with no value, an unresolved conflict (never guessed) or a
 * broker-only placeholder ("Requested — limit not specified") gets no row on the application; a
 * section with nothing printed is left out; an itemized table drops columns empty on every row and
 * rows with nothing in them, and is left out when nothing remains.
 */

/** Whether this field gets a row on the exported application. */
export function fieldPrints(f: MappedField): boolean {
  return f.status !== 'missing' && !f.isPlaceholder && !!f.value?.trim();
}

function cellPrints(row: MappedTableRow, key: string): boolean {
  return row.cells[key]?.status !== 'missing' && !!row.cells[key]?.value?.trim();
}

export type OmittedReason = 'missing' | 'conflict' | 'placeholder';

export interface PlannedField {
  field: MappedField;
  prints: boolean;
  /** Why it isn't printed (only when prints is false). */
  omittedReason?: OmittedReason;
}

export interface PlannedSection {
  title: string;
  /** Every template field, in template order, with whether it prints. */
  fields: PlannedField[];
  /** The fields that print, in order — exactly what the PDF/CSV lay out. */
  printed: MappedField[];
}

export interface PlannedTable {
  title: string;
  /** Columns that print (have data on at least one row). */
  columns: MappedTableSection['columns'];
  /** Template columns left off because no row has data in them. */
  omittedColumns: MappedTableSection['columns'];
  /** Rows that print (data in at least one printed column). */
  rows: MappedTableRow[];
  /** Whether the table appears on the application at all. */
  prints: boolean;
}

/** Printed under Loss History when there are loss run reports but no itemized claims. */
export interface PlannedLossRuns {
  title: string;
  /** "No losses recorded" — only when no report states a claim. */
  statement: string | null;
  reports: { fields: { label: string; value: string }[] }[];
}

export interface ApplicationPrintPlan {
  sections: PlannedSection[];
  tables: PlannedTable[];
  lossRuns: PlannedLossRuns | null;
}

function omittedReason(f: MappedField): OmittedReason {
  if (f.status === 'conflict') return 'conflict';
  if (f.isPlaceholder) return 'placeholder';
  return 'missing';
}

export function buildApplicationPrintPlan(application: MappedApplication): ApplicationPrintPlan {
  const sections = application.sections.map((section) => {
    const fields = section.fields.map((field) => (fieldPrints(field) ? { field, prints: true } : { field, prints: false, omittedReason: omittedReason(field) }));
    return { title: section.title, fields, printed: fields.filter((f) => f.prints).map((f) => f.field) };
  });
  const tables = application.tableSections.map((table) => {
    const columns = table.columns.filter((col) => table.rows.some((row) => cellPrints(row, col.key)));
    const rows = table.rows.filter((row) => columns.some((col) => cellPrints(row, col.key)));
    return {
      title: table.title,
      columns,
      omittedColumns: table.columns.filter((col) => !columns.includes(col)),
      rows,
      prints: columns.length > 0 && rows.length > 0,
    };
  });
  const summary = application.lossRunSummary;
  const lossRuns: PlannedLossRuns | null =
    summary && (summary.noLossesRecorded || summary.reports.length > 0)
      ? { title: 'Loss History', statement: summary.noLossesRecorded ? 'No losses recorded' : null, reports: summary.reports }
      : null;
  return { sections, tables, lossRuns };
}

/** A table cell exactly as printed ('' when the row has nothing in that column). */
export function printedCellValue(row: MappedTableRow, key: string): string {
  return cellPrints(row, key) ? row.cells[key]!.value : '';
}
