import type {
  ApplicationStats,
  ApplicationTableSection,
  ApplicationTemplate,
  FieldMapping,
  FieldSource,
  MappedApplication,
  MappedApplicationSection,
  MappedField,
  MappedTableSection,
  RiskProfile,
} from '../../types';
import { CONFIDENCE_ORDER } from '../../utils/confidence';
import { getFieldValueByPath } from '../../utils/riskProfilePath';

function defaultFormat(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' && value >= 1000) return value.toLocaleString('en-US');
  return String(value);
}

/**
 * Maps one target field. Never guesses: a missing, conflicting, or below-threshold-confidence
 * source value is flagged accordingly — the value (if any) is still shown so the broker can see
 * what's there, but it's never presented as reliable. A mapping with no riskProfilePath at all
 * (a field the Risk Profile doesn't track yet, e.g. DBA/FEIN) is honestly 'missing', not guessed.
 */
function mapField(profile: RiskProfile, mapping: FieldMapping): MappedField {
  const base = {
    targetFieldId: mapping.targetFieldId,
    targetLabel: mapping.targetLabel,
    editable: mapping.editable ?? true,
    required: mapping.required,
    riskProfilePath: mapping.riskProfilePath,
  };

  if (!mapping.riskProfilePath) {
    return { ...base, value: '', status: 'missing', reviewReason: 'Not tracked in the Risk Profile yet — enter manually.' };
  }

  const field = getFieldValueByPath(profile, mapping.riskProfilePath);
  const format = mapping.format ?? defaultFormat;
  // Default threshold is 'medium': a 'low'-confidence extraction is flagged unless a mapping
  // explicitly opts into accepting it (minConfidence: 'low') for a non-critical field.
  const minConfidence = mapping.minConfidence ?? 'medium';

  if (!field || field.isMissing) {
    return { ...base, value: '', status: 'missing', reviewReason: 'No data available in the risk profile.' };
  }

  const value = format(field.value);

  if (field.isConflicting) {
    return {
      ...base,
      value,
      status: 'conflict',
      confidence: field.confidence,
      source: field.source,
      reviewReason: 'Documents disagree on this value — resolve the conflict in the Risk Profile before it can populate here.',
    };
  }

  if (field.extractionMethod === 'manual_entry') {
    return { ...base, value, status: 'manually_entered', confidence: field.confidence, source: field.source };
  }

  if (CONFIDENCE_ORDER[field.confidence] > CONFIDENCE_ORDER[minConfidence]) {
    return {
      ...base,
      value,
      status: 'needs_review',
      confidence: field.confidence,
      source: field.source,
      reviewReason: `Low-confidence extraction (${field.confidence}) — verify before submitting.`,
    };
  }

  return { ...base, value, status: 'auto_filled', confidence: field.confidence, source: field.source };
}

/**
 * Generic repeating-row mapper for vehicles[]/drivers[]/losses[] — the same function handles all
 * three itemized RiskProfile arrays, driven entirely by the template's column config, so adding a
 * fourth itemized section later never means writing a new mapper. A column with no matching entry
 * property (or a custom `format`, e.g. a row-position "Unit Number") is computed via `format`;
 * everything else reads `entry[key]` directly and reports missing honestly rather than guessing.
 */
function entriesForSource(profile: RiskProfile, source: ApplicationTableSection['source']): unknown[] {
  if (source === 'vehicles') return profile.vehicles;
  if (source === 'drivers') return profile.drivers;
  return profile.lossHistory;
}

function mapTableSection(profile: RiskProfile, table: ApplicationTableSection): MappedTableSection {
  const entries = entriesForSource(profile, table.source) ?? [];

  const rows = entries.map((entry, index) => {
    const record = entry as Record<string, unknown>;
    const source = record.source as FieldSource | undefined;
    const cells: MappedTableSection['rows'][number]['cells'] = {};

    for (const col of table.columns) {
      if (col.format) {
        const formatted = col.format(entry, index);
        cells[col.key] = formatted ? { value: formatted, status: 'auto_filled', source } : { value: '', status: 'missing' };
        continue;
      }
      const raw = record[col.key];
      cells[col.key] = raw === undefined || raw === null || raw === '' ? { value: '', status: 'missing' } : { value: defaultFormat(raw), status: 'auto_filled', source };
    }

    return { id: (record.id as string) ?? `row_${index}`, cells };
  });

  return {
    title: table.title,
    source: table.source,
    columns: table.columns.map(({ key, label }) => ({ key, label })),
    rows,
  };
}

/**
 * The reusable field-mapping layer: turns a RiskProfile into a filled-out target application by
 * walking a declarative ApplicationTemplate. Supporting a new carrier/MGA application is adding a
 * new ApplicationTemplate (data) to services/application/templates.ts — this function and the
 * extraction pipeline it reads from never change.
 */
export function mapRiskProfileToApplication(profile: RiskProfile, template: ApplicationTemplate): MappedApplication {
  const sections: MappedApplicationSection[] = template.sections.map((section) => ({
    title: section.title,
    fields: section.fields.map((mapping) => mapField(profile, mapping)),
  }));

  const tableSections: MappedTableSection[] = (template.tableSections ?? []).map((table) => mapTableSection(profile, table));

  const fieldsNeedingReview =
    sections.reduce((sum, s) => sum + s.fields.filter((f) => f.status === 'missing' || f.status === 'conflict' || f.status === 'needs_review').length, 0) +
    tableSections.reduce((sum, t) => sum + t.rows.reduce((rowSum, row) => rowSum + Object.values(row.cells).filter((c) => c.status === 'missing').length, 0), 0);

  return {
    accountId: profile.accountId,
    templateId: template.id,
    templateName: template.name,
    generatedAt: new Date().toISOString(),
    sections,
    tableSections,
    fieldsNeedingReview,
  };
}

/** Aggregate completion stats spanning both scalar fields and itemized table cells — used by the review-page header. */
export function computeApplicationStats(application: MappedApplication): ApplicationStats {
  let totalFields = 0;
  let autoFilled = 0;
  let missing = 0;
  let conflict = 0;
  let manuallyEntered = 0;
  let needsReview = 0;
  let itemizedRows = 0;

  for (const section of application.sections) {
    for (const field of section.fields) {
      totalFields++;
      if (field.status === 'auto_filled') autoFilled++;
      else if (field.status === 'missing') missing++;
      else if (field.status === 'conflict') conflict++;
      else if (field.status === 'manually_entered') manuallyEntered++;
      else if (field.status === 'needs_review') needsReview++;
    }
  }

  for (const table of application.tableSections) {
    itemizedRows += table.rows.length;
    for (const row of table.rows) {
      for (const cell of Object.values(row.cells)) {
        totalFields++;
        if (cell.status === 'auto_filled') autoFilled++;
        else missing++;
      }
    }
  }

  const percentComplete = totalFields === 0 ? 0 : Math.round(((autoFilled + manuallyEntered) / totalFields) * 100);

  return { totalFields, autoFilled, missing, conflict, manuallyEntered, needsReview, itemizedRows, percentComplete };
}
