import { describe, expect, it } from 'vitest';
import { createEmptyRiskProfile } from '../../extraction/emptyRiskProfile';
import { emptyField, manualField } from '../../../types';
import type { DriverEntry } from '../../../types';
import { mapRiskProfileToApplication } from '../fieldMappingEngine';
import { APPLICATION_TEMPLATES } from '../templates';
import { buildApplicationPrintPlan, printedCellValue } from '../printPlan';
import { generateApplicationCsv, generateApplicationPdf } from '../exportApplication';

/** An account with a manual value, a low-confidence (needs review) value, a conflict, a placeholder and one driver. */
function application() {
  const p = createEmptyRiskProfile('a');
  p.business.namedInsured = manualField('Nova Light LLC');
  p.transportation.dotNumber = { value: '7654321', confidence: 'low', isMissing: false, isConflicting: false, extractionMethod: 'image_ocr' } as never;
  p.business.yearsInBusiness = { value: 12, confidence: 'high', isMissing: false, isConflicting: true } as never;
  p.coverage = [
    { type: 'auto_liability', requestedLimit: manualField('1,000,000') },
    { type: 'motor_truck_cargo', requestedLimit: emptyField() },
  ];
  p.drivers = [{ id: 'd1', name: 'Alex R Morgan', licenseNumber: 'M512-781-85-264-0' } as DriverEntry];
  return mapRiskProfileToApplication(p, APPLICATION_TEMPLATES[0]);
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false, disableFontFace: true } as never).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return out.join('\n');
}

describe('Review Application = what the download contains', () => {
  const app = application();
  const plan = buildApplicationPrintPlan(app);
  const field = (label: string) => plan.sections.flatMap((s) => s.fields).find((f) => f.field.targetLabel === label)!;

  it('every template section and field is in the plan, in template order', () => {
    expect(plan.sections.map((s) => s.title)).toEqual(app.sections.map((s) => s.title));
    expect(plan.tables.map((t) => t.title)).toEqual(app.tableSections.map((t) => t.title));
    plan.sections.forEach((s, i) => expect(s.fields.map((f) => f.field.targetFieldId)).toEqual(app.sections[i].fields.map((f) => f.targetFieldId)));
  });

  it('marks what prints and why the rest does not — never inventing a value', () => {
    expect(field('Named Insured')).toMatchObject({ prints: true });
    const dot = plan.sections.flatMap((s) => s.fields).find((f) => f.field.riskProfilePath === 'transportation.dotNumber')!;
    expect(dot).toMatchObject({ prints: true });
    expect(dot.field.status).toBe('needs_review'); // printed — and flagged in the preview
    const years = plan.sections.flatMap((s) => s.fields).find((f) => f.field.riskProfilePath === 'business.yearsInBusiness')!;
    expect(years).toMatchObject({ prints: false, omittedReason: 'conflict' });
    expect(years.field.value).toBe('');
    const missing = plan.sections.flatMap((s) => s.fields).filter((f) => !f.prints && f.omittedReason === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((f) => !f.field.value?.trim() || f.field.status === 'missing')).toBe(true);
    expect(plan.sections.flatMap((s) => s.fields).some((f) => f.omittedReason === 'placeholder')).toBe(true);
  });

  it('itemized tables: only columns and rows with data print', () => {
    const drivers = plan.tables.find((t) => t.title === 'Drivers')!;
    expect(drivers.prints).toBe(true);
    expect(drivers.rows).toHaveLength(1);
    expect(drivers.columns.length).toBeGreaterThan(0);
    expect(drivers.columns.every((c) => drivers.rows.some((r) => printedCellValue(r, c.key)))).toBe(true);
    expect(drivers.omittedColumns.every((c) => drivers.rows.every((r) => !printedCellValue(r, c.key)))).toBe(true);
    expect(plan.tables.find((t) => t.title === 'Vehicles')!.prints).toBe(false);
  });

  it('the CSV is the plan, row for row', () => {
    const csv = generateApplicationCsv(app, 'Nova Light LLC');
    for (const s of plan.sections) for (const f of s.printed) expect(csv).toContain(f.targetLabel);
    for (const s of plan.sections) for (const f of s.fields.filter((x) => !x.prints && x.field.value)) expect(csv).not.toContain(f.field.value);
    expect(csv).not.toContain('Vehicles');
  });

  it('the PDF contains every printed value and nothing the preview marks as not printed', async () => {
    const text = await pdfText(await generateApplicationPdf(app, 'Nova Light LLC'));
    const flat = text.replace(/\s+/g, ' ');
    for (const s of plan.sections) {
      if (s.printed.length) expect(flat).toContain(s.title.toUpperCase());
      for (const f of s.printed) expect(flat).toContain(f.value);
    }
    for (const t of plan.tables) {
      if (t.prints) {
        expect(flat).toContain(t.title.toUpperCase());
        for (const r of t.rows) for (const c of t.columns) if (printedCellValue(r, c.key)) expect(flat).toContain(printedCellValue(r, c.key));
      } else {
        expect(flat).not.toContain(t.title.toUpperCase());
      }
    }
    expect(flat).not.toContain('limit not specified');
    expect(flat).not.toMatch(/\b12\b.*Years/); // the conflicting value is not printed
  });
});

