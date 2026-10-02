import { describe, expect, it } from 'vitest';
import { placeTranscript, validateTranscript } from '../visionTranscript';

describe('AI transcription for the preview', () => {
  it('keeps only well-formed lines; boxes become fractions', () => {
    const lines = validateTranscript({
      lines: [
        { text: '  4d DLN  X481-552 ', box: [300, 150, 800, 200] },
        { text: '', box: [0, 0, 10, 10] },
        { text: 'no box' },
        { text: 'bad box', box: [1, 2, 3] },
        { text: 'swapped', box: [900, 400, 100, 300] },
        { text: 'out of range', box: [-50, 10, 2000, 60] },
        { text: 42, box: [0, 0, 100, 100] },
      ],
    });
    expect(lines).toEqual([
      { text: '4d DLN X481-552', box: { x0: 0.3, y0: 0.15, x1: 0.8, y1: 0.2 } },
      { text: 'swapped', box: { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.4 } },
      { text: 'out of range', box: { x0: 0, y0: 0.01, x1: 1, y1: 0.06 } },
    ]);
    expect(validateTranscript({ lines: [] })).toBeNull();
    expect(validateTranscript('nope')).toBeNull();
  });

  it('a line snaps to the exact words OCR found on the same row; otherwise keeps the AI box', () => {
    const page = { width: 1000, height: 500 };
    const ai = [
      { text: 'ORLANDO, FL 32801', box: { x0: 0.3, y0: 0.4, x1: 0.6, y1: 0.46 } },
      { text: 'NONE', box: { x0: 0.3, y0: 0.8, x1: 0.4, y1: 0.85 } },
    ];
    // OCR ran on a canvas twice the image width: boxes are scaled back by 0.5.
    const ocr = { ocrWidth: 2000, lines: [{ words: [{ text: 'ORLAND0,', x0: 610, y0: 412, x1: 800, y1: 452 }, { text: 'FL', x0: 820, y0: 412, x1: 870, y1: 452 }, { text: '3280l', x0: 890, y0: 412, x1: 1010, y1: 452 }] }] };
    const placed = placeTranscript(ai, page, ocr);
    expect(placed[0].words[0]).toEqual({ text: 'ORLANDO, FL 32801', x0: 305, y0: 206, x1: 505, y1: 226 });
    expect(placed[1].words[0]).toEqual({ text: 'NONE', x0: 300, y0: 400, x1: 400, y1: 425 });
  });
});
