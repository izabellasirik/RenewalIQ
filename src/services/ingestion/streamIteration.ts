/**
 * Safari (iPhone / iPad, and Mac before Safari 26) can't loop over a ReadableStream with `for await`,
 * which pdf.js uses to read a page's text ("undefined is not a function (near '...e of t...')").
 * This adds the standard way to do it where it's missing. Loaded before pdf.js runs.
 */
type Iterable<T> = ReadableStream<T> & { [Symbol.asyncIterator]?: unknown; values?: unknown };

export function addStreamIteration(proto: Iterable<unknown> | undefined = typeof ReadableStream !== 'undefined' ? (ReadableStream.prototype as Iterable<unknown>) : undefined) {
  if (!proto || typeof proto[Symbol.asyncIterator] === 'function') return;
  async function* values<T>(this: ReadableStream<T>, { preventCancel = false }: { preventCancel?: boolean } = {}) {
    const reader = this.getReader();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          return;
        }
        yield value as T;
      }
    } finally {
      // Stopped early (break / error): cancel the stream, as the built-in version does.
      if (!finished && !preventCancel) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  Object.defineProperty(proto, 'values', { value: values, writable: true, configurable: true });
  Object.defineProperty(proto, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
}

addStreamIteration();
