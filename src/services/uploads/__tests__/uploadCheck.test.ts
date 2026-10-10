import { describe, expect, it } from 'vitest';
import { storageBody } from '../uploadCheck';

describe('storageBody', () => {
  it('relabels a file the browser left untyped, without changing its bytes', async () => {
    const heic = new File([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], 'IMG_1272.HEIC', { type: '' });
    const body = storageBody(heic);
    expect(body.type).toBe('image/heic');
    expect(new Uint8Array(await body.arrayBuffer())).toEqual(new Uint8Array(await heic.arrayBuffer()));
  });

  it('keeps a correctly typed file as is', () => {
    const pdf = new File(['%PDF-1.7'], 'loss run.pdf', { type: 'application/pdf' });
    expect(storageBody(pdf)).toBe(pdf);
  });

  it('uses the extension over a wrong browser guess', () => {
    expect(storageBody(new File(['a,b'], 'drivers.csv', { type: 'application/vnd.ms-excel' })).type).toBe('text/csv');
  });
});
