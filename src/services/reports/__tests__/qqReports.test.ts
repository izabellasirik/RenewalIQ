import { describe, expect, it } from 'vitest';
import type { LayoutLine } from '../../ingestion/pdfLayout';
import { endorsementTotals, endorsementType, endorsementsBy, displayName, mergeReportRows, endorsementKey, moneyCents, parseQqReport, daysInForce } from '../qqReports';

// Fictional data in the QQCatalyst layout (columns by position, wrapped cells on the next lines).
let y = 600;
const line = (page: number, cells: [number, string][]): LayoutLine => ({ page, y: (y -= 10), height: 8, cells: cells.map(([x0, text]) => ({ x0, x1: x0 + text.length * 4, text })) });
const ENDO_HEADER = (p: number) => [
  line(p, [[48, 'Endorsement'], [126, 'Endorsement'], [210, 'Endorsement'], [293, 'Business'], [376, 'Agent On']]),
  line(p, [[74, 'Amount'], [126, 'Effective Date'], [210, 'Description'], [293, 'Name'], [376, 'Customer']]),
];
const endorsementsPdf: LayoutLine[] = [
  line(1, [[36, 'Endorsements']]),
  line(1, [[56, 'Endorsement Effective Date Is Between (10/01/2026 AND 10/31/2026 )']]),
  ...ENDO_HEADER(1),
  line(1, [[74, '-$1,250.00'], [126, '10/05/2026'], [210, 'Delete: 2019'], [293, 'Prairie Line'], [376, 'BEN AGENT']]),
  line(1, [[210, 'Freightliner VIN#'], [293, 'Freight LLC']]),
  line(1, [[210, '1FUJGLDR0CLBP0001']]),
  line(1, [[74, '$2,400.00'], [126, '10/12/2026'], [210, 'Add Unit:'], [293, 'Copper Line'], [376, 'Ada Admin']]),
  line(1, [[214, '- 2021 Volvo (VIN:'], [293, 'Transport']]),
  line(1, [[210, '4V4NC9EH0MN000001)']]),
  line(1, [[36, 'November 05, 2026'], [713, 'Page'], [731, '1'], [738, 'of'], [749, '2']]),
  ...ENDO_HEADER(2),
  line(2, [[78, '$0.00'], [126, '10/20/2026'], [210, 'LOSS PAYEE:'], [293, 'Copper Line'], [376, 'Ada Admin']]),
  line(2, [[210, 'Sample Bank ISAOA'], [293, 'Transport']]),
  line(2, [[78, '$310.00'], [126, '10/21/2026'], [210, 'JORDAN AVERY'], [293, 'Atlas Freight'], [376, 'ROMAN']]),
  line(2, [[210, 'CDL: 12345678'], [376, 'SAMPLE']]),
  line(2, [[36, 'GRAND TOTAL: (4 records)']]),
];

describe('QQCatalyst Endorsements report', () => {
  const parsed = parseQqReport(endorsementsPdf)!;
  const r = parsed as Extract<NonNullable<typeof parsed>, { kind: 'endorsements' }>;
  it('reads every row across pages, joining wrapped cells', () => {
    expect(r.kind).toBe('endorsements');
    expect(r.period).toContain('10/01/2026');
    expect(r.recordsStated).toBe(4);
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0]).toEqual({ amountCents: -125000, date: '2026-10-05', description: 'Delete: 2019\nFreightliner VIN#\n1FUJGLDR0CLBP0001', client: 'Prairie Line Freight LLC', agent: 'BEN AGENT' });
    expect(r.rows[1].client).toBe('Copper Line Transport');
    expect(r.rows[3].agent).toBe('ROMAN SAMPLE');
  });
  it('totals, by agent and by type', () => {
    expect(endorsementTotals(r.rows)).toEqual({ count: 4, addedCents: 271000, returnedCents: -125000, netCents: 146000, noChargeCount: 1 });
    expect(endorsementsBy(r.rows, (x) => displayName(x.agent)).map((a) => [a.key, a.totals.count, a.totals.netCents])).toEqual([['Ada Admin', 2, 240000], ['Roman Sample', 1, 31000], ['Ben Agent', 1, -125000]]);
    expect(r.rows.map((x) => endorsementType(x.description, x.amountCents))).toEqual(['Remove unit', 'Add unit', 'Loss payee / additional insured', 'Add driver']);
  });
  it('the same row in two overlapping reports counts once; two equal rows in one report both count', () => {
    const twice = [...r.rows, r.rows[0]];
    expect(mergeReportRows([r.rows, twice], endorsementKey)).toHaveLength(5);
    expect(mergeReportRows([r.rows, r.rows], endorsementKey)).toHaveLength(4);
  });
});