describe('loss runs with no itemized claims: Loss History lists the reports', () => {
  const run = (over: Record<string, unknown>) => ({ id: 'lr1', carrier: 'Progressive', createdAt: '', updatedAt: '', ...over }) as never;
  const lossTable = (plan: ReturnType<typeof buildApplicationPrintPlan>) => plan.tables.find((t) => t.title === 'Loss History')!;
  const cells = (plan: ReturnType<typeof buildApplicationPrintPlan>) => lossTable(plan).rows.map((r) => Object.fromEntries(lossTable(plan).columns.map((c) => [c.label, printedCellValue(r, c.key)])));

  it('a report that says 0 claims → "No losses reported", as one table with only the columns the report has', async () => {
    const p = createEmptyRiskProfile('a');
    p.business.namedInsured = manualField('Nova Light LLC');
    const app = mapRiskProfileToApplication(p, APPLICATION_TEMPLATES[0], [run({ carrier: 'Cover Whale Insurance Solutions, Inc. | Page 1 of 1', policyNumber: 'CW1EIC-703861-00', reportDate: '2026-07-17', claimCount: 0 })]);
    const plan = buildApplicationPrintPlan(app);
    expect(lossTable(plan)).toMatchObject({ prints: true, note: 'No losses reported' });
    expect(cells(plan)).toEqual([{ 'Insurance Company': 'Cover Whale Insurance Solutions, Inc.', 'Policy Number': 'CW1EIC-703861-00', 'Report Date': '07/17/2026', Losses: 'No losses' }]);
    const flat = (await pdfText(await generateApplicationPdf(app, 'Nova Light LLC'))).replace(/\s+/g, ' ');
    for (const v of ['LOSS HISTORY', 'No losses reported', 'Cover Whale Insurance Solutions, Inc.', 'CW1EIC-703861-00', '07/17/2026']) expect(flat).toContain(v);
    expect(flat).not.toContain('Page 1 of 1');
    expect(flat).not.toContain('COVERAGE PERIOD'); // not on the report → no column
    expect(generateApplicationCsv(app, 'Nova Light LLC')).toContain('No losses reported');
  });

  it('a report that doesn\'t state its claims never says "No losses"', () => {
    const p = createEmptyRiskProfile('a');
    const silent = buildApplicationPrintPlan(mapRiskProfileToApplication(p, APPLICATION_TEMPLATES[0], [run({ policyNumber: 'X1' })]));
    expect(lossTable(silent).note).toBeUndefined();
    expect(cells(silent)[0].Losses).toBe('Not stated on report');
    const stated = buildApplicationPrintPlan(mapRiskProfileToApplication(p, APPLICATION_TEMPLATES[0], [run({ claimCount: 2, totalIncurred: 5000 })]));
    expect(cells(stated)[0].Losses).toBe('2 claims, $5,000 incurred');
  });

  it('itemized claims → the normal claims table; no reports → nothing invented', () => {
    const p = createEmptyRiskProfile('a');
    expect(lossTable(buildApplicationPrintPlan(mapRiskProfileToApplication(p, APPLICATION_TEMPLATES[0]))).prints).toBe(false);
    p.lossHistory = [{ id: 'l1', lossDate: '2025-01-01', incurred: 100 } as never];
    const t = lossTable(buildApplicationPrintPlan(mapRiskProfileToApplication(p, APPLICATION_TEMPLATES[0], [run({})])));
    expect(t.columns.map((c) => c.label)).toContain('Loss Date');
    expect(t.note).toBeUndefined();
  });
});
