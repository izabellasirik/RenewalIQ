import { describe, expect, it } from 'vitest';
import { formatDateRange } from '../dates';

describe('formatDateRange', () => {
  const y = new Date().getFullYear();
  it('one month, two months, other years, one day', () => {
    expect(formatDateRange(`${y}-11-16`, `${y}-11-22`)).toBe('Nov 16–22');
    expect(formatDateRange(`${y}-11-30`, `${y}-12-06`)).toBe('Nov 30–Dec 6');
    expect(formatDateRange(`${y}-11-16`, `${y}-11-16`)).toBe('Nov 16');
    expect(formatDateRange('2020-11-16', '2020-11-22')).toBe('Nov 16–22, 2020');
    expect(formatDateRange('2019-12-28', '2020-01-03')).toBe('Dec 28, 2019–Jan 3, 2020');
  });
});
