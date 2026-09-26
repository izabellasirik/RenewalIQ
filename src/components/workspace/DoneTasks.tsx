import { useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import type { ActionItem } from '../../services/workflow/nextActions';
import type { FollowUp } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { formatShortDate } from '../../services/workflow/dates';

const SHOWN = 5;

/**
 * Tasks marked done on this account — tasks checked off with Done and completed follow-ups — newest
 * first, each with Undo to put it back under Needs your attention.
 */
export function DoneTasks({ accountId, doneActions, followUps }: { accountId: string; doneActions: { action: ActionItem; key: string; doneAt: string }[]; followUps: FollowUp[] }) {
  const undoActionDone = useAccountsStore((s) => s.undoActionDone);
  const reopenFollowUp = useAccountsStore((s) => s.reopenFollowUp);
  const [showAll, setShowAll] = useState(false);

  const rows = [
    ...doneActions.map((d) => ({ id: d.key, title: d.action.title, doneAt: d.doneAt, undo: () => undoActionDone(accountId, d.key, d.action.title) })),
    ...followUps.filter((f) => f.doneAt).map((f) => ({ id: f.id, title: `Follow up: ${f.subject}`, doneAt: f.doneAt!, undo: () => reopenFollowUp(accountId, f.id) })),
  ].sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));
  if (rows.length === 0) return null;
  const shown = showAll ? rows : rows.slice(0, SHOWN);

  return (
    <>
      <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Done</h4>
      <ul className="flex flex-col gap-1.5">
        {shown.map((r) => (
          <li key={r.id} className="flex items-center gap-2.5 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] px-3 py-2">
            <CheckCircle2 size={15} className="shrink-0 text-[var(--color-success-600)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-[var(--color-ink-500)] line-through">{r.title}</p>
              <p className="text-xs text-[var(--color-ink-400)]">Done {formatShortDate(r.doneAt)}</p>
            </div>
            <button
              onClick={r.undo}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer"
              aria-label={`Undo: ${r.title}`}
            >
              <RotateCcw size={12} /> Undo
            </button>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-medium text-[var(--color-ink-500)] hover:underline cursor-pointer">
          {showAll ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}
