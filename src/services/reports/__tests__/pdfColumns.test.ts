import { describe, expect, it } from 'vitest';
import { brokerFeesReport } from '../analyticsReports';

describe('broker fees report', () => {
  it('the PDF leaves out the agent and agency columns; CSV and Excel keep them', () => {
    const r = brokerFeesReport([], true, '', '', []);
    expect(r.columns.filter((c) => !c.notInPdf).map((c) => c.header)).toEqual(['Bound', 'Client', 'Policy', 'Broker fee', 'Partner', 'To partner']);
    expect(r.columns.map((c) => c.header)).toContain('Agency keeps');
  });
});
