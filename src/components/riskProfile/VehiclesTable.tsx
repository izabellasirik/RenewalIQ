import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, User, AlertTriangle } from 'lucide-react';
import type { VehicleEntry } from '../../types';
import { Button, ConfirmDialog } from '../ui';

/** True when at least one field on this row was a shakier read, or when the vision model and OCR disagreed on a field. */
function needsReview(v: VehicleEntry): boolean {
  return (!!v.conflicts && Object.keys(v.conflicts).length > 0) || (!!v.fieldConfidence && Object.values(v.fieldConfidence).some((c) => c === 'low'));
}

function reviewTooltip(v: VehicleEntry): string {
  if (v.conflicts && Object.keys(v.conflicts).length > 0) {
    return `AI vision and OCR read this row's ${Object.keys(v.conflicts).join(', ')} differently — double-check against the source photo.`;
  }
  return 'Some fields on this row were a shakier read — double-check against the source photo.';
}

type Draft = { vin: string; make: string; model: string; year: string; value: string; bodyType: string; plate: string };

const EMPTY_DRAFT: Draft = { vin: '', make: '', model: '', year: '', value: '', bodyType: '', plate: '' };

function toDraft(v: VehicleEntry): Draft {
  return {
    vin: v.vin ?? '',
    make: v.make ?? '',
    model: v.model ?? '',
    year: v.year !== undefined ? String(v.year) : '',
    value: v.value !== undefined ? String(v.value) : '',
    bodyType: v.bodyType ?? '',
    plate: v.plate ?? '',
  };
}

function fromDraft(d: Draft): Omit<VehicleEntry, 'id'> {
  return {
    vin: d.vin.trim() || undefined,
    make: d.make.trim() || undefined,
    model: d.model.trim() || undefined,
    year: d.year.trim() ? Number(d.year) : undefined,
    value: d.value.trim() ? Number(d.value.replace(/,/g, '')) : undefined,
    bodyType: d.bodyType.trim() || undefined,
    plate: d.plate.trim() || undefined,
  };
}

const inputCls = 'w-full rounded-md border border-[var(--color-brand-500)] px-1.5 py-1 text-xs outline-none';

