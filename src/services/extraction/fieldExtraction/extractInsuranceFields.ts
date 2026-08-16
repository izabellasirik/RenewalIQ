import type { ExtractedFieldResult, FieldSource } from '../../../types';
import type { RawDocument } from '../../ingestion';
import { toTextLines, toExcerpt, type TextLine } from './textLines';
import { SCALAR_FIELD_PATTERNS } from './scalarPatterns';
import { extractBooleanFields } from './booleanPatterns';
import { extractLossRows, extractLossBlocks } from './lossPatterns';
import { extractDesiredCoverageLine, extractCurrentPolicyCoverageLines } from './coveragePatterns';
import { classifyTable, mapVehicleTable, mapDriverTable, mapLossTable, mapCoverageTable } from './tableMappers';
import { parseAddressComponents } from './addressPatterns';

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

/**
 * Some questionnaires lay business fields out as a 2-column "Label | Value" table instead of
 * "Label: value" paragraphs — very common in Word forms. Scalar extraction otherwise never looks
 * at doc.tables at all, so those fields would silently stay missing. Rather than a second pattern
 * set, this synthesizes a "Label: Value" line per row and feeds it through the exact same
 * SCALAR_FIELD_PATTERNS matching used for paragraph text — one label vocabulary, two document shapes.
 * Only tables classifyTable doesn't already own (vehicles/drivers/losses/coverage) and with a
 * plausible key-value shape (2-3 columns) are considered, so this can't collide with itemized-row tables.
 */
function synthesizeKeyValueLines(doc: RawDocument): TextLine[] {
  if (!doc.tables) return [];
  const lines: TextLine[] = [];
  for (const table of doc.tables) {
    if (classifyTable(table.headers) !== 'unrecognized') continue;
    if (table.headers.length < 2 || table.headers.length > 3) continue;
    const allRows: string[][] = [table.headers, ...table.rows];
    for (const row of allRows) {
      const label = row[0]?.trim();
      const value = row[1]?.trim();
      if (label && value) lines.push({ text: `${label}: ${value}` });
    }
  }
  return lines;
}

function extractScalarText(doc: RawDocument, meta: ExtractionSourceMeta): ExtractedFieldResult[] {
  const lines = [...toTextLines(doc), ...synthesizeKeyValueLines(doc)];
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

  const lossRows = [...extractLossRows(lines), ...extractLossBlocks(lines)];
  for (const l of lossRows) {
    results.push({
      fieldPath: 'lossHistory',
      value: { lossDate: l.lossDate, claimType: l.claimType, paid: l.paid, reserved: l.reserved, incurred: l.incurred, status: l.status },
      confidence: 'high',
      source: scalarSource(meta, l.page, l.matchedText),
      extractionMethod: 'ai_extraction',
    });
  }

  const desiredCoverage = extractDesiredCoverageLine(lines);
  if (desiredCoverage) {
    for (const coverageType of desiredCoverage.coverageTypes) {
      results.push({
        fieldPath: 'coverageLine',
        value: coverageType,
        confidence: 'high',
        source: scalarSource(meta, desiredCoverage.page, desiredCoverage.matchedText),
        extractionMethod: 'ai_extraction',
      });
    }
  }

  for (const row of extractCurrentPolicyCoverageLines(lines)) {
    results.push({
      fieldPath: `coverage.${row.coverageType}.currentLimit`,
      value: row.currentLimit,
      confidence: 'high',
      source: scalarSource(meta, row.page, row.matchedText),
      extractionMethod: 'ai_extraction',
    });
  }

  // A "Street, City, ST 12345"-shaped address also yields city/state/ZIP as their own fields —
  // never invented, only ever read off the same matched address line.
  const addressResult = results.find((r) => r.fieldPath === 'business.address');
  if (addressResult && typeof addressResult.value === 'string') {
    const components = parseAddressComponents(addressResult.value);
    if (components) {
      results.push({ fieldPath: 'business.city', value: components.city, confidence: addressResult.confidence, source: addressResult.source, extractionMethod: 'ai_extraction' });
      results.push({ fieldPath: 'business.zip', value: components.zip, confidence: addressResult.confidence, source: addressResult.source, extractionMethod: 'ai_extraction' });
    }
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
        const desc = [entry.vin && `VIN ${entry.vin}`, entry.make, entry.model, entry.year, entry.bodyType].filter(Boolean).join(' ');
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
        // Only from an explicit body-type column, never guessed from make/model — absent when the schedule doesn't say.
        const vehicleTypes = Array.from(new Set(rows.map((r) => r.entry.bodyType).filter((t): t is string => !!t)));
        if (vehicleTypes.length > 0) {
          results.push({
            fieldPath: 'transportation.vehicleTypes',
            value: vehicleTypes,
            confidence: 'high',
            source: { documentId: meta.documentId, documentName: meta.documentName, excerpt: `Distinct vehicle types across ${table.sheetName ?? 'the vehicle schedule'}: ${vehicleTypes.join(', ')}` },
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
