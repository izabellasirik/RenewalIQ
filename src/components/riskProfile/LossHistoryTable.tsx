import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, User } from 'lucide-react';
import type { LossEntry, LossStatus } from '../../types';
import { Button, ConfirmDialog } from '../ui';
import { formatDate } from '../../utils/dates';

type Draft = { lossDate: string; claimType: string; paid: string; reserved: string; incurred: string; status: LossStatus };

const EMPTY_DRAFT: Draft = { lossDate: '', claimType: '', paid: '', reserved: '', incurred: '', status: 'open' };

function toDraft(l: LossEntry): Draft {
  return { lossDate: l.lossDate, claimType: l.claimType, paid: String(l.paid), reserved: String(l.reserved), incurred: String(l.incurred), status: l.status };
}

function fromDraft(d: Draft): Omit<LossEntry, 'id'> {
  return {
    lossDate: d.lossDate.trim(),
    claimType: d.claimType.trim(),
    paid: Number(d.paid || 0),
    reserved: Number(d.reserved || 0),
    incurred: Number(d.incurred || 0),
    status: d.status,
  };
}

const inputCls = 'w-full rounded-md border border-[var(--color-brand-500)] px-1.5 py-1 text-xs outline-none';

export function LossHistoryTable({
  losses,
  onAdd,
  onUpdate,
  onDelete,
}: {
  losses: LossEntry[];
  onAdd: (entry: Omit<LossEntry, 'id'>) => void;
  onUpdate: (id: string, patch: Partial<LossEntry>) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState<LossEntry | null>(null);

  function startAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingId('new');
  }
  function startEdit(l: LossEntry) {
    setDraft(toDraft(l));
    setEditingId(l.id);
  }
  function cancel() {
    setEditingId(null);
  }
  function save() {
    if (editingId === 'new') onAdd(fromDraft(draft));
    else if (editingId) onUpdate(editingId, fromDraft(draft));
    setEditingId(null);
  }

  function row(l: LossEntry | null) {
    const isNew = l === null;
    return (
      <tr key={l?.id ?? 'new'} className="border-b border-[var(--color-ink-100)] bg-[var(--color-brand-50)]/40">
        <td className="py-2 pr-4"><input className={inputCls} placeholder="YYYY-MM-DD" value={draft.lossDate} onChange={(e) => setDraft({ ...draft, lossDate: e.target.value })} autoFocus={isNew} /></td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="Claim type" value={draft.claimType} onChange={(e) => setDraft({ ...draft, claimType: e.target.value })} /></td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="0" value={draft.paid} onChange={(e) => setDraft({ ...draft, paid: e.target.value })} /></td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="0" value={draft.reserved} onChange={(e) => setDraft({ ...draft, reserved: e.target.value })} /></td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="0" value={draft.incurred} onChange={(e) => setDraft({ ...draft, incurred: e.target.value })} /></td>
        <td className="py-2 pr-4">
          <select className={inputCls} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as LossStatus })}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </td>
        <td className="py-2 pr-4 text-xs text-[var(--color-ink-400)]">{isNew ? 'Entered by broker' : l?.source?.documentName ?? 'Entered by broker'}</td>
        <td className="py-2">
          <div className="flex items-center gap-1">
            <button onClick={save} className="rounded-md bg-[var(--color-brand-800)] p-1 text-white cursor-pointer" aria-label="Save loss"><Check size={13} /></button>
            <button onClick={cancel} className="rounded-md bg-[var(--color-ink-100)] p-1 text-[var(--color-ink-500)] cursor-pointer" aria-label="Cancel"><X size={13} /></button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={startAdd} disabled={editingId !== null}>
          Add loss
        </Button>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-ink-100)] text-xs text-[var(--color-ink-500)]">
            <th className="py-2 pr-4 font-medium">Loss Date</th>
            <th className="py-2 pr-4 font-medium">Claim Type</th>
            <th className="py-2 pr-4 font-medium">Paid</th>
            <th className="py-2 pr-4 font-medium">Reserved</th>
            <th className="py-2 pr-4 font-medium">Incurred</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Source</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {editingId === 'new' && row(null)}
          {losses
            .slice()
            .sort((a, b) => (a.lossDate < b.lossDate ? 1 : -1))
            .map((entry) =>
              editingId === entry.id ? (
                row(entry)
              ) : (
                <tr key={entry.id} className="border-b border-[var(--color-ink-100)] last:border-0">
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{formatDate(entry.lossDate)}</td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{entry.claimType}</td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">${entry.paid.toLocaleString('en-US')}</td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">${entry.reserved.toLocaleString('en-US')}</td>
                  <td className="py-2.5 pr-4 font-medium text-[var(--color-ink-900)]">${entry.incurred.toLocaleString('en-US')}</td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={
                        entry.status === 'open'
                          ? 'rounded-full bg-[var(--color-warning-100)] px-2 py-0.5 text-xs font-medium text-[var(--color-warning-600)]'
                          : 'rounded-full bg-[var(--color-ink-100)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-600)]'
                      }
                    >
                      {entry.status === 'open' ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-[var(--color-ink-400)]">
                    {entry.isManual ? (
                      <span className="inline-flex items-center gap-1"><User size={11} />Entered by broker</span>
                    ) : (
                      entry.source?.documentName ?? '—'
                    )}
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEdit(entry)} disabled={editingId !== null} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer disabled:opacity-40" aria-label="Edit loss"><Pencil size={13} /></button>
                      <button onClick={() => setDeleteTarget(entry)} disabled={editingId !== null} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] cursor-pointer disabled:opacity-40" aria-label="Delete loss"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              )
            )}
        </tbody>
      </table>

      <ConfirmDialog
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id);
          setDeleteTarget(null);
        }}
        title="Delete this loss?"
        description="Remove this claim from the loss history. This cannot be undone."
        confirmLabel="Delete loss"
      />
    </div>
  );
}
