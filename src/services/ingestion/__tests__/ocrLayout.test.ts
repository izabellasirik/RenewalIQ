import { describe, expect, it } from 'vitest';
import { pageSlope } from '../ocr';

describe('scan tilt', () => {
  it('is the median slope of long baselines; short or wild ones are ignored', () => {
    const line = (x0: number, y0: number, x1: number, y1: number) => ({ baseline: { x0, y0, x1, y1 } });
    expect(pageSlope([line(0, 100, 1000, 107), line(0, 200, 1000, 207), line(0, 300, 1000, 208), line(0, 0, 50, 40), line(0, 0, 1000, 500)])).toBeCloseTo(0.007, 3);
    expect(pageSlope([])).toBe(0);
  });
});
