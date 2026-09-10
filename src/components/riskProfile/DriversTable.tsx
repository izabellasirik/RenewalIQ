import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, User, AlertTriangle } from 'lucide-react';
import type { DriverEntry } from '../../types';
import { Button, ConfirmDialog } from '../ui';

type Draft = {
  name: string;
  address: string;
  dob: string;
  licenseState: string;
  licenseNumber: string;
  licenseClass: string;
  expirationDate: string;
  yearsExperience: string;
  violations: string;
};

const EMPTY_DRAFT: Draft = { name: '', address: '', dob: '', licenseState: '', licenseNumber: '', licenseClass: '', expirationDate: '', yearsExperience: '', violations: '' };

function toDraft(d: DriverEntry): Draft {
  return {
    name: d.name ?? '',
    address: d.address ?? '',
    dob: d.dob ?? '',
    licenseState: d.licenseState ?? '',
    licenseNumber: d.licenseNumber ?? '',
    licenseClass: d.licenseClass ?? '',
    expirationDate: d.expirationDate ?? '',
    yearsExperience: d.yearsExperience !== undefined ? String(d.yearsExperience) : '',
    violations: d.violations ?? '',
  };
}

function fromDraft(d: Draft): Omit<DriverEntry, 'id'> {
  return {
    name: d.name.trim() || undefined,
    address: d.address.trim() || undefined,
    dob: d.dob.trim() || undefined,
    licenseState: d.licenseState.trim() || undefined,
    licenseNumber: d.licenseNumber.trim() || undefined,
    licenseClass: d.licenseClass.trim() || undefined,
    expirationDate: d.expirationDate.trim() || undefined,
    yearsExperience: d.yearsExperience.trim() ? Number(d.yearsExperience) : undefined,
    violations: d.violations.trim() || undefined,
  };
}

/** True when at least one field on this row was a shakier read than the rest, or when the vision model and OCR disagreed on a field — surfaced as a small inline flag rather than hiding or discarding the row. */
function needsReview(d: DriverEntry): boolean {
  return (!!d.conflicts && Object.keys(d.conflicts).length > 0) || (!!d.fieldConfidence && Object.values(d.fieldConfidence).some((c) => c === 'low'));
}

function reviewTooltip(d: DriverEntry): string {
  if (d.conflicts && Object.keys(d.conflicts).length > 0) {
    const fields = Object.keys(d.conflicts).join(', ');
    return `AI vision and OCR read this row's ${fields} differently — double-check against the source photo.`;
  }
  return 'Some fields on this row were a shakier read — double-check against the source photo.';
}

const inputCls = 'w-full rounded-md border border-[var(--color-brand-500)] px-1.5 py-1 text-xs outline-none';

