import type { AccountNote } from '../../types';
import type { MarketQuote } from '../../types/workflow';
import { maskSensitive } from '../emailAssistant/aiExtractor';

/** Kept equal to MAX_NOTES_TEXT in supabase/functions/extract-document-vision/summary.ts. */
export const MAX_NOTES_TEXT = 30_000;

/**
 * The account's notes and its markets' notes as one text for the Summarize button (0082), oldest first,
 * one line each: "2026-10-20 [Market: Progressive] Ada: wants loss runs". Account numbers and SSNs are
 * masked. When it's too long the oldest lines are left out. Empty when there are no notes.
 */
export function buildNotesText(notes: AccountNote[] | undefined, quotes: MarketQuote[]): string {
  const lines: { at: string; line: string }[] = [];
  for (const n of notes ?? []) {
    if (n.text.trim()) lines.push({ at: n.createdAt, line: `[Account] ${n.authorName ? `${n.authorName}: ` : ''}${n.text.trim()}` });
  }
  for (const q of quotes) {
    for (const n of q.notes ?? []) {
      if (n.text.trim()) lines.push({ at: n.createdAt, line: `[Market: ${q.marketName}] ${n.authorName ? `${n.authorName}: ` : ''}${n.text.trim()}` });
    }
  }
  lines.sort((a, b) => a.at.localeCompare(b.at));
  const out = lines.map((l) => maskSensitive(`${l.at.slice(0, 10)} ${l.line.replace(/\s+/g, ' ')}`));
  let total = out.reduce((n, l) => n + l.length + 1, 0);
  while (out.length > 1 && total > MAX_NOTES_TEXT) total -= out.shift()!.length + 1;
  return out.join('\n').slice(-MAX_NOTES_TEXT);
}

/** A fingerprint of the notes text: a saved summary made from different notes is out of date. */
export function notesHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${text.length.toString(36)}-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
