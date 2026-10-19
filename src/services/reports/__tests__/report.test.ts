import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { pdfSafe, reportCsv, reportPdf, reportXlsx, type Report } from '../report';
import { policiesReport } from '../analyticsReports';
import type { PolicyRow } from '../../workflow/policies';

// Fictional data only.
const sample: Report = {
  title: 'Policies & endorsements',
  subtitle: ['Bound / endorsed date: 2026-10-01 to 2026-10-31', 'Show: Policies'],
  columns: [{ header: 'Client' }, { header: 'Bound', kind: 'date' }, { header: 'Net', kind: 'money' }, { header: 'Documents', kind: 'count' }],
  rows: [
    ['Sample Haulers, LLC', '2026-10-03', 1_000_000, 2],
    ['Blue Fern Trucking (sample)', '2026-10-21', -200_050, 0],
  ],
  totals: ['Total', null, 799_950, 2],
  fileBase: 'test',
};

describe('report files', () => {
  it('CSV: header, rows, totals; amounts as plain numbers', () => {
    expect(reportCsv(sample)).toBe('Client,Bound,Net,Documents\n"Sample Haulers, LLC",2026-10-03,10000.00,2\nBlue Fern Trucking (sample),2026-10-21,-2000.50,0\nTotal,,7999.50,2\n');
  });

  it('Excel: title and filters on top, real numbers and dates, bold totals', async () => {
    const blob = await reportXlsx(sample);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('Policies & endorsements');
    expect(ws.getCell('A2').value).toBe('Bound / endorsed date: 2026-10-01 to 2026-10-31');
    expect(ws.getRow(5).values).toEqual([undefined, 'Client', 'Bound', 'Net', 'Documents']);
    expect(ws.getCell('C6').value).toBe(10000);
    expect((ws.getCell('B6').value as Date).toISOString().slice(0, 10)).toBe('2026-10-03');
    expect(ws.getCell('C7').value).toBe(-2000.5);
    expect(ws.getCell('C8').value).toBe(7999.5);
    expect(ws.getRow(8).font?.bold).toBe(true);
    expect(ws.getColumn(3).numFmt).toContain('#,##0.00');
  });

  it('PDF: a real PDF, pages added for long lists', async () => {
    const one = await PDFDocument.load(new Uint8Array(await (await reportPdf(sample)).arrayBuffer()));
    expect(one.getPageCount()).toBe(1);
    expect(one.getTitle()).toBe('Policies & endorsements');
    const long = { ...sample, rows: Array.from({ length: 120 }, (_, i) => [`Client ${i} − with a very long name that will be cut short to fit the column`, '2026-10-03', i * 100, 1]) };
    const many = await PDFDocument.load(new Uint8Array(await (await reportPdf(long)).arrayBuffer()));
    expect(many.getPageCount()).toBeGreaterThan(2);
  });

  it('PDF text is limited to what the standard fonts can draw', () => {
    expect(pdfSafe('−$1,250.00 → “ok” — café 漢')).toBe('-$1,250.00 -> “ok” — café ?');
  });
});

describe('policies report = the filtered rows the screen shows', () => {
  const row = (id: string, net: number, extra: Partial<PolicyRow['policy']> = {}): PolicyRow => ({
    policy: { id, carrier: 'Sample Mutual', businessType: 'new', boundDate: '2026-10-03', netPremiumCents: net, taxesCents: 100, feesCents: 50, createdAt: '', updatedAt: '', policyNumber: `SMP-${id}`, description: 'Six power units', ...extra },
    accountId: 'a',
    insured: 'Sample Haulers',
    quoteId: 'q',
    marketName: 'Sample Mutual',
    marketBound: true,
    assignedUserId: 'agent-a',
  });
  const base = { carrierRateOf: () => 0.15, carrierCentsOf: (r: PolicyRow) => r.policy.netPremiumCents * 0.15, commissionOf: (r: PolicyRow) => r.policy.netPremiumCents * 0.03, agentNameOf: () => 'Agent A', filters: ['Show: Policies'], dateField: 'boundDate' as const, from: '2026-10-01', to: '2026-10-31' };

  it('admins get the carrier columns; agents don’t', () => {
    const admin = policiesReport([row('1', 1_000_000), row('2', 500_000, { kind: 'endorsement' })], { ...base, isAdmin: true, withCommission: true });
    expect(admin.columns.map((c) => c.header)).toContain('Carrier commission');
    expect(admin.rows).toHaveLength(2);
    expect(admin.rows[0].slice(0, 5)).toEqual(['Sample Haulers', 'SMP-1', 'New business', 'Six power units', 'Sample Mutual']);
    expect(admin.totals?.[0]).toBe('Total: 1 policy, 1 endorsement');
    expect(admin.subtitle).toContain('Show: Policies');
    const agent = policiesReport([row('1', 1_000_000)], { ...base, isAdmin: false, withCommission: true });
    expect(agent.columns.map((c) => c.header)).not.toContain('Carrier commission');
    expect(agent.columns.map((c) => c.header)).not.toContain('Carrier %');
    expect(reportCsv(agent)).not.toMatch(/15%/);
  });
});
