import { describe, expect, it } from 'vitest';
import { uniqueNames } from '../downloadDocuments';

describe('download all', () => {
  it('gives every file in the ZIP its own name', () => {
    expect(uniqueNames(['loss run.pdf', 'Loss Run.pdf', 'loss run.pdf', 'drivers.xlsx', 'a/b:c.pdf', ''])).toEqual([
      'loss run.pdf',
      'Loss Run (2).pdf',
      'loss run (3).pdf',
      'drivers.xlsx',
      'a_b_c.pdf',
      'document',
    ]);
  });
});
