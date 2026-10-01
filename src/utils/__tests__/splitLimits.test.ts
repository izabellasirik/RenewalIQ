import { describe, expect, it } from 'vitest';
import { normalizeCurrencyText } from '../currency';
import { mapCoverageTable } from '../../services/extraction/fieldExtraction/tableMappers';

describe('split limits (per occurrence / aggregate)', () => {
  it('formats each part, never running them together', () => {
    for (const raw of ['1,000,000/2,000,000', '$1,000,000/$2,000,000', '$1,000,000 / $2,000,000', '1M/2M', '1000000/2000000']) {
      expect(normalizeCurrencyText(raw), raw).toBe('$1,000,000/$2,000,000');
    }
    expect(normalizeCurrencyText('$1M/$2M/$1M')).toBe('$1,000,000/$2,000,000/$1,000,000');
  });
  it('single amounts and free text behave as before', () => {
    expect(normalizeCurrencyText('1000000')).toBe('$1,000,000');
    expect(normalizeCurrencyText('$1,000,000')).toBe('$1,000,000');
    expect(normalizeCurrencyText('$1M/$2M CSL')).toBe('$1M/$2M CSL');
    expect(normalizeCurrencyText('Statutory')).toBe('Statutory');
    expect(normalizeCurrencyText('$1,000,000/$2,000,000')).toBe(normalizeCurrencyText(normalizeCurrencyText('$1,000,000/$2,000,000')));
  });
  it('repairs a split limit an earlier version merged into one number — only when unambiguous', () => {
    expect(normalizeCurrencyText('$10,000,002,000,000')).toBe('$1,000,000/$2,000,000');
    expect(normalizeCurrencyText('10000001000000')).toBe('$1,000,000/$1,000,000');
    expect(normalizeCurrencyText('$5,000,000')).toBe('$5,000,000'); // a real limit is never touched
    expect(normalizeCurrencyText('$25,000,000')).toBe('$25,000,000');
  });
});

describe('coverage table on a document', () => {
  it('"$1,000,000/$2,000,000" in the limit column stays a split limit', () => {
    const rows = mapCoverageTable({ headers: ['Coverage', 'Requested Limit'], rows: [['General Liability', '$1,000,000/$2,000,000'], ['Auto Liability', '$1,000,000 CSL']] } as never);
    expect(rows.map((r) => r.requestedLimit)).toEqual(['$1,000,000/$2,000,000', '$1,000,000']);
  });
});
