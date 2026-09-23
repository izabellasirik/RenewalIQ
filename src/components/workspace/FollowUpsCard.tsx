import { useState, type FormEvent } from 'react';
import { CalendarClock, Check, Plus, Trash2 } from 'lucide-react';
import { Button, Card, CardBody } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { addBusinessDays, formatShortDate, todayKey } from '../../services/workflow/dates';
import { DateInput } from './DateInput';
import { inputClass, labelClass, smallInputClass } from './formStyles';
import { cn } from '../../utils/cn';

/**
 * Follow-ups the broker schedules by hand — who, when, and optional notes. Each shows on Today's
 * Plate on its date (under "Coming up" the week before) until it's marked done.
 */
export function FollowUpsCard({ accountId }: { accountId: string }) {
  const { followUps, contacts, quotes } = useAccountWorkflow(accountId);
  const addFollowUp = useAccountsStore((s) => s.addFollowUp);
  const updateFollowUp = useAccountsStore((s) => s.updateFollowUp);
  const completeFollowUp = useAccountsStore((s) => s.completeFollowUp);
  const deleteFollowUp = useAccountsStore((s) => s.deleteFollowUp);

  const [adding, setAdding] = useState(false);
  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState(addBusinessDays(new Date(), 2));
  const [notes, setNotes] = useState('');
  const [showDone, setShowDone] = useState(false);

  const open = [...followUps].filter((f) => !f.doneAt).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const done = [...followUps].filter((f) => f.doneAt).sort((a, b) => (a.doneAt! < b.doneAt! ? 1 : -1));
  const suggestions = [...new Set([...contacts.map((c) => c.name), ...quotes.map((q) => q.marketName)])];
  const today = todayKey();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !dueDate) return;
    addFollowUp(accountId, { subject, dueDate, notes });
    setSubject('');
    setNotes('');
    setDueDate(addBusinessDays(new Date(), 2));
    setAdding(false);
  }

  return (
    <Card>
      <CardBody className="pt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
            <CalendarClock size={16} className="text-[var(--color-ink-500)]" />
            Follow-ups
          </h3>
          {!adding && (
            <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer">
              <Plus size={12} /> Add follow-up
            </button>
          )}
        </div>

        {adding && (
          <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 sm:grid-cols-[2fr_1fr]">
            <div>
              <label className={labelClass} htmlFor="fu-subject">
                Follow up for
              </label>
              <input id="fu-subject" value={subject} onChange={(e) => setSubject(e.target.value)} list={`fu-suggest-${accountId}`} className={inputClass} placeholder="e.g. Sara — renewal questions, Progressive quote" autoFocus />
              <datalist id={`fu-suggest-${accountId}`}>
                {suggestions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelClass} htmlFor="fu-date">
                Follow-up date
              </label>
              <input id="fu-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="fu-notes">
                Notes (optional)
              </label>
              <textarea id="fu-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} placeholder="e.g. Confirm new driver start date" />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!subject.trim() || !dueDate}>
                Save follow-up
              </Button>
            </div>
          </form>
        )}

        <ul className="mt-3 flex flex-col gap-2">
          {open.length === 0 && !adding && <li className="text-sm italic text-[var(--color-ink-400)]">No follow-ups scheduled.</li>}
          {open.map((f) => {
            const due = f.dueDate <= today;
            return (
              <li key={f.id} className={cn('rounded-lg border px-3 py-2', due ? 'border-[var(--color-danger-100)] bg-[var(--color-danger-100)]/30' : 'border-[var(--color-ink-100)]')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-ink-800)]">{f.subject}</p>
                    {f.notes && <p className="mt-0.5 whitespace-pre-line text-xs text-[var(--color-ink-600)]">{f.notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button onClick={() => completeFollowUp(accountId, f.id)} className="rounded-md p-1.5 text-[var(--color-success-600)] hover:bg-[var(--color-success-100)] cursor-pointer" aria-label={`Mark follow-up for ${f.subject} done`} title="Done">
                      <Check size={14} />
                    </button>
                    <button onClick={() => deleteFollowUp(accountId, f.id)} className="rounded-md p-1.5 text-[var(--color-ink-300)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] cursor-pointer" aria-label={`Remove follow-up for ${f.subject}`} title="Remove">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <label className={cn('mt-1 inline-flex items-center gap-1.5 text-xs', due ? 'font-medium text-[var(--color-danger-600)]' : 'text-[var(--color-ink-500)]')}>
                  {due ? (f.dueDate < today ? 'Overdue' : 'Due today') : 'Due'}
                  <DateInput value={f.dueDate} onCommit={(v) => v && updateFollowUp(accountId, f.id, { dueDate: v })} className={smallInputClass} aria-label={`Date for follow-up for ${f.subject}`} />
                </label>
              </li>
            );
          })}
        </ul>

        {done.length > 0 && (
          <div className="mt-3">
            <button onClick={() => setShowDone((v) => !v)} className="text-xs font-medium text-[var(--color-ink-500)] hover:underline cursor-pointer">
              {showDone ? 'Hide' : 'Show'} completed ({done.length})
            </button>
            {showDone && (
              <ul className="mt-2 flex flex-col gap-1">
                {done.map((f) => (
                  <li key={f.id} className="text-xs text-[var(--color-ink-500)]">
                    <span className="line-through">{f.subject}</span> · done {formatShortDate(f.doneAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