describe('endorsement types', () => {
  it.each([
    ['ADD: 2022 Volvo VIN# 4V4NC9EH3NN000002 Stated value $65,000', 1000, 'Add unit'],
    ['Delete: Jordan Avery, DL: F000000000001, DOB: 01/08/1990', 0, 'Remove driver'],
    ['Add: Casey Brooks, DL: F000000000002', 0, 'Add driver'],
    ['trailer interchange $60,000 limit with a $1,000 deductible.', 48600, 'Coverage / limits'],
    ['Change Physical Address to 12 Sample St, Orlando, FL 32806', 0, 'Address change'],
    ['Riley Chen Morgan Lee Avery Quinn Sample 2022 FRHT 3AKJHHDR3NSM00003', 5000, 'Add unit'],
    ['JORDAN AVERY', -2000, 'Remove driver'],
  ])('%s → %s', (desc, cents, type) => expect(endorsementType(desc, cents)).toBe(type));
  it('money as printed', () => {
    expect(moneyCents('-$5,402.00')).toBe(-540200);
    expect(moneyCents('($12.50)')).toBe(-1250);
    expect(moneyCents('$0.00')).toBe(0);
    expect(moneyCents('Amount')).toBeNull();
  });
});

describe('QQCatalyst Cancelled policies report', () => {
  y = 600;
  const pdf: LayoutLine[] = [
    line(1, [[36, 'CANCELLED']]),
    line(1, [[56, 'Cancellation Date After 09/30/2026']]),
    line(1, [[36, 'Effective Date'], [126, 'Named Insured'], [210, 'Expiration Date'], [293, 'Policy Status'], [376, 'Cancellation']]),
    line(1, [[376, 'Date']]),
    line(1, [[43, '07/07/2026'], [126, 'Prairie Line'], [210, '07/07/2027'], [293, 'Cancelled'], [376, '10/26/2026']]),
    line(1, [[126, 'Freight LLC']]),
    line(1, [[43, '10/16/2025'], [126, 'Atlas Freight'], [210, '10/16/2026'], [293, 'Cancelled'], [376, '10/16/2026']]),
    line(1, [[36, 'GRAND TOTAL: (2 records)']]),
  ];
  it('reads the cancellations and days in force', () => {
    const r = parseQqReport(pdf)!;
    expect(r.kind).toBe('cancellations');
    expect(r.rows).toEqual([
      { effectiveDate: '2026-07-07', insured: 'Prairie Line Freight LLC', expirationDate: '2027-07-07', status: 'Cancelled', cancellationDate: '2026-10-26' },
      { effectiveDate: '2025-10-16', insured: 'Atlas Freight', expirationDate: '2026-10-16', status: 'Cancelled', cancellationDate: '2026-10-16' },
    ]);
    expect(r.kind === 'cancellations' && daysInForce(r.rows[0])).toBe(111);
  });
  it('anything else is not a report', () => {
    expect(parseQqReport([line(1, [[36, 'Driver schedule']]), line(1, [[36, 'Name'], [120, 'DOB']])])).toBeNull();
  });
});

describe('commission on endorsements', () => {
  it('each row has a stable key (numbered when repeated); agency 10% then the agent split, each rounded', async () => {
    const { withRowKeys, commissionCents, DEFAULT_AGENCY_RATE } = await import('../qqReports');
    const row = { amountCents: 185301, date: '2026-09-10', description: 'Add unit (sample)', client: 'Sample Cargo LLC', agent: 'Leo Sample' };
    const keyed = withRowKeys([row, row, { ...row, amountCents: -65836 }]);
    expect(keyed[0].rowKey).not.toBe(keyed[1].rowKey);
    expect(keyed[1].rowKey.endsWith('#2')).toBe(true);
    // As in the producer statements: $1,853.01 → $185.30 agency → $55.59 at a 30% split; −$658.36 → −$65.84 → −$19.75.
    expect(commissionCents(185301, DEFAULT_AGENCY_RATE)).toBe(18530);
    expect(commissionCents(18530, 0.3)).toBe(5559);
    expect(commissionCents(-65836, DEFAULT_AGENCY_RATE)).toBe(-6584);
    expect(commissionCents(-6584, 0.3)).toBe(-1975);
  });
});

describe('QQCatalyst agent names → RenewalIQ agents', () => {
  it('a link, the same name, a name that is part of it, or a unique first name', async () => {
    const { matchQqAgent, qqNameKey } = await import('../qqReports');
    const members = [{ userId: 'd', name: 'Denis' }, { userId: 'l', name: 'Leo' }, { userId: 'v', name: 'Vic Example' }, { userId: 'a1', name: 'Ada One' }, { userId: 'a2', name: 'Ada Two' }];
    expect(matchQqAgent('DENIS PAK', members, {})).toBe('d');
    expect(matchQqAgent('VIC  EXAMPLE', members, {})).toBe('v');
    expect(matchQqAgent('Leonid Petrov', members, {})).toBeNull();
    expect(matchQqAgent('Leonid Petrov', members, { [qqNameKey('LEONID PETROV')]: 'l' })).toBe('l');
    expect(matchQqAgent('Ada Three', members, {})).toBeNull(); // two Adas: not clear
  });
});