export function VehiclesTable({
  vehicles,
  onAdd,
  onUpdate,
  onDelete,
}: {
  vehicles: VehicleEntry[];
  onAdd: (entry: Omit<VehicleEntry, 'id'>) => void;
  onUpdate: (id: string, patch: Partial<VehicleEntry>) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState<VehicleEntry | null>(null);

  function startAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingId('new');
  }
  function startEdit(v: VehicleEntry) {
    setDraft(toDraft(v));
    setEditingId(v.id);
  }
  function cancel() {
    setEditingId(null);
  }
  function save() {
    if (editingId === 'new') onAdd(fromDraft(draft));
    else if (editingId) onUpdate(editingId, fromDraft(draft));
    setEditingId(null);
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={startAdd} disabled={editingId !== null}>
          Add vehicle
        </Button>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-ink-100)] text-xs text-[var(--color-ink-500)]">
            <th className="py-2 pr-4 font-medium">VIN</th>
            <th className="py-2 pr-4 font-medium">Make</th>
            <th className="py-2 pr-4 font-medium">Model</th>
            <th className="py-2 pr-4 font-medium">Year</th>
            <th className="py-2 pr-4 font-medium">Plate</th>
            <th className="py-2 pr-4 font-medium">Value</th>
            <th className="py-2 pr-4 font-medium">Source</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {editingId === 'new' && (
            <tr className="border-b border-[var(--color-ink-100)] bg-[var(--color-brand-50)]/40">
              <td className="py-2 pr-4"><input className={inputCls} placeholder="VIN" value={draft.vin} onChange={(e) => setDraft({ ...draft, vin: e.target.value })} autoFocus /></td>
              <td className="py-2 pr-4"><input className={inputCls} placeholder="Make" value={draft.make} onChange={(e) => setDraft({ ...draft, make: e.target.value })} /></td>
              <td className="py-2 pr-4"><input className={inputCls} placeholder="Model" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></td>
              <td className="py-2 pr-4"><input className={inputCls} placeholder="Year" value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} /></td>
              <td className="py-2 pr-4"><input className={inputCls} placeholder="Plate" value={draft.plate} onChange={(e) => setDraft({ ...draft, plate: e.target.value })} /></td>
              <td className="py-2 pr-4"><input className={inputCls} placeholder="Value" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></td>
              <td className="py-2 pr-4 text-xs text-[var(--color-ink-400)]">Entered by broker</td>
              <td className="py-2">
                <div className="flex items-center gap-1">
                  <button onClick={save} className="rounded-md bg-[var(--color-brand-800)] p-1 text-white cursor-pointer" aria-label="Save vehicle"><Check size={13} /></button>
                  <button onClick={cancel} className="rounded-md bg-[var(--color-ink-100)] p-1 text-[var(--color-ink-500)] cursor-pointer" aria-label="Cancel"><X size={13} /></button>
                </div>
              </td>
            </tr>
          )}
          {vehicles.map((v) =>
            editingId === v.id ? (
              <tr key={v.id} className="border-b border-[var(--color-ink-100)] bg-[var(--color-brand-50)]/40">
                <td className="py-2 pr-4"><input className={inputCls} value={draft.vin} onChange={(e) => setDraft({ ...draft, vin: e.target.value })} autoFocus /></td>
                <td className="py-2 pr-4"><input className={inputCls} value={draft.make} onChange={(e) => setDraft({ ...draft, make: e.target.value })} /></td>
                <td className="py-2 pr-4"><input className={inputCls} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></td>
                <td className="py-2 pr-4"><input className={inputCls} value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} /></td>
                <td className="py-2 pr-4"><input className={inputCls} value={draft.plate} onChange={(e) => setDraft({ ...draft, plate: e.target.value })} /></td>
                <td className="py-2 pr-4"><input className={inputCls} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></td>
                <td className="py-2 pr-4 text-xs text-[var(--color-ink-400)]">{v.source?.documentName ?? 'Entered by broker'}</td>
                <td className="py-2">
                  <div className="flex items-center gap-1">
                    <button onClick={save} className="rounded-md bg-[var(--color-brand-800)] p-1 text-white cursor-pointer" aria-label="Save vehicle"><Check size={13} /></button>
                    <button onClick={cancel} className="rounded-md bg-[var(--color-ink-100)] p-1 text-[var(--color-ink-500)] cursor-pointer" aria-label="Cancel"><X size={13} /></button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={v.id} className="border-b border-[var(--color-ink-100)] last:border-0">
                <td className="py-2.5 pr-4 font-mono text-xs text-[var(--color-ink-800)]">
                  <span className="inline-flex items-center gap-1.5">
                    {v.vin ?? '—'}
                    {needsReview(v) && (
                      <span title={reviewTooltip(v)} className="inline-flex items-center text-[var(--color-warning-600,#b45309)]">
                        <AlertTriangle size={12} />
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{v.make ?? '—'}</td>
                <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{v.model ?? '—'}</td>
                <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{v.year ?? '—'}</td>
                <td className="py-2.5 pr-4 font-mono text-xs text-[var(--color-ink-800)]">{v.plate ?? '—'}</td>
                <td className="py-2.5 pr-4 font-medium text-[var(--color-ink-900)]">{v.value ? `$${v.value.toLocaleString('en-US')}` : '—'}</td>
                <td className="py-2.5 pr-4 text-xs text-[var(--color-ink-400)]">
                  {v.isManual ? (
                    <span className="inline-flex items-center gap-1"><User size={11} />Entered by broker</span>
                  ) : (
                    v.source?.documentName ?? '—'
                  )}
                </td>
                <td className="py-2.5">
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(v)} disabled={editingId !== null} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer disabled:opacity-40" aria-label="Edit vehicle"><Pencil size={13} /></button>
                    <button onClick={() => setDeleteTarget(v)} disabled={editingId !== null} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] cursor-pointer disabled:opacity-40" aria-label="Delete vehicle"><Trash2 size={13} /></button>
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
        title="Delete this vehicle?"
        description={`Remove ${deleteTarget?.vin ? `VIN ${deleteTarget.vin}` : 'this vehicle'} from the fleet. This cannot be undone.`}
        confirmLabel="Delete vehicle"
      />
    </div>
  );
}
