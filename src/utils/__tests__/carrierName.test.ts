import { describe, expect, it } from 'vitest';
import { cleanCarrierName } from '../carrierName';

describe('carrier names off a report header', () => {
  it('drops page footers and stray separators', () => {
    expect(cleanCarrierName('Cover Whale Insurance Solutions, Inc. | Page 1 of 1')).toBe('Cover Whale Insurance Solutions, Inc.');
    expect(cleanCarrierName('Progressive Page 2 of 3')).toBe('Progressive');
    expect(cleanCarrierName('Great West Casualty -')).toBe('Great West Casualty');
    expect(cleanCarrierName('Northland Insurance Company')).toBe('Northland Insurance Company');
  });
});
