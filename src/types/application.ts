import type { Confidence, FieldSource } from './common';
import type { FieldPath } from './extraction';

// ---- Template definition: pure data describing a target carrier/MGA application ----

export interface FieldMapping {
  targetFieldId: string;
  targetLabel: string;
  /** Dot-path into RiskProfile, e.g. "business.namedInsured", "coverage.auto_liability.requestedLimit". */
  riskProfilePath: FieldPath;
  /** Custom formatter; defaults to a generic display formatter (join arrays, Yes/No booleans, thousands separators). */
  format?: (value: unknown) => string;
  /** Minimum confidence to present as reliable; below this the field is flagged for review. Defaults to 'medium'. */
  minConfidence?: Confidence;
  editable?: boolean;
}

export interface ApplicationTemplateSection {
  title: string;
  fields: FieldMapping[];
}

export interface ApplicationTemplate {
  id: string;
  name: string;
  description?: string;
  /** Which carrier/MGA this template represents, if any — undefined for a generic sample template. */
  marketName?: string;
  sections: ApplicationTemplateSection[];
  /**
   * Whether the engine should append a Loss History Summary section. Loss entries aren't
   * FieldValue-wrapped scalars, so they don't fit the generic per-field mapping list above —
   * this is the one documented exception to the declarative-mapping approach. Defaults to true.
   */
  includeLossHistory?: boolean;
}

// ---- Mapping result: what the field-mapping engine produces for one account ----

export type MappedFieldStatus = 'mapped' | 'needs_review';

export interface MappedField {
  targetFieldId: string;
  targetLabel: string;
  value: string;
  status: MappedFieldStatus;
  confidence?: Confidence;
  source?: FieldSource;
  /** Why this needs review. Undefined when status is 'mapped'. */
  reviewReason?: string;
  editable: boolean;
}

export interface MappedApplicationSection {
  title: string;
  fields: MappedField[];
}

export interface MappedApplication {
  accountId: string;
  templateId: string;
  templateName: string;
  generatedAt: string;
  sections: MappedApplicationSection[];
  fieldsNeedingReview: number;
}
