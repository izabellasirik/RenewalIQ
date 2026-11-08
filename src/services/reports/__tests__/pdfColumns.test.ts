import { describe, expect, it } from 'vitest';
import { brokerFeesReport } from '../analyticsReports';

describe('broker fees report', () => {
  it('an admin’s file (PDF, Excel, CSV) has bound, client, policy, partner and to partner', () => {
    const r = brokerFeesReport([{ boundDate: '2026-10-18', clientName: 'Sample Freight LLC', policyNumber: 'PN-1', brokerFeeCents: 35000, partnerName: 'Safety', partnerCents: 5000, partnerShortfallCents: 0, agentName: 'Ben Agent', agentCents: 15000, agencyCents: 15000 } as never], true, '', '', []);
    expect(r.columns.map((c) => c.header)).toEqual(['Bound', 'Client', 'Policy', 'Partner', 'To partner']);
    expect(r.rows[0]).toEqual(['2026-10-18', 'Sample Freight LLC', 'PN-1', 'Safety', 5000]);
    expect(r.totals).toEqual(['Total', '', '', '', 5000]);
  });
});
