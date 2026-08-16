import type { Confidence, FieldSource } from './common';
import type { FieldPath } from './extraction';

// ---- Template definition: pure data describing a target carrier/MGA application ----

export interface FieldMapping {
  targetFieldId: string;
  targetLabel: string;
  /**
   * Dot-path into RiskProfile, e.g. "business.namedInsured", "coverage.auto_liability.requestedLimit".
   * Omitted for fields the Risk Profile has no equivalent for yet (e.g. DBA, FEIN, City, ZIP) —
   * those fields are honestly reported as missing/"enter manually" rather than guessed, and adding
   * a real source for them later is a template/RiskProfile change, not something this layer invents.
   */
  riskProfilePath?: FieldPath;
  /** Custom formatter; defaults to a generic display formatter (join arrays, Yes/No booleans, thousands separators). */
  format?: (value: unknown) => string;
  /** Minimum confidence to present as reliable; below this the field is flagged for review. Defaults to 'medium'. */
  minConfidence?: Confidence;
  editable?: boolean;
  /** Purely informational — surfaced in the UI, doesn't block export. */
  required?: boolean;
}

export interface ApplicationTemplateSection {
  title: string;
  fields: FieldMapping[];
}

/** Which itemized RiskProfile array a repeating-row section reads from. */
export type TableSource = 'vehicles' | 'drivers' | 'losses';

export interface TableColumn<T = unknown> {
  key: string;
  label: string;
  /**
   * Reads/formats a value off one entry; defaults to reading `entry[key]` through a generic
   * display formatter. When provided, this is the sole source of the cell's value — used both
   * for transformed values (dates, money) and for structural columns with no entry property at
   * all (e.g. a "Unit Number" derived from row position, not read off any field).
   */
  format?: (entry: T, index: number) => string;
}

export interface ApplicationTableSection {
  title: string;
  source: TableSource;
  columns: TableColumn[];
}

export interface ApplicationTemplate {
  id: string;
  name: string;
  description?: string;
  /** Which carrier/MGA this template represents, if any — undefined for a generic sample template. */
  marketName?: string;
  sections: ApplicationTemplateSection[];
  /**
   * Repeating-row sections — Drivers, Vehicles, Loss History — kept structurally distinct from the
   * scalar `sections` above rather than flattened into one text blob per row. Each RiskProfile
   * itemized array (vehicles[]/drivers[]/losses[]) maps to one of these.
   */
  tableSections?: ApplicationTableSection[];
}

// ---- Mapping result: what the field-mapping engine produces for one account ----

export type MappedFieldStatus = 'auto_filled' | 'missing' | 'conflict' | 'manually_entered' | 'needs_review';

export interface MappedField {
  targetFieldId: string;
  targetLabel: string;
  value: string;
  status: MappedFieldStatus;
  confidence?: Confidence;
  source?: FieldSource;
  /** Why this needs attention. Undefined when status is 'auto_filled' or 'manually_entered'. */
  reviewReason?: string;
  editable: boolean;
  required?: boolean;
  /** Carried through so the UI can offer "also save this to the Risk Profile" / "resolve in Risk Profile" for fields that have one. Undefined for fields with no Risk Profile equivalent. */
  riskProfilePath?: FieldPath;
}

export interface MappedApplicationSection {
  title: string;
  fields: MappedField[];
}

export interface MappedTableCell {
  value: string;
  status: 'auto_filled' | 'missing';
  source?: FieldSource;
}

export interface MappedTableRow {
  id: string;
  cells: Record<string, MappedTableCell>;
}

export interface MappedTableSection {
  title: string;
  source: TableSource;
  columns: { key: string; label: string }[];
  rows: MappedTableRow[];
}

export interface MappedApplication {
  accountId: string;
  templateId: string;
  templateName: string;
  generatedAt: string;
  sections: MappedApplicationSection[];
  tableSections: MappedTableSection[];
  fieldsNeedingReview: number;
  /** Submission-quality warnings (missing identifiers, fleet/vehicle-count conflicts, unspecified requested limits, new coverage requests) — see services/extraction/reconciliation.ts. */
  warnings: string[];
}

export interface ApplicationStats {
  totalFields: number;
  autoFilled: number;
  missing: number;
  conflict: number;
  manuallyEntered: number;
  needsReview: number;
  itemizedRows: number;
  /** 0-100, share of scalar+table fields that are usably filled (auto-filled or manually entered). */
  percentComplete: number;
}
