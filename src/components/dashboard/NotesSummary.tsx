import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Account } from '../../types';
import type { MarketQuote } from '../../types/workflow';
import { useAccountsStore } from '../../state/useAccountsStore';
import { putNoteSummary, useNoteSummaries } from '../../hooks/useNoteSummaries';
import { buildNotesText, notesHash } from '../../services/notes/notesSummary';
import { summarizeNotes } from '../../services/supabase/noteSummariesRepo';
import { formatShortDate, toLocalDateKey } from '../../services/workflow/dates';

/**
 * The account card's notes summary (0082): the saved summary of the account's and its markets' notes, made by
 * AI only when someone clicks Summarize. "Notes updated" when the notes changed since it was made.
 */
export function NotesSummary({ account, quotes }: { account: Account; quotes: MarketQuote[] }) {
  const { byAccount, available } = useNoteSummaries();
  const byName = useAccountsStore((s) => s.myProfile?.fullName || s.currentUserEmail || 'Team member');
  const text = useMemo(() => buildNotesText(account.notes, quotes), [account.notes, quotes]);
  const hash = useMemo(() => notesHash(text), [text]);
  const saved = byAccount[account.id];
  const stale = !!saved && saved.notesHash !== hash;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two lines on the card; More shows the whole summary.
  const [expanded, setExpanded] = useState(false);

  async function summarize(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    const r = await summarizeNotes(account.id, text, hash, byName);
    setBusy(false);
    if (r.ok) putNoteSummary(r.data);
    else setError(r.message);
  }

  const button = available && text && (!saved || stale) && (
    <button
      type="button"
      onClick={(e) => void summarize(e)}
      disabled={busy}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--color-ink-200)] bg-white px-2 py-1 text-xs font-medium text-[var(--color-brand-800)] hover:bg-[var(--color-ink-50)] disabled:cursor-default disabled:opacity-60"
      data-testid="card-summarize"
    >
      <Sparkles size={12} aria-hidden />
      {busy ? 'Summarizing…' : 'Summarize'}
    </button>
  );

  return (
    <div className="mt-3 border-t border-[var(--color-ink-100)] pt-3 text-sm" data-testid="card-notes-summary">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[var(--color-ink-500)]">
          Notes
          {stale && <span className="rounded-full bg-[var(--color-warning-100)] px-2 py-0.5 text-xs font-medium text-[var(--color-warning-600)]">Notes updated</span>}
        </p>
        {button}
      </div>
      {saved ? (
        <>
          <p className={`mt-1 ${expanded ? '' : 'line-clamp-2'} ${stale ? 'text-[var(--color-ink-500)]' : 'text-[var(--color-ink-900)]'}`} title={saved.summary}>
            {saved.summary}
          </p>
          {saved.summary.length > 80 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="cursor-pointer text-xs font-medium text-[var(--color-brand-700)] hover:underline"
              aria-expanded={expanded}
            >
              {expanded ? 'Less' : 'More'}
            </button>
          )}
          <p className="mt-1 text-xs text-[var(--color-ink-400)]">
            Summarized {formatShortDate(toLocalDateKey(new Date(saved.createdAt)))}
            {saved.createdByName ? ` by ${saved.createdByName}` : ''}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[var(--color-ink-400)]">{text ? (available ? 'Not summarized yet.' : 'Open the account to read its notes.') : 'No notes yet.'}</p>
      )}
      {error && <p className="mt-1 text-xs text-[var(--color-danger-600)]">{error}</p>}
    </div>
  );
}