export function DriversTable({
  drivers,
  onAdd,
  onUpdate,
  onDelete,
}: {
  drivers: DriverEntry[];
  onAdd: (entry: Omit<DriverEntry, 'id'>) => void;
  onUpdate: (id: string, patch: Partial<DriverEntry>) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState<DriverEntry | null>(null);

  function startAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingId('new');
  }
  function startEdit(d: DriverEntry) {
    setDraft(toDraft(d));
    setEditingId(d.id);
  }
  function cancel() {
    setEditingId(null);
  }
  function save() {
    if (editingId === 'new') onAdd(fromDraft(draft));
    else if (editingId) onUpdate(editingId, fromDraft(draft));
    setEditingId(null);
  }

  function row(d: DriverEntry | null) {
    const isNew = d === null;
    return (
      <tr key={d?.id ?? 'new'} className="border-b border-[var(--color-ink-100)] bg-[var(--color-brand-50)]/40">
        <td className="py-2 pr-4">
          <input className={inputCls} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus={isNew} />
          <input className={`${inputCls} mt-1`} placeholder="Address (optional)" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
        </td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="YYYY-MM-DD" value={draft.dob} onChange={(e) => setDraft({ ...draft, dob: e.target.value })} /></td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="State" value={draft.licenseState} onChange={(e) => setDraft({ ...draft, licenseState: e.target.value })} /></td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="License #" value={draft.licenseNumber} onChange={(e) => setDraft({ ...draft, licenseNumber: e.target.value })} /></td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="Class" value={draft.licenseClass} onChange={(e) => setDraft({ ...draft, licenseClass: e.target.value })} /></td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="YYYY-MM-DD" value={draft.expirationDate} onChange={(e) => setDraft({ ...draft, expirationDate: e.target.value })} /></td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="Years" value={draft.yearsExperience} onChange={(e) => setDraft({ ...draft, yearsExperience: e.target.value })} /></td>
        <td className="py-2 pr-4"><input className={inputCls} placeholder="None" value={draft.violations} onChange={(e) => setDraft({ ...draft, violations: e.target.value })} /></td>
        <td className="py-2 pr-4 text-xs text-[var(--color-ink-400)]">{isNew ? 'Entered by broker' : d?.source?.documentName ?? 'Entered by broker'}</td>
        <td className="py-2">
          <div className="flex items-center gap-1">
            <button onClick={save} className="rounded-md bg-[var(--color-brand-800)] p-1 text-white cursor-pointer" aria-label="Save driver"><Check size={13} /></button>
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
          Add driver
        </Button>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-ink-100)] text-xs text-[var(--color-ink-500)]">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">DOB</th>
            <th className="py-2 pr-4 font-medium">License State</th>
            <th className="py-2 pr-4 font-medium">License #</th>
            <th className="py-2 pr-4 font-medium">Class</th>
            <th className="py-2 pr-4 font-medium">Expires</th>
            <th className="py-2 pr-4 font-medium">Years Experience</th>
            <th className="py-2 pr-4 font-medium">Violations</th>
            <th className="py-2 pr-4 font-medium">Source</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {editingId === 'new' && row(null)}
          {drivers.map((d) =>
            editingId === d.id ? (
              row(d)
            ) : (
              <tr key={d.id} className="border-b border-[var(--color-ink-100)] last:border-0">
                <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">
                  <span className="inline-flex items-center gap-1.5">
                    {d.name ?? '—'}
                    {needsReview(d) && (
                      <span title={reviewTooltip(d)} className="inline-flex items-center text-[var(--color-warning-600,#b45309)]">
                        <AlertTriangle size={12} />
                      </span>
                    )}
                  </span>
                  {d.address && <div className="mt-0.5 text-xs text-[var(--color-ink-400)]">{d.address}</div>}
                </td>
                <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.dob ?? '—'}</td>
                <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.licenseState ?? '—'}</td>
                <td className="py-2.5 pr-4 font-mono text-xs text-[var(--color-ink-800)]">{d.licenseNumber ?? '—'}</td>
                <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.licenseClass ?? '—'}{d.isCDL ? ' (CDL)' : ''}</td>
                <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.expirationDate ?? '—'}</td>
                <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.yearsExperience ?? '—'}</td>
                <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.violations ?? '—'}</td>
                <td className="py-2.5 pr-4 text-xs text-[var(--color-ink-400)]">
                  {d.isManual ? (
                    <span className="inline-flex items-center gap-1"><User size={11} />Entered by broker</span>
                  ) : (
                    d.source?.documentName ?? '—'
                  )}
                </td>
                <td className="py-2.5">
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(d)} disabled={editingId !== null} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer disabled:opacity-40" aria-label="Edit driver"><Pencil size={13} /></button>
                    <button onClick={() => setDeleteTarget(d)} disabled={editingId !== null} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] cursor-pointer disabled:opacity-40" aria-label="Delete driver"><Trash2 size={13} /></button>
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
        title="Delete this driver?"
        description={`Remove ${deleteTarget?.name ?? 'this driver'} from the schedule. This cannot be undone.`}
        confirmLabel="Delete driver"
      />
    </div>
  );
}
