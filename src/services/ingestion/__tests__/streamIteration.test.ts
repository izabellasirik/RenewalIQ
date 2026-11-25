import { describe, expect, it } from 'vitest';
import { addStreamIteration } from '../streamIteration';

/** A stream class like Safari's: no `for await`. */
class SafariStream<T> extends ReadableStream<T> {}
const proto = SafariStream.prototype as unknown as Record<PropertyKey, unknown>;
Object.defineProperty(proto, Symbol.asyncIterator, { value: undefined, configurable: true, writable: true });
Object.defineProperty(proto, 'values', { value: undefined, configurable: true, writable: true });

describe('looping over a stream where the browser can’t (Safari)', () => {
  it('reads every chunk in order once added', async () => {
    addStreamIteration(proto as never);
    const s = new SafariStream<number>({ start(c) { [1, 2, 3].forEach((n) => c.enqueue(n)); c.close(); } });
    const got: number[] = [];
    for await (const n of s as unknown as AsyncIterable<number>) got.push(n);
    expect(got).toEqual([1, 2, 3]);
  });
  it('stopping early cancels the stream', async () => {
    let cancelled = false;
    const s = new SafariStream<number>({ pull(c) { c.enqueue(1); }, cancel() { cancelled = true; } });
    for await (const n of s as unknown as AsyncIterable<number>) if (n) break;
    expect(cancelled).toBe(true);
  });
  it('leaves a browser that has it alone', () => {
    const native = (ReadableStream.prototype as unknown as Record<PropertyKey, unknown>)[Symbol.asyncIterator];
    addStreamIteration();
    expect((ReadableStream.prototype as unknown as Record<PropertyKey, unknown>)[Symbol.asyncIterator]).toBe(native);
  });
});
