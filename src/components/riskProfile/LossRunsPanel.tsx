import { useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, FileClock, Pencil, Plus, Trash2 } from 'lucide-react';
import type { LossEntry, LossRun } from '../../types';
import { Button, ConfirmDialog } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { formatShortDate } from '../../services/workflow/dates';
import { inputClass, labelClass, linkButtonClass } from '../workspace/formStyles';
import { LossHistoryTable } from './LossHistoryTable';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Claim count and totals: the linked claims when they're itemized, otherwise what the report states. */
export function lossRunTotals(run: LossRun, claims: LossEntry[]): { claims: number | null; incurred: number | null; paid: number | null; reserve: number | null; itemized: boolean } {
  if (claims.length > 0) {
    const sum = (k: 'incurred' | 'paid' | 'reserved') => claims.reduce((t, c) => t + (Number(c[k]) || 0), 0);
    return { claims: claims.length, incurred: sum('incurred'), paid: sum('paid'), reserve: sum('reserved'), itemized: true };
  }
  return { claims: run.claimCount ?? null, incurred: run.totalIncurred ?? null, paid: run.totalPaid ?? null, reserve: run.totalReserve ?? null, itemized: false };
}

/**
 * Loss runs as records: one card per report (carrier, policy, report date, coverage period, claim
 * count and totals), collapsed by default; expanding shows that report's claims. Claims not on any
 * report are listed after, so nothing already entered disappears.
 */
export function LossRunsPanel({
  accountId,
  losses,
  onAddLoss,
  onUpdateLoss,
  onDeleteLoss,
  freshness,
}: {
  accountId: string;
  losses: LossEntry[];
  onAddLoss: (entry: Omit<LossEntry, 'id'>) => void;
  onUpdateLoss: (id: string, patch: Partial<LossEntry>) => void;
  onDeleteLoss: (id: string) => void;
  /** Optional badge per report (e.g. how current its report date is). */
  freshness?: (run: LossRun) => ReactNode;
}) {
  const runs = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId)?.lossRuns) ?? [];
  const [adding, setAdding] = useState(false);
  const unlinked = losses.filter((l) => !l.lossRunId || !runs.some((r) => r.id === l.lossRunId));
  const sorted = [...runs].sort((a, b) => ((a.reportDate ?? '') < (b.reportDate ?? '') ? 1 : -1));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Loss runs ({runs.length})</p>
        {!adding && (
          <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
            Add loss run
          </Button>
        )}
      </div>
      {adding && <LossRunForm accountId={accountId} onDone={() => setAdding(false)} />}
      {sorted.length === 0 && !adding && <p className="text-sm text-[var(--color-ink-400)]">No loss runs recorded yet. Add one for each carrier's report.</p>}
      {sorted.map((run) => (
        <LossRunCard
          key={run.id}
          accountId={accountId}
          run={run}
          claims={losses.filter((l) => l.lossRunId === run.id)}
          onAddLoss={onAddLoss}
          onUpdateLoss={onUpdateLoss}
          onDeleteLoss={onDeleteLoss}
          badge={freshness?.(run)}
        />
      ))}
      {(unlinked.length > 0 || runs.length === 0) && (
        <div className="mt-2">
          {runs.length > 0 && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Claims not on a loss run ({unlinked.length})</p>}
          <LossHistoryTable losses={unlinked} onAdd={onAddLoss} onUpdate={onUpdateLoss} onDelete={onDeleteLoss} addLabel={runs.length > 0 ? 'Add claim' : 'Add loss'} />
        </div>
      )}
    </div>
  );
}

