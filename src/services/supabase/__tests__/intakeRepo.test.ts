import { describe, expect, it } from 'vitest';
import { storageSafeName } from '../intakeRepo';

describe('client file names in storage', () => {
  it('keeps ordinary names and makes awkward ones storage-safe', () => {
    expect(storageSafeName('ABC Loss Runs (2024).pdf')).toBe('ABC Loss Runs (2024).pdf');
    expect(storageSafeName('Loss Runs – 2024 (Café).pdf')).toBe('Loss Runs _ 2024 (Cafe).pdf');
    expect(storageSafeName('units#1?.xlsx')).toBe('units_1_.xlsx');
    expect(storageSafeName('📎')).toBe('_');
  });
});
