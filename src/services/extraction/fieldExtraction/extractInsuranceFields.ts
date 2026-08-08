import type { ExtractedFieldResult, FieldSource } from '../../../types';
import type { RawDocument } from '../../ingestion';
import { toTextLines, toExcerpt } from './textLines';
import { SCALAR_FIELD_PATTERNS } from './scalarPatterns';
import { extractBooleanFields } from './booleanPatterns';
import { extractLossRows } from './lossPatterns';
import { classifyTable, mapVehicleTable, mapDriverTable, mapLossTable, mapCoverageTable } from './tableMappers';

export interface ExtractionSourceMeta {
  documentId: string;
  documentName: string;
}

function scalarSource(meta: ExtractionSourceMeta, page: number | undefined, excerpt: string): FieldSource {
  return { documentId: meta.documentId, documentName: meta.documentName, page, excerpt: toExcerpt(excerpt) };
}

function tableSource(meta: ExtractionSourceMeta, sheetName: string | undefined, row: number, description: string): FieldSource {
  const location = sheetName ? `${sheetName}, row ${row + 2}` : `row ${row + 2}`;
  return { documentId: meta.documentId, documentName: meta.documentName, excerpt: `${location} — ${description}` };
}

function extractScalarText(doc: RawDocument, meta: ExtractionSourceMeta): ExtractedFieldResult[] {
  const lines = toTextLines(doc);
  const results: ExtractedFieldResult[] = [];

  for (const field of SCALAR_FIELD_PATTERNS) {
    outer: for (const group of field.groups) {
      for (const pattern of group.patterns) {
        for (const line of lines) {
          const m = line.text.match(pattern);
          if (!m || !m[1]) continue;
          const value = field.coerce(m[1]);
          if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
          results.push({
            fieldPath: field.fieldPath,
            value,
            confidence: group.confidence,
            source: scalarSource(meta, line.page, line.text),
            extractionMethod: 'ai_extraction',
          });
          break outer;
        }
      }
    }
  }

  const booleans = extractBooleanFields(lines, doc.text);
  for (const b of booleans) {
    results.push({
      fieldPath: b.fieldPath,
      value: b.value,
      confidence: b.confidence,
      source: scalarSource(meta, b.page, b.matchedText),
      extractionMethod: 'ai_extraction',
    });
  }

  const lossRows = extractLossRows(lines);
  for (const l of lossRows) {
    results.push({
      fieldPath: 'lossHistory',
      value: { lossDate: l.lossDate, claimType: l.claimType, paid: l.paid, reserved: l.reserved, incurred: l.incurred, status: l.status },
      confidence: 'high',
      source: scalarSource(meta, l.page, l.matchedText),
      extractionMethod: 'ai_extraction',
    });
  }

  return results;
}

function extractTables(doc: RawDocument, meta: ExtractionSourceMeta): ExtractedFieldResult[] {
  if (!doc.tables || doc.tables.length === 0) return [];
  const results: ExtractedFieldResult[] = [];

  for (const table of doc.tables) {
    const kind = classifyTable(table.headers);

    if (kind === 'vehicles') {
      const rows = mapVehicleTable(table);
      for (const { row, entry } of rows) {
        const desc = [entry.vin && `VIN ${entry.vin}`, entry.make, entry.model, entry.year].filter(Boolean).join(' ');
        results.push({ fieldPath: 'vehicles', value: entry, confidence: 'high', source: tableSource(meta, table.sheetName, row, desc || 'vehicle'), extractionMethod: 'deterministic_import' });
      }
      if (rows.length > 0) {
        results.push({
          fieldPath: 'transportation.fleetSize',
          value: rows.length,
          confidence: 'high',
          source: { documentId: meta.documentId, documentName: meta.documentName, excerpt: `${rows.length} vehicle${rows.length === 1 ? '' : 's'} listed in ${table.sheetName ?? 'the vehicle schedule'}` },
          extractionMethod: 'deterministic_import',
        });
        const vehicleTypes = Array.from(new Set(rows.map((r) => [r.entry.make, r.entry.model].filter(Boolean).join(' ')).filter((t) => t.length > 0)));
        if (vehicleTypes.length > 0) {
          results.push({
            fieldPath: 'transportation.vehicleTypes',
            value: vehicleTypes,
            confidence: 'high',
            source: { documentId: meta.documentId, documentName: meta.documentName, excerpt: `Distinct make/model across ${table.sheetName ?? 'the vehicle schedule'}: ${vehicleTypes.join(', ')}` },
            extractionMethod: 'deterministic_import',
          });
        }
      }
      continue;
    }

    if (kind === 'drivers') {
      const rows = mapDriverTable(table);
      for (const { row, entry } of rows) {
        const desc = [entry.name, entry.licenseState && `License ${entry.licenseState}`].filter(Boolean).join(' ');
        results.push({ fieldPath: 'drivers', value: entry, confidence: 'high', source: tableSource(meta, table.sheetName, row, desc || 'driver'), extractionMethod: 'deterministic_import' });
      }
      if (rows.length > 0) {
        results.push({
          fieldPath: 'transportation.driverCount',
          value: rows.length,
          confidence: 'high',
          source: { documentId: meta.documentId, documentName: meta.documentName, excerpt: `${rows.length} driver${rows.length === 1 ? '' : 's'} listed in ${table.sheetName ?? 'the driver schedule'}` },
          extractionMethod: 'deterministic_import',
        });
        const experienceValues = rows.map((r) => r.entry.yearsExperience).filter((v): v is number => v !== undefined);
        if (experienceValues.length > 0) {
          results.push({
            fieldPath: 'transportation.minDriverExperienceYears',
            value: Math.min(...experienceValues),
            confidence: 'high',
            source: { documentId: meta.documentId, documentName: meta.documentName, excerpt: `Minimum years of experience across ${table.sheetName ?? 'the driver schedule'}` },
            extractionMethod: 'deterministic_import',
          });
        }
      }
      continue;
    }

    if (kind === 'losses') {
      const rows = mapLossTable(table);
      for (const { row, entry } of rows) {
        results.push({
          fieldPath: 'lossHistory',
          value: entry,
          confidence: 'high',
          source: tableSource(meta, table.sheetName, row, `${entry.lossDate} ${entry.claimType}`),
          extractionMethod: 'deterministic_import',
        });
      }
      continue;
    }

    if (kind === 'coverage') {
      const rows = mapCoverageTable(table);
      for (const { row, coverageType, requestedLimit } of rows) {
        results.push({
          fieldPath: `coverage.${coverageType}.requestedLimit`,
          value: requestedLimit,
          confidence: 'high',
          source: tableSource(meta, table.sheetName, row, `${coverageType.replace(/_/g, ' ')}: ${requestedLimit}`),
          extractionMethod: 'deterministic_import',
        });
      }
      continue;
    }
    // kind === 'unrecognized': no confident mapping exists for this table's shape, so nothing is guessed.
  }

  return results;
}

/**
 * Deterministic field extraction: label/regex matching over raw text for scalar fields, plus
 * header-synonym column mapping over parsed tables for itemized vehicles/drivers/losses/coverage.
 * A field with no confident match is simply omitted — the merge layer already treats "no result"
 * as missing, so nothing here ever invents a value.
 */
export function extractInsuranceFields(doc: RawDocument, meta: ExtractionSourceMeta): ExtractedFieldResult[] {
  return [...extractScalarText(doc, meta), ...extractTables(doc, meta)];
}