function LossRunCard({
  accountId,
  run,
  claims,
  onAddLoss,
  onUpdateLoss,
  onDeleteLoss,
  badge,
}: {
  accountId: string;
  run: LossRun;
  claims: LossEntry[];
  onAddLoss: (entry: Omit<LossEntry, 'id'>) => void;
  onUpdateLoss: (id: string, patch: Partial<LossEntry>) => void;
  onDeleteLoss: (id: string) => void;
  badge?: ReactNode;
}) {
  const deleteLossRun = useAccountsStore((s) => s.deleteLossRun);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const t = lossRunTotals(run, claims);

  if (editing) return <LossRunForm accountId={accountId} run={run} onDone={() => setEditing(false)} />;

  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] bg-white">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button onClick={() => setOpen((v) => !v)} className="mt-0.5 rounded p-0.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} claims for ${run.carrier}`}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <FileClock size={16} className="mt-0.5 shrink-0 text-[var(--color-ink-400)]" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
            {run.carrier}
            {run.policyNumber && <span className="font-mono text-xs font-normal text-[var(--color-ink-500)]">Policy {run.policyNumber}</span>}
            {badge}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
            {run.reportDate ? `Report dated ${formatShortDate(run.reportDate)}` : 'Report date not recorded'}
            {(run.coverageStart || run.coverageEnd) && ` · Coverage ${run.coverageStart ? formatShortDate(run.coverageStart) : '?'} – ${run.coverageEnd ? formatShortDate(run.coverageEnd) : '?'}`}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-700)]">
            {t.claims === null ? 'Claims not recorded' : `${t.claims} claim${t.claims === 1 ? '' : 's'}`}
            {t.incurred !== null && ` · ${money(t.incurred)} incurred`}
            {t.paid !== null && ` · ${money(t.paid)} paid`}
            {t.reserve !== null && ` · ${money(t.reserve)} reserve`}
            {!t.itemized && t.claims !== null && <span className="text-[var(--color-ink-400)]"> (as stated on the report)</span>}
          </p>
          {run.notes && <p className="mt-0.5 whitespace-pre-line text-xs text-[var(--color-ink-500)]">{run.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={() => setEditing(true)} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer" aria-label={`Edit loss run from ${run.carrier}`}>
            <Pencil size={13} />
          </button>
          <button onClick={() => setConfirmDelete(true)} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] cursor-pointer" aria-label={`Remove loss run from ${run.carrier}`}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-[var(--color-ink-100)] px-3 py-3">
          <LossHistoryTable losses={claims} onAdd={onAddLoss} onUpdate={onUpdateLoss} onDelete={onDeleteLoss} newEntryDefaults={{ lossRunId: run.id }} addLabel="Add claim" />
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteLossRun(accountId, run.id);
          setConfirmDelete(false);
        }}
        title={`Remove the loss run from ${run.carrier}?`}
        description="The report is removed; its claims stay on the account (under “Claims not on a loss run”)."
        confirmLabel="Remove loss run"
      />
    </div>
  );
}

function LossRunForm({ accountId, run, onDone }: { accountId: string; run?: LossRun; onDone: () => void }) {
  const addLossRun = useAccountsStore((s) => s.addLossRun);
  const updateLossRun = useAccountsStore((s) => s.updateLossRun);
  const num = (v?: number) => (v === undefined ? '' : String(v));
  const [f, setF] = useState({
    carrier: run?.carrier ?? '',
    policyNumber: run?.policyNumber ?? '',
    reportDate: run?.reportDate ?? '',
    coverageStart: run?.coverageStart ?? '',
    coverageEnd: run?.coverageEnd ?? '',
    claimCount: num(run?.claimCount),
    totalIncurred: num(run?.totalIncurred),
    totalPaid: num(run?.totalPaid),
    totalReserve: num(run?.totalReserve),
    notes: run?.notes ?? '',
  });
  const parse = (v: string) => {
    const n = Number(v.replace(/[$,\s]/g, ''));
    return v.trim() === '' || !Number.isFinite(n) || n < 0 ? undefined : n;
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.carrier.trim()) return;
    const values = {
      carrier: f.carrier.trim(),
      policyNumber: f.policyNumber.trim() || undefined,
      reportDate: f.reportDate || undefined,
      coverageStart: f.coverageStart || undefined,
      coverageEnd: f.coverageEnd || undefined,
      claimCount: parse(f.claimCount),
      totalIncurred: parse(f.totalIncurred),
      totalPaid: parse(f.totalPaid),
      totalReserve: parse(f.totalReserve),
      notes: f.notes.trim() || undefined,
    };
    if (run) updateLossRun(accountId, run.id, values);
    else addLossRun(accountId, values);
    onDone();
  }
  const field = (label: string, k: keyof typeof f, type: 'text' | 'date' = 'text', placeholder?: string) => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={inputClass} placeholder={placeholder} aria-label={label} inputMode={type === 'text' && /Total|Number of/.test(label) ? 'decimal' : undefined} />
    </label>
  );
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 sm:grid-cols-4" aria-label={run ? 'Edit loss run' : 'New loss run'}>
      <div className="col-span-2">{field('Insurance carrier', 'carrier', 'text', 'e.g. Progressive')}</div>
      {field('Policy number', 'policyNumber', 'text', 'If available')}
      {field('Report date', 'reportDate', 'date')}
      {field('Coverage start', 'coverageStart', 'date')}
      {field('Coverage end', 'coverageEnd', 'date')}
      {field('Number of claims', 'claimCount', 'text', 'If claims not listed')}
      {field('Total incurred', 'totalIncurred', 'text', '$')}
      {field('Total paid', 'totalPaid', 'text', '$')}
      {field('Total reserve', 'totalReserve', 'text', '$')}
      <div className="col-span-2">{field('Notes', 'notes')}</div>
      <p className="col-span-2 text-xs text-[var(--color-ink-500)] sm:col-span-4">When claims are added to this loss run, the count and totals come from them.</p>
      <div className="col-span-2 flex justify-end gap-2 sm:col-span-4">
        <button type="button" onClick={onDone} className={linkButtonClass}>
          Cancel
        </button>
        <Button type="submit" size="sm" disabled={!f.carrier.trim()}>
          {run ? 'Save loss run' : 'Add loss run'}
        </Button>
      </div>
    </form>
  );
}
