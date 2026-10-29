import { describe, expect, it } from 'vitest';
import { buildNotesText, MAX_NOTES_TEXT, notesHash } from '../notesSummary';
import { MAX_NOTES_TEXT as SERVER_MAX, summaryFrom, validateNotesRequest } from '../../../../supabase/functions/extract-document-vision/summary';
import type { MarketQuote } from '../../../types/workflow';

const quote = (marketName: string, notes: { text: string; createdAt: string; authorName?: string }[]) =>
  ({ id: marketName, accountId: 'a1', marketName, status: 'submitted', notes: notes.map((n, i) => ({ id: `n${i}`, ...n })), createdAt: '', updatedAt: '' }) as unknown as MarketQuote;

describe('notes summary text', () => {
  it('puts account and market notes in date order, labelled', () => {
    const text = buildNotesText(
      [{ id: 'x', text: 'Client wants quotes by Friday', createdAt: '2026-10-02T10:00:00Z', authorName: 'Ada' }],
      [quote('Progressive', [{ text: 'Asked for loss runs', createdAt: '2026-10-01T09:00:00Z', authorName: 'Ben' }])]
    );
    expect(text).toBe('2026-10-01 [Market: Progressive] Ben: Asked for loss runs\n2026-10-02 [Account] Ada: Client wants quotes by Friday');
  });

  it('is empty without notes, and masks SSNs', () => {
    expect(buildNotesText(undefined, [quote('Acme', [])])).toBe('');
    expect(buildNotesText([{ id: 'x', text: 'SSN 123-45-6789', createdAt: '2026-10-01', authorName: 'Ada' }], [])).toContain('[removed]');
  });

  it('leaves out the oldest notes when too long', () => {
    const notes = Array.from({ length: 80 }, (_, i) => ({ id: `${i}`, text: `${i} ${'x'.repeat(600)}`, createdAt: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`, authorName: 'Ada' }));
    const text = buildNotesText(notes, []);
    expect(text.length).toBeLessThanOrEqual(MAX_NOTES_TEXT);
    expect(MAX_NOTES_TEXT).toBe(SERVER_MAX);
  });

  it('changes the fingerprint when a note changes', () => {
    expect(notesHash('a')).toBe(notesHash('a'));
    expect(notesHash('a')).not.toBe(notesHash('b'));
  });

  it('server side: checks the request and reads the answer', () => {
    expect(validateNotesRequest({ notesText: ' ' }).ok).toBe(false);
    expect(validateNotesRequest({ notesText: 'x'.repeat(SERVER_MAX + 1) }).ok).toBe(false);
    expect(validateNotesRequest({ notesText: 'hi' })).toEqual({ ok: true, text: 'hi' });
    expect(summaryFrom({ summary: '  Waiting on loss runs. ' })).toBe('Waiting on loss runs.');
    expect(summaryFrom({})).toBeNull();
  });
});
