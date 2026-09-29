import type { Confidence, ExtractedFieldResult, ExtractionMethod, FieldSource } from '../../../types';
import type { RawDocument } from '../../ingestion';
import { toTextLines, toExcerpt, type TextLine } from './textLines';
import { SCALAR_FIELD_PATTERNS } from './scalarPatterns';
import { extractBooleanFields } from './booleanPatterns';
import { extractLossRows, extractLossBlocks } from './lossPatterns';
import { extractDesiredCoverageLine, extractCurrentPolicyCoverageLines } from './coveragePatterns';
import { classifyTable, mapVehicleTable, mapDriverTable, mapLossTable, mapCoverageTable, lossColumns, parseAmount } from './tableMappers';
import { extractVehiclesFromText } from './vinText';
import { extractLossRunDrafts, labeledTotals, looksLikeLossRun, type StatedTotals } from './lossRunPatterns';
import { findTables, type LayoutTable } from '../../ingestion/pdfLayout';
import type { RawTable } from '../../ingestion';
import { parseAddressComponents } from './addressPatterns';
import { isReadableText } from './textQuality';
import {
  extractDriverLicenseFields,
  extractVehicleRegistrationFields,
  findGenericBusinessName,
  findGenericCityState,
  detectDriverLicense,
  detectVehicleRegistration,
} from './idDocumentPatterns';
import { toMonths, type DurationValue } from '../../../utils/duration';

export interface ExtractionSourceMeta {
  documentId: string;
  documentName: string;
  /**
   * True when this document's text came from OCR on a photo/screenshot rather than embedded
   * PDF/DOCX/TXT text. OCR carries its own transcription-error risk on top of whatever the
   * label/regex pattern itself already accounts for, so every field pulled from an image is
   * capped at 'medium' confidence (never 'high') and tagged extractionMethod: 'image_ocr' instead
   * of 'ai_extraction' — confidence should reflect image quality, not just pattern specificity.
   */
  isImageSource?: boolean;
}

/** A pattern match is never trusted as fully 'high' confidence when it came from OCR'd image text — see ExtractionSourceMeta.isImageSource. */
function capConfidence(confidence: Confidence, meta: ExtractionSourceMeta): Confidence {
  return meta.isImageSource && confidence === 'high' ? 'medium' : confidence;
}

