import { describe, expect, it } from 'vitest';
import type { AccountNote, ActivityEvent, MarketQuote } from '../../../types';
import { buildClientHistory, latestMarketNote, searchHistory } from '../clientHistory';

const ev = (id: string, type: ActivityEvent['type'], message: string, timestamp: string, actor = 'Roman Smith'): ActivityEvent => ({ id, accountId: 'a1', type, message, timestamp, actorName: actor });
const quote = (id: string, marketName: string, notes: MarketQuote['notes'] = []): MarketQuote => ({ id, accountId: 'a1', marketName, status: 'quoted', notes, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-10T10:00:00Z' });
const longNote = 'Underwriter wants five years of loss runs and the IFTA filings before quoting the cargo option — client says Friday at the latest; also asked about the dashcam discount for the new trucks.';

const quotes = [
  quote('q1', 'Prairie Mutual (sample)', [{ id: 'n1', text: longNote, createdAt: '2026-10-08T15:00:00Z', authorName: 'Roman Smith' }]),
  quote('q2', 'Gulf Coast Specialty (sample)'),
];
const accountNotes: AccountNote[] = [{ id: 'an1', text: 'Client prefers calls after 3pm.', createdAt: '2026-10-09T09:00:00Z', authorName: 'Roman Smith', updatedAt: '2026-10-11T09:00:00Z', updatedByName: 'Sara Lee' }];
const events: ActivityEvent[] = [
  ev('e1', 'market_added', 'Added Prairie Mutual (sample) to Markets & Quotes.', '2026-10-02T10:00:00Z'),
  ev('e2', 'submission_sent', 'Submission sent to Prairie Mutual (sample) on Oct 2.', '2026-10-02T10:05:00Z'),
  ev('e3', 'follow_up_scheduled', 'Carrier follow-up with Prairie Mutual (sample) set for Oct 7.', '2026-10-02T10:05:01Z'),
  // The activity line written when the market note was added (shortened to 140 characters).
  ev('e4', 'carrier_note_added', `Note on Prairie Mutual (sample): ${longNote.slice(0, 140)}…`, '2026-10-08T15:00:00Z'),
  ev('e5', 'quote_received', 'Prairie Mutual (sample) quoted $18,750 (Option A).', '2026-10-08T16:00:00Z'),
  ev('e6', 'quote_received', 'Prairie Mutual (sample) quoted $18,750 (Option A).', '2026-10-08T16:00:40Z'),
  ev('e7', 'field_corrected', 'Corrected DOT number.', '2026-10-09T08:00:00Z'),
  ev('e8', 'carrier_declined', 'Gulf Coast Specialty (sample) declined: outside appetite.', '2026-10-10T12:00:00Z'),
  // A note on a market that was later removed: the activity line is the only trace left.
  ev('e9', 'carrier_note_added', 'Note on Summit Casualty (sample): Not writing trucking this quarter.', '2026-10-05T12:00:00Z'),
  ev('e10', 'market_removed', 'Removed Summit Casualty (sample) from Markets & Quotes.', '2026-10-06T12:00:00Z'),
];

describe('client history', () => {
  const key = buildClientHistory({ events, accountNotes, quotes }, 'key');
  const ids = key.map((e) => e.id);

  it('newest first, with account notes, market notes and the key events', () => {
    expect(ids).toEqual(['ev-e8', 'an-an1', 'ev-e6', 'mn-q1-n1', 'ev-e10', 'ev-e2', 'ev-e1']);
  });
  it('a market note appears once, in full — not also as its shortened activity line', () => {
    expect(key.filter((e) => e.text.includes('Underwriter wants five years'))).toHaveLength(1);
    expect(key.find((e) => e.id === 'mn-q1-n1')).toMatchObject({ kind: 'market_note', quoteId: 'q1', text: longNote });
    expect(ids).not.toContain('ev-e4');
  });
  it('the same line saved twice moments apart shows once (the newest)', () => {
    expect(key.filter((e) => e.type === 'quote_received')).toHaveLength(1);
    expect(ids).toContain('ev-e6');
  });
  it('clutter (field edits, routine follow-up scheduling) only under “Everything”', () => {
    expect(ids).not.toContain('ev-e7');
    expect(ids).not.toContain('ev-e3');
    const everything = buildClientHistory({ events, accountNotes, quotes }, 'all').map((e) => e.id);
    expect(everything).toEqual(expect.arrayContaining(['ev-e7', 'ev-e3']));
    expect(everything).not.toContain('ev-e4');
  });
  it('“Notes” shows only notes', () => {
    expect(buildClientHistory({ events, accountNotes, quotes }, 'notes').map((e) => e.kind)).toEqual(['account_note', 'market_note']);
  });
  it('events are linked to the market they name (for “show this market”)', () => {
    expect(key.find((e) => e.id === 'ev-e8')).toMatchObject({ quoteId: 'q2', marketName: 'Gulf Coast Specialty (sample)' });
    expect(key.find((e) => e.id === 'ev-e10')?.quoteId).toBeUndefined();
  });
  it('an edited note shows once, labelled as edited', () => {
    expect(key.find((e) => e.id === 'an-an1')).toMatchObject({ editedBy: 'Sara Lee', editedAt: '2026-10-11T09:00:00Z' });
  });
  it('an event delivered twice (same id, e.g. through sync) shows once', () => {
    const twice = buildClientHistory({ events: [...events, { ...events[0] }], accountNotes, quotes }, 'key');
    expect(twice.filter((e) => e.id === 'ev-e1')).toHaveLength(1);
  });
  it('“Everything” keeps the note line of a market that was later removed (its only trace)', () => {
    const removedNote = buildClientHistory({ events, accountNotes, quotes }, 'all').find((e) => e.id === 'ev-e9');
    expect(removedNote?.text).toMatch(/Not writing trucking/);
  });
  it('search: every word must match, across text, market and who', () => {
    expect(searchHistory(key, 'loss runs').map((e) => e.id)).toEqual(['mn-q1-n1']);
    expect(searchHistory(key, 'gulf declined').map((e) => e.id)).toEqual(['ev-e8']);
    expect(searchHistory(key, 'sara').map((e) => e.id)).toEqual(['an-an1']);
    expect(searchHistory(key, '  ')).toHaveLength(key.length);
    expect(searchHistory(key, 'nothing-like-this')).toEqual([]);
  });
});

describe('latest note on a collapsed market', () => {
  it('the most recently written or edited note', () => {
    const q = quote('q', 'M', [
      { id: 'a', text: 'first', createdAt: '2026-10-01T10:00:00Z' },
      { id: 'b', text: 'second', createdAt: '2026-10-03T10:00:00Z' },
      { id: 'c', text: 'edited later', createdAt: '2026-09-30T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z' },
    ]);
    expect(latestMarketNote(q)?.id).toBe('c');
    expect(latestMarketNote(quote('q', 'M'))).toBeUndefined();
  });
});
