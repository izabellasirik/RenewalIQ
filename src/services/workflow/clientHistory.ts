import type { AccountNote, ActivityEvent, ActivityEventType, MarketQuote } from '../../types';

/**
 * The client's story for Markets & Quotes: what happened with this client, newest first, in one
 * place — account notes, market notes, quotes, market status changes and the other broker-meaningful
 * activity. Built from what the account already holds; nothing new is stored.
 *
 * No duplicates: a market note is shown from the note itself (full text, author, edits), so the
 * shorter "Note on <market>: …" activity line for it is left out; repeated identical activity lines
 * a moment apart show once.
 */

export type HistoryScope = 'key' | 'notes' | 'all';

export interface HistoryEntry {
  id: string;
  /** When it happened (ISO). */
  at: string;
  kind: 'account_note' | 'market_note' | 'event';
  type?: ActivityEventType;
  text: string;
  quoteId?: string;
  marketName?: string;
  actorId?: string;
  actorName?: string;
  editedAt?: string;
  editedBy?: string;
  event?: ActivityEvent;
}

/** What happened with the client — shown by default. The rest (document reading, field edits, checklist upkeep) is under "Everything". */
export const KEY_EVENT_TYPES: ReadonlySet<ActivityEventType> = new Set<ActivityEventType>([
  'account_created',
  'account_duplicated',
  'account_archived',
  'account_restored',
  'stage_changed',
  'broker_assigned',
  'market_added',
  'market_removed',
  'submission_sent',
  'carrier_requested_item',
  'item_sent_to_carrier',
  'quote_received',
  'carrier_declined',
  'quote_status_changed',
  'policy_bound',
  'item_requested',
  'item_received',
  'request_sent',
  'request_completed',
  'client_submitted',
  'follow_up_completed',
  'email_draft_opened',
  'renewal_updated',
]);

const NOTE_EVENT = /^Note on (.+?): ([\s\S]*)$/;
/** Identical activity lines this close together are one thing that happened. */
const SAME_EVENT_WINDOW_MS = 2 * 60 * 1000;

export function buildClientHistory(input: { events: ActivityEvent[]; accountNotes: AccountNote[]; quotes: MarketQuote[] }, scope: HistoryScope = 'key'): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  for (const n of input.accountNotes) {
    entries.push({ id: `an-${n.id}`, at: n.createdAt, kind: 'account_note', text: n.text, actorId: n.authorId, actorName: n.authorName, editedAt: n.updatedAt, editedBy: n.updatedByName });
  }
  for (const q of input.quotes) {
    for (const n of q.notes ?? []) {
      entries.push({ id: `mn-${q.id}-${n.id}`, at: n.createdAt, kind: 'market_note', text: n.text, quoteId: q.id, marketName: q.marketName, actorName: n.authorName, editedAt: n.updatedAt, editedBy: n.updatedByName });
    }
  }
  if (scope !== 'notes') {
    const quoteByName = new Map(input.quotes.map((q) => [q.marketName.trim().toLowerCase(), q]));
    const seen = new Map<string, number>();
    const events = [...input.events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
    for (const e of events) {
      if (scope === 'key' && !KEY_EVENT_TYPES.has(e.type)) continue;
      if (e.type === 'matching_run') continue;
      // A market note already shown in full: skip its activity line (it stays, for a market that was since removed).
      if (e.type === 'carrier_note_added') {
        const m = NOTE_EVENT.exec(e.message);
        const q = m ? quoteByName.get(m[1].trim().toLowerCase()) : undefined;
        const start = m ? m[2].replace(/…$/, '').trim() : '';
        if (q && start && (q.notes ?? []).some((n) => n.text.trim().startsWith(start))) continue;
      }
      // The same line repeated moments apart (e.g. a double save): keep the newest.
      const sig = `${e.type}|${e.message}|${e.actorId ?? e.actorName ?? ''}`;
      const t = Date.parse(e.timestamp);
      const last = seen.get(sig);
      if (last !== undefined && Math.abs(last - t) <= SAME_EVENT_WINDOW_MS) continue;
      seen.set(sig, t);
      const market = marketOf(e, input.quotes);
      entries.push({ id: `ev-${e.id}`, at: e.timestamp, kind: 'event', type: e.type, text: e.message, quoteId: market?.id, marketName: market?.marketName, actorId: e.actorId, actorName: e.actorName, event: e });
    }
  }
  // De-duplicate by id (an id can arrive twice through sync), newest first.
  const byId = new Map(entries.map((x) => [x.id, x]));
  return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id.localeCompare(b.id)));
}

/** The market an activity line is about, when its wording names one of this account's markets. */
function marketOf(e: ActivityEvent, quotes: MarketQuote[]): MarketQuote | undefined {
  const text = e.message.toLowerCase();
  // Longest name first, so "Gulf Coast Specialty" wins over "Gulf Coast".
  return [...quotes].sort((a, b) => b.marketName.length - a.marketName.length).find((q) => q.marketName.trim() && text.includes(q.marketName.trim().toLowerCase()));
}

export function searchHistory(entries: HistoryEntry[], query: string): HistoryEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((e) => {
    const hay = `${e.text} ${e.marketName ?? ''} ${e.actorName ?? ''} ${e.editedBy ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The market's most recent note (by when it was written or last edited), if any. */
export function latestMarketNote(q: Pick<MarketQuote, 'notes'>): MarketQuote['notes'][number] | undefined {
  const notes = q.notes ?? [];
  if (notes.length === 0) return undefined;
  return [...notes].sort((a, b) => ((a.updatedAt ?? a.createdAt) < (b.updatedAt ?? b.createdAt) ? 1 : -1))[0];
}
