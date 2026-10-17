import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Clock, History, Plus, Search, StickyNote } from 'lucide-react';
import { ACCOUNT_STAGE_LABELS } from '../../types';
import { Badge, Button, Card, CardBody } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { effectiveAccountStage } from '../../services/workflow/accountStage';
import { formatShortDate, toLocalDateKey, todayKey } from '../../services/workflow/dates';
import { buildClientHistory, searchHistory, type HistoryEntry, type HistoryScope } from '../../services/workflow/clientHistory';
import { EVENT_ICON, EVENT_TONE } from '../history/activityIcons';
import { inputClass } from './formStyles';
import { cn } from '../../utils/cn';

const SCOPES: { key: HistoryScope; label: string }[] = [
  { key: 'key', label: 'Key events' },
  { key: 'notes', label: 'Notes' },
  { key: 'all', label: 'Everything' },
];
const PAGE = 25;
const COMPACT = 3;
const EMPTY: never[] = [];

/**
 * "What happened with this client" — beside the markets on wide screens, above them (latest few,
 * expandable) on narrower ones. Notes, quotes, market status changes and the rest of the client's
 * story in one searchable timeline, newest first. Reads what the account already has.
 */
export function ClientHistoryPanel({ accountId, onOpenMarket }: { accountId: string; onOpenMarket: (quoteId: string) => void }) {
  const { account, items, quotes, effectiveDate } = useAccountWorkflow(accountId);
  const events = useAccountsStore((s) => s.activityLog[accountId]) ?? EMPTY;
  const addAccountNote = useAccountsStore((s) => s.addAccountNote);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const members = useAccountsStore((s) => s.agencyMembers);
  const [scope, setScope] = useState<HistoryScope>('key');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');
  const wide = useWide();
  const [expanded, setExpanded] = useState(false);

  const all = useMemo(() => buildClientHistory({ events, accountNotes: account?.notes ?? [], quotes }, scope), [events, account?.notes, quotes, scope]);
  const matches = useMemo(() => searchHistory(all, query), [all, query]);
  useEffect(() => setShown(PAGE), [scope, query]);
  if (!account) return null;

  const compact = !wide && !expanded && !query;
  const list = matches.slice(0, compact ? COMPACT : shown);
  const { stage, manual } = effectiveAccountStage(account, items, quotes);
  const lastAt = all[0]?.at;
  const actor = (e: HistoryEntry) => (e.actorId && e.actorId === currentUserId ? 'You' : (members.find((m) => m.userId === e.actorId)?.name ?? e.actorName));

  function save(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    addAccountNote(accountId, note);
    setNote('');
    setAdding(false);
  }

  return (
    <Card className="xl:sticky xl:top-4" data-testid="client-history">
      <CardBody className="flex flex-col gap-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
              <History size={15} aria-hidden /> Client history
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-500)]" data-testid="history-summary">
              <Badge tone="neutral">{ACCOUNT_STAGE_LABELS[stage]}{manual ? '' : ' · auto'}</Badge>
              {effectiveDate && <span>Renewal {formatShortDate(effectiveDate)}</span>}
              {lastAt && <span>Last update {formatShortDate(lastAt)}</span>}
            </p>
          </div>
          {!adding && (
            <Button size="sm" variant="secondary" className="shrink-0 whitespace-nowrap" icon={<Plus size={13} />} title="Add a note to this account (shows here and on the Notes tab)" onClick={() => setAdding(true)}>
              Add note
            </Button>
          )}
        </div>

        {adding && (
          <form onSubmit={save} className="flex flex-col gap-2" data-testid="history-add-note">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={inputClass} placeholder="What happened? e.g. Client asked to keep the same deductible; call back Friday" autoFocus aria-label="New note" />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!note.trim()}>
                Save note
              </Button>
            </div>
          </form>
        )}

        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-8`} placeholder="Search history" aria-label="Search history" />
          </div>
          <div className="flex gap-1 rounded-lg bg-[var(--color-ink-50)] p-1" role="group" aria-label="Show">
            {SCOPES.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={scope === s.key}
                onClick={() => setScope(s.key)}
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-xs font-medium cursor-pointer',
                  scope === s.key ? 'bg-white text-[var(--color-ink-900)] shadow-sm' : 'text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)]'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {matches.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--color-ink-500)]" data-testid="history-empty">
            {query ? 'Nothing in the history matches that search.' : scope === 'notes' ? 'No notes yet — add the first one above.' : 'Nothing recorded yet.'}
          </p>
        ) : (
          <ol className={cn('flex flex-col', wide && 'max-h-[calc(100vh-15rem)] overflow-y-auto scrollbar-thin pr-1')} data-testid="history-list">
            {list.map((e, i) => {
              const day = dayLabel(e.at);
              const showDay = i === 0 || dayLabel(list[i - 1].at) !== day;
              return (
                <li key={e.id} data-entry={e.kind}>
                  {showDay && <p className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)] first:mt-0">{day}</p>}
                  <Entry entry={e} actor={actor(e)} onOpenMarket={onOpenMarket} />
                </li>
              );
            })}
          </ol>
        )}

        {compact && matches.length > COMPACT && (
          <button onClick={() => setExpanded(true)} className="self-start text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
            Show full history ({matches.length})
          </button>
        )}
        {!compact && matches.length > list.length && (
          <button onClick={() => setShown((n) => n + PAGE)} className="self-start text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
            Show older ({matches.length - list.length})
          </button>
        )}
      </CardBody>
    </Card>
  );
}

function Entry({ entry: e, actor, onOpenMarket }: { entry: HistoryEntry; actor?: string; onOpenMarket: (quoteId: string) => void }) {
  const isNote = e.kind !== 'event';
  const Icon = isNote ? StickyNote : ((e.type && EVENT_ICON[e.type]) ?? Clock);
  const time = new Date(e.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return (
    <div className={cn('flex gap-2.5 rounded-lg px-2 py-2', isNote && 'bg-[var(--color-warning-100)]/45')}>
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          isNote ? 'bg-[var(--color-warning-100)] text-[var(--color-warning-600)]' : ((e.type && EVENT_TONE[e.type]) ?? 'bg-[var(--color-ink-50)] text-[var(--color-ink-500)]')
        )}
      >
        <Icon size={13} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('break-words text-sm', isNote ? 'whitespace-pre-line text-[var(--color-ink-900)]' : 'text-[var(--color-ink-700)]')}>{e.text}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--color-ink-400)]">
          <span>{time}</span>
          {actor && <span>· {actor}</span>}
          {e.kind === 'account_note' && <span>· Account note</span>}
          {e.quoteId && e.marketName && (
            <>
              <span>·</span>
              <button onClick={() => onOpenMarket(e.quoteId!)} className="font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer" title="Show this market">
                {e.marketName}
              </button>
            </>
          )}
          {e.editedAt && <span>· edited {formatShortDate(e.editedAt)}{e.editedBy ? ` by ${e.editedBy}` : ''}</span>}
        </p>
      </div>
    </div>
  );
}

function dayLabel(iso: string): string {
  const key = toLocalDateKey(new Date(iso));
  const today = todayKey();
  if (key === today) return 'Today';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === toLocalDateKey(y)) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(key.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
}

/** Wide screens (≥ 1280px) show the history beside the markets, in full. */
function useWide(): boolean {
  const query = '(min-width: 1280px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}