function extractionMethodFor(meta: ExtractionSourceMeta): ExtractionMethod {
  return meta.isImageSource ? 'image_ocr' : 'ai_extraction';
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

function extractScalarText(doc: RawDocument, meta: ExtractionSourceMeta, textLines: TextLine[], hasDriverTable: boolean): ExtractedFieldResult[] {
  const lines = [...textLines, ...synthesizeKeyValueLines(doc)];
  const results: ExtractedFieldResult[] = [];

  // A driver's license or vehicle registration never legitimately carries applicant-business
  // fields (named insured, business address, DOT #, ...) — confirmed as a real bug, not a
  // hypothetical: a synthetic Tennessee license's own "State: Tennessee" and "Address: ..." lines
  // were previously misrouted into business.state/business.address (the SUBMISSION's business
  // info) purely because those bare labels also happen to match the generic business-field
  // patterns below. Skipping the business/transportation prose patterns entirely for a
  // detected ID-card document is what keeps a driver's personal details out of the applicant's
  // business section, rather than trying to out-guess which label "wins".
  const isIdCardDocument = detectDriverLicense(doc.text) || detectVehicleRegistration(doc.text);

  if (!isIdCardDocument) {
    for (const field of SCALAR_FIELD_PATTERNS) {
      outer: for (const group of field.groups) {
        for (const pattern of group.patterns) {
          for (const line of lines) {
            const m = line.text.match(pattern);
            if (!m || !m[1]) continue;
            let value = field.coerce(m[1]);
            // OCR noise after a label ("Address: {=a") is not a value.
            if (typeof value === 'string' && !isReadableText(value)) continue;
            if (Array.isArray(value)) value = value.filter((v) => typeof v !== 'string' || isReadableText(v));
            if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
            results.push({
              fieldPath: field.fieldPath,
              value,
              confidence: capConfidence(group.confidence, meta),
              source: scalarSource(meta, line.page, line.text),
              extractionMethod: extractionMethodFor(meta),
            });
            break outer;
          }
        }
      }
    }
  }

  const booleans = extractBooleanFields(lines, doc.text);
  for (const b of booleans) {
    results.push({
      fieldPath: b.fieldPath,
      value: b.value,
      confidence: capConfidence(b.confidence, meta),
      source: scalarSource(meta, b.page, b.matchedText),
      extractionMethod: extractionMethodFor(meta),
    });
  }


  const desiredCoverage = extractDesiredCoverageLine(lines);
  if (desiredCoverage) {
    for (const coverageType of desiredCoverage.coverageTypes) {
      results.push({
        fieldPath: 'coverageLine',
        value: coverageType,
        confidence: capConfidence('high', meta),
        source: scalarSource(meta, desiredCoverage.page, desiredCoverage.matchedText),
        extractionMethod: extractionMethodFor(meta),
      });
    }
  }

  for (const row of extractCurrentPolicyCoverageLines(lines)) {
    results.push({
      fieldPath: `coverage.${row.coverageType}.currentLimit`,
      value: row.currentLimit,
      confidence: capConfidence('high', meta),
      source: scalarSource(meta, row.page, row.matchedText),
      extractionMethod: extractionMethodFor(meta),
    });
  }

  // A "Street, City, ST 12345"-shaped address also yields city/state/ZIP as their own fields —
  // never invented, only ever read off the same matched address line.
  const addressResult = results.find((r) => r.fieldPath === 'business.address');
  if (addressResult && typeof addressResult.value === 'string') {
    const components = parseAddressComponents(addressResult.value);
    if (components) {
      results.push({ fieldPath: 'business.city', value: components.city, confidence: addressResult.confidence, source: addressResult.source, extractionMethod: extractionMethodFor(meta) });
      results.push({ fieldPath: 'business.zip', value: components.zip, confidence: addressResult.confidence, source: addressResult.source, extractionMethod: extractionMethodFor(meta) });
    }
  }

  // Card/ID-style documents (driver's licenses, vehicle registrations) are laid out as short
  // abbreviated labels next to a value rather than the "Label: sentence" prose the patterns above
  // are built for, so they need their own dedicated, narrowly-gated extractors — see
  // idDocumentPatterns.ts for why this exists and how it avoids hallucinating a value from a
  // partially-unreadable field.
  // A driver list (a table of drivers) is not a license, even though it says "License #", "DOB" and "Class".
  const licenseMatch = hasDriverTable ? null : extractDriverLicenseFields(lines, doc.text);
  if (licenseMatch) {
    results.push({
      fieldPath: 'drivers',
      value: licenseMatch.entry,
      confidence: capConfidence('medium', meta),
      source: scalarSource(meta, undefined, licenseMatch.matchedText),
      extractionMethod: extractionMethodFor(meta),
    });
  }

  const registrationMatch = extractVehicleRegistrationFields(lines, doc.text);
  if (registrationMatch) {
    results.push({
      fieldPath: 'vehicles',
      value: registrationMatch.entry,
      confidence: capConfidence('medium', meta),
      source: scalarSource(meta, undefined, registrationMatch.matchedText),
      extractionMethod: extractionMethodFor(meta),
    });
  }

  // Generic fallback: a bare, unlabeled "Company Name LLC" or "City, ST" line. Only ever fills a
  // field nothing more specific above already matched, and only at low confidence — this is what
  // lets a screenshot or an unrecognized document type still yield real fields instead of zero.
  // Skipped for a detected ID-card document for the same reason as the prose patterns above: a
  // multi-line driver's address can easily contain a bare "Nashville, TN 37210"-shaped line that
  // would otherwise get misread as the applicant business's city/state.
  if (!isIdCardDocument && !results.some((r) => r.fieldPath === 'business.namedInsured')) {
    const nameMatch = findGenericBusinessName(lines);
    if (nameMatch) {
      results.push({
        fieldPath: 'business.namedInsured',
        value: nameMatch.raw.trim(),
        confidence: capConfidence('low', meta),
        source: scalarSource(meta, nameMatch.line.page, nameMatch.line.text),
        extractionMethod: extractionMethodFor(meta),
      });
    }
  }
  if (!isIdCardDocument && !results.some((r) => r.fieldPath === 'business.city')) {
    const cityState = findGenericCityState(lines);
    if (cityState) {
      results.push({
        fieldPath: 'business.city',
        value: cityState.city,
        confidence: capConfidence('low', meta),
        source: scalarSource(meta, cityState.line.page, cityState.line.text),
        extractionMethod: extractionMethodFor(meta),
      });
      if (!results.some((r) => r.fieldPath === 'business.state')) {
        results.push({
          fieldPath: 'business.state',
          value: cityState.state,
          confidence: capConfidence('low', meta),
          source: scalarSource(meta, cityState.line.page, cityState.line.text),
          extractionMethod: extractionMethodFor(meta),
        });
      }
    }
  }

  return results;
}

/** A claim result and where it sits in the document (for linking it to its loss-run section). */
interface PositionedClaim {
  result: ExtractedFieldResult;
  position: number | undefined;
}

function extractTables(tables: (RawTable | LayoutTable)[], meta: ExtractionSourceMeta, claims: PositionedClaim[]): ExtractedFieldResult[] {
  if (tables.length === 0) return [];
  const results: ExtractedFieldResult[] = [];

  for (const table of tables) {
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
        const experienceValues = rows.map((r) => r.entry.yearsExperience).filter((v): v is DurationValue => v !== undefined && toMonths(v) !== null);
        if (experienceValues.length > 0) {
          results.push({
            fieldPath: 'transportation.minDriverExperienceYears',
            value: experienceValues.reduce((min, v) => (toMonths(v)! < toMonths(min)! ? v : min)),
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
        const result: ExtractedFieldResult = {
          fieldPath: 'lossHistory',
          value: entry,
          confidence: 'high',
          source: tableSource(meta, table.sheetName, row, [entry.claimNumber && `Claim ${entry.claimNumber}`, entry.lossDate, entry.claimType].filter(Boolean).join(' ')),
          extractionMethod: 'deterministic_import',
        };
        results.push(result);
        claims.push({ result, position: 'rowLines' in table ? table.rowLines[row] : undefined });
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
  // PDF tables are rebuilt from the page layout; their lines are read as rows, not as prose.
  const layoutTables = doc.layout ? findTables(doc.layout, (headers) => classifyTable(headers) !== 'unrecognized') : [];
  const tableLines = new Set<number>();
  for (const t of layoutTables) for (let k = t.headerLine; k <= (t.totalsLine ?? t.rowLines[t.rowLines.length - 1]); k++) tableLines.add(k);
  const allLines = toTextLines(doc);
  const textLines = allLines.filter((l) => l.index === undefined || !tableLines.has(l.index));
  const tables = [...(doc.tables ?? []), ...layoutTables];
  const hasDriverTable = tables.some((t) => classifyTable(t.headers) === 'drivers');

  const claims: PositionedClaim[] = [];
  const results = [...extractScalarText(doc, meta, textLines, hasDriverTable), ...extractTables(tables, meta, claims)];

  // VINs printed outside a table (declarations pages, emails, questionnaires). A license or
  // registration card already has its own extractor.
  if (!detectDriverLicense(doc.text) && !detectVehicleRegistration(doc.text)) {
    const known = new Set(results.filter((r) => r.fieldPath === 'vehicles').map((r) => (r.value as { vin?: string }).vin).filter((v): v is string => !!v));
    for (const { entry, line } of extractVehiclesFromText(textLines, known)) {
      results.push({
        fieldPath: 'vehicles',
        value: entry,
        confidence: capConfidence('medium', meta),
        source: scalarSource(meta, line.page, line.text),
        extractionMethod: extractionMethodFor(meta),
      });
    }
  }

  // Claims printed as text (one line per claim, or a labeled block per claim).
  const textLossRows = [...extractLossRows(textLines), ...extractLossBlocks(textLines)];
  for (const l of textLossRows) {
    const result: ExtractedFieldResult = {
      fieldPath: 'lossHistory',
      value: { lossDate: l.lossDate, claimType: l.claimType, paid: l.paid, reserved: l.reserved, incurred: l.incurred, status: l.status },
      confidence: capConfidence('high', meta),
      source: scalarSource(meta, l.page, l.matchedText),
      extractionMethod: extractionMethodFor(meta),
    };
    results.push(result);
    claims.push({ result, position: l.index });
  }

  // A loss run: one record per policy section, with its claims linked to it.
  if (looksLikeLossRun(doc.text, claims.length > 0)) {
    const pos = (l: TextLine, i: number) => l.index ?? i;
    const stated: StatedTotals[] = labeledTotals(textLines, pos);
    for (const t of layoutTables) {
      if (!t.totals || t.totalsLine === undefined || classifyTable(t.headers) !== 'losses') continue;
      const c = lossColumns(t.headers);
      const count = t.totals.join(' ').match(/\b(\d+)\s+claims?\b/i);
      const amount = (k: number) => (k >= 0 ? (parseAmount(t.totals![k]) ?? undefined) : undefined);
      stated.push({ position: t.totalsLine, claims: count ? Number(count[1]) : undefined, paid: amount(c.paid), reserve: amount(c.reserved), incurred: amount(c.incurred) });
    }
    const { drafts, claimKeys } = extractLossRunDrafts(textLines, { documentId: meta.documentId, claimPositions: claims.map((c) => c.position), statedTotals: stated });
    claims.forEach((c, i) => {
      if (claimKeys[i]) c.result.value = { ...(c.result.value as object), lossRunKey: claimKeys[i] };
    });
    for (const draft of drafts) {
      results.push({
        fieldPath: 'lossRun',
        value: draft,
        confidence: capConfidence('high', meta),
        source: { documentId: meta.documentId, documentName: meta.documentName, excerpt: ['Loss run', draft.carrier, draft.policyNumber && `policy ${draft.policyNumber}`].filter(Boolean).join(' — ') },
        extractionMethod: extractionMethodFor(meta),
      });
    }
  }
  return results;
}
