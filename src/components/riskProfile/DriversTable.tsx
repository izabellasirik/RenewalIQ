import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, User, AlertTriangle, ChevronDown, ChevronRight, StickyNote, Merge } from 'lucide-react';
import type { DriverEntry, DriverNote } from '../../types';
import { Button, ConfirmDialog, Modal } from '../ui';
import { formatExperience } from '../../utils/duration';
import { driverExperience, usableCdlIssueDate } from '../../utils/driverExperience';
import { useAccountsStore } from '../../state/useAccountsStore';
import { cn } from '../../utils/cn';
import { findDuplicateDrivers } from '../../services/extraction/extractionService';
import { formatShortDate, normalizeDateKey } from '../../services/workflow/dates';
import { formatTimestampShort } from '../workspace/time';
import { inputClass, labelClass } from '../workspace/formStyles';
import { FreshnessBadge } from './FreshnessBadge';
import { reportAge } from '../../services/workflow/freshness';

type Draft = {
  name: string;
  address: string;
  dob: string;
  licenseState: string;
  licenseNumber: string;
  licenseClass: string;
  issueDate: string;
  expirationDate: string;
  cdlOriginalIssueDate: string;
  hireDate: string;
  mvrReportDate: string;
  violations: string;
};

const EMPTY_DRAFT: Draft = { name: '', address: '', dob: '', licenseState: '', licenseNumber: '', licenseClass: '', issueDate: '', expirationDate: '', cdlOriginalIssueDate: '', hireDate: '', mvrReportDate: '', violations: '' };

/** A date input wants YYYY-MM-DD; a value read off a document may be "04/02/1980" — normalized when possible, else shown as text. */
const dateDraft = (v?: string) => (v ? (normalizeDateKey(v) ?? v) : '');

function toDraft(d: DriverEntry): Draft {
  return {
    name: d.name ?? '',
    address: d.address ?? '',
    dob: dateDraft(d.dob),
    licenseState: d.licenseState ?? '',
    licenseNumber: d.licenseNumber ?? '',
    licenseClass: d.licenseClass ?? '',
    issueDate: dateDraft(d.issueDate),
    expirationDate: dateDraft(d.expirationDate),
    cdlOriginalIssueDate: dateDraft(d.cdlOriginalIssueDate),
    hireDate: d.hireDate ?? '',
    mvrReportDate: d.mvrReportDate ?? '',
    violations: d.violations ?? '',
  };
}

/**
 * The driver as saved from the form. Experience isn't a field: it's always today − CDL Since (see
 * driverExperience). `before`: the row being edited — a CDL Since that didn't change keeps the
 * document it was read from; a changed or typed one is the broker's.
 */
export function fromDraft(d: Draft, before?: DriverEntry): Omit<DriverEntry, 'id'> {
  const cdlDate = d.cdlOriginalIssueDate.trim() || undefined;
  const keepSource = before?.cdlOriginalIssueSource && dateDraft(before.cdlOriginalIssueDate) === cdlDate;
  return {
    name: d.name.trim() || undefined,
    address: d.address.trim() || undefined,
    dob: d.dob.trim() || undefined,
    licenseState: d.licenseState.trim() || undefined,
    licenseNumber: d.licenseNumber.trim() || undefined,
    licenseClass: d.licenseClass.trim() || undefined,
    issueDate: d.issueDate.trim() || undefined,
    expirationDate: d.expirationDate.trim() || undefined,
    cdlOriginalIssueDate: cdlDate,
    cdlOriginalIssueSource: keepSource ? before!.cdlOriginalIssueSource : undefined,
    hireDate: d.hireDate || undefined,
    mvrReportDate: d.mvrReportDate || undefined,
    violations: d.violations.trim() || undefined,
  };
}

/** "13 yrs 1 mo" from a CDL Since date, or null when it can't be used. */
function experienceFrom(cdlDate: string, dob?: string): string | null {
  const e = driverExperience({ cdlOriginalIssueDate: cdlDate, dob });
  return e ? formatExperience(e) : null;
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

/** Where the original CDL date came from, for the hover text. */
function cdlSourceTitle(d: DriverEntry): string {
  const s = d.cdlOriginalIssueSource;
  if (!s) return `CDL Since ${d.cdlOriginalIssueDate} — entered in Renewal IQ. Experience is counted from it to today.`;
  return `CDL Since ${d.cdlOriginalIssueDate} — from ${s.documentName}${s.page ? `, page ${s.page}` : ''}${s.excerpt ? `: “${s.excerpt}”` : ''}. Experience is counted from it to today.`;
}

/**
 * CDL Since, straight in the table: the date (with where it was read, on hover) and a quick way to
 * enter or change it — Experience updates as soon as it's saved.
 */
function CdlSinceCell({ driver, onSave }: { driver: DriverEntry; onSave: (date: string | undefined) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  if (editing) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value || undefined);
          setEditing(false);
        }}
      >
        <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="rounded-md border border-[var(--color-brand-500)] px-1.5 py-0.5 text-xs outline-none" aria-label="CDL Since" autoFocus />
        <button type="submit" className="rounded-md bg-[var(--color-brand-800)] px-1.5 py-0.5 text-xs font-medium text-white cursor-pointer">
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded-md px-1 py-0.5 text-xs text-[var(--color-ink-500)] hover:bg-[var(--color-ink-100)] cursor-pointer">
          Cancel
        </button>
      </form>
    );
  }
  const unusable = !!driver.cdlOriginalIssueDate && !usableCdlIssueDate(driver);
  return (
    <span className="inline-flex items-center gap-1">
      {driver.cdlOriginalIssueDate ? (
        <span title={cdlSourceTitle(driver)} className={unusable ? 'text-[var(--color-warning-600)]' : ''}>
          {dateCell(driver.cdlOriginalIssueDate)}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          setValue(dateDraft(driver.cdlOriginalIssueDate));
          setEditing(true);
        }}
        className={
          driver.cdlOriginalIssueDate
            ? 'rounded p-0.5 text-[var(--color-ink-300)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-600)] cursor-pointer'
            : 'rounded-md px-1 py-0.5 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer'
        }
        aria-label={`${driver.cdlOriginalIssueDate ? 'Change' : 'Add'} CDL Since for ${driver.name ?? 'driver'}`}
      >
        {driver.cdlOriginalIssueDate ? <Pencil size={11} /> : 'Add'}
      </button>
    </span>
  );
}

const COLS = 12;
const dateCell = (v?: string) => (v ? (normalizeDateKey(v) ? formatShortDate(v) : v) : '—');

export function DriversTable({
  accountId,
  drivers,
  onAdd,
  onUpdate,
  onDelete,
  onMerge,
}: {
  accountId: string;
  drivers: DriverEntry[];
  onAdd: (entry: Omit<DriverEntry, 'id'>) => void;
  onUpdate: (id: string, patch: Partial<DriverEntry>) => void;
  onDelete: (id: string) => void;
  /** Merge two rows that are one person (`keepId` absorbs `dropId`). */
  onMerge?: (keepId: string, dropId: string) => void;
}) {
  const duplicates = onMerge ? findDuplicateDrivers(drivers) : [];
  // A flagged duplicate sits right under its match — names printed in a different order
  // ("Walker Deshaun Darrell" vs "Deshaun Walker") would otherwise land far apart.
  const dupOf = new Map(duplicates.map(({ keep, drop }) => [drop.id, keep.id]));
  const rows = drivers.filter((d) => !dupOf.has(d.id)).flatMap((d) => [d, ...drivers.filter((x) => dupOf.get(x.id) === d.id)]);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** The driver whose note box should take the cursor when their row opens via "Notes". */
  const [noteFocusId, setNoteFocusId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DriverEntry | null>(null);
  /** Drivers ticked for "Merge selected" (any two or more rows the broker knows are one person). */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeKeepId, setMergeKeepId] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const selectedDrivers = drivers.filter((d) => selected.has(d.id));
  const toggleSelected = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  function openMerge() {
    setMergeKeepId(selectedDrivers[0]?.id ?? null);
    setMergeOpen(true);
  }
  function confirmMerge() {
    if (!onMerge || !mergeKeepId) return;
    // The kept row takes whatever the others had that it doesn't — nothing it has is overwritten.
    for (const d of selectedDrivers) if (d.id !== mergeKeepId) onMerge(mergeKeepId, d.id);
    setMergeOpen(false);
    setSelected(new Set());
  }

  function startAdd() {
    setDraft(EMPTY_DRAFT);
    setEditingId('new');
  }
  function startEdit(d: DriverEntry) {
    setDraft(toDraft(d));
    setEditingId(d.id);
  }
  function save(e: FormEvent) {
    e.preventDefault();
    if (editingId === 'new') onAdd(fromDraft(draft));
    else if (editingId) onUpdate(editingId, fromDraft(draft, drivers.find((x) => x.id === editingId)));
    setEditingId(null);
  }
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const draftExperience = draft.cdlOriginalIssueDate ? experienceFrom(draft.cdlOriginalIssueDate, draft.dob || undefined) : null;

  function editor(isNew: boolean) {
    const field = (label: string, key: keyof Draft, type: 'text' | 'date' = 'text', placeholder?: string) => (
      <label className="block">
        <span className={labelClass}>{label}</span>
        <input type={type} className={inputClass} value={draft[key]} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} aria-label={label} />
      </label>
    );
    return (
      <tr key={isNew ? 'new' : `edit-${editingId}`} className="border-b border-[var(--color-ink-100)] bg-[var(--color-brand-50)]/40">
        <td colSpan={COLS} className="p-3">
          <form onSubmit={save} className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={isNew ? 'New driver' : 'Edit driver'}>
            <div className="col-span-2">{field('Name', 'name')}</div>
            <div className="col-span-2">{field('Address', 'address', 'text', 'Optional')}</div>
            {field('Date of birth', 'dob', 'date')}
            {field('License state', 'licenseState', 'text', 'e.g. TX')}
            {field('License #', 'licenseNumber')}
            {field('Class', 'licenseClass', 'text', 'e.g. A')}
            {field('License issue date', 'issueDate', 'date')}
            {field('License expiration', 'expirationDate', 'date')}
            <div>
              {field('CDL Since (original CDL issue date)', 'cdlOriginalIssueDate', 'date')}
              <p className="mt-1 text-xs text-[var(--color-ink-500)]" data-testid="draft-experience">
                {draftExperience
                  ? `Experience: ${draftExperience}`
                  : draft.cdlOriginalIssueDate
                    ? 'That date can’t be right (in the future, or before the driver turned 18) — experience stays —.'
                    : 'Experience is calculated from this date.'}
              </p>
            </div>
            {field('Date of hire', 'hireDate', 'date')}
            {field('MVR report date', 'mvrReportDate', 'date')}
            <div className="col-span-2">{field('Violations', 'violations', 'text', 'None')}</div>
            <div className="col-span-2 flex items-end justify-end gap-2 sm:col-span-4">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" aria-label="Save driver">
                Save driver
              </Button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto">
      {duplicates.map(({ keep, drop }) => (
        <div key={`${keep.id}-${drop.id}`} className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/30 px-3 py-2 text-sm" data-testid="duplicate-driver">
          <span className="text-[var(--color-ink-700)]">
            <strong>{drop.name ?? 'A driver'}</strong> and <strong>{keep.name ?? 'a driver'}</strong> look like the same person
            {keep.licenseNumber && keep.licenseNumber === drop.licenseNumber ? ` (license ${keep.licenseNumber})` : ' (same name and date of birth)'}.
          </span>
          <Button size="sm" variant="secondary" onClick={() => onMerge!(keep.id, drop.id)}>
            Merge into one
          </Button>
        </div>
      ))}
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        {onMerge && selected.size > 0 && (
          <span className="mr-auto flex items-center gap-2 text-sm text-[var(--color-ink-600)]" data-testid="driver-selection">
            {selected.size} selected
            <Button size="sm" icon={<Merge size={13} />} onClick={openMerge} disabled={selected.size < 2 || editingId !== null} data-testid="merge-selected-drivers">
              Merge selected
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </span>
        )}
        <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={startAdd} disabled={editingId !== null}>
          Add driver
        </Button>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-ink-100)] text-xs text-[var(--color-ink-500)]">
            <th className="w-6 py-2" />
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">DOB</th>
            <th className="py-2 pr-3 font-medium">License</th>
            <th className="py-2 pr-3 font-medium">Issued</th>
            <th className="py-2 pr-3 font-medium">Expires</th>
            <th className="py-2 pr-3 font-medium">CDL Since</th>
            <th className="py-2 pr-3 font-medium">Experience</th>
            <th className="py-2 pr-3 font-medium">Hired</th>
            <th className="py-2 pr-3 font-medium">Violations</th>
            <th className="py-2 pr-3 font-medium">Source</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {editingId === 'new' && editor(true)}
          {rows.map((d) => {
            if (editingId === d.id) return editor(false);
            const open = expanded.has(d.id);
            const exp = driverExperience(d);
            return (
              <Fragment key={d.id}>
                <tr className={cn('border-b border-[var(--color-ink-100)] last:border-0', (dupOf.has(d.id) || [...dupOf.values()].includes(d.id)) && 'bg-[var(--color-warning-100)]/25')} data-duplicate={dupOf.has(d.id) || [...dupOf.values()].includes(d.id) ? 'yes' : undefined}>
                  <td className="whitespace-nowrap py-2.5 align-top">
                    {onMerge && (
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        onChange={() => toggleSelected(d.id)}
                        className="mr-1 align-middle cursor-pointer"
                        aria-label={`Select ${d.name ?? 'driver'}`}
                      />
                    )}
                    <button onClick={() => toggle(d.id)} className="rounded p-0.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer" aria-label={`${open ? 'Hide' : 'Show'} details for ${d.name ?? 'driver'}`} aria-expanded={open}>
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                  <td className="py-2.5 pr-3 text-[var(--color-ink-800)]">
                    <span className="inline-flex items-center gap-1.5">
                      {d.name ?? '—'}
                      {needsReview(d) && (
                        <span title={reviewTooltip(d)} className="inline-flex items-center text-[var(--color-warning-600,#b45309)]">
                          <AlertTriangle size={12} />
                        </span>
                      )}
                      {reportAge('mvr', d.mvrReportDate)?.outdated && <FreshnessBadge kind="mvr" reportDate={d.mvrReportDate} />}
                    </span>
                    {latestNote(d) && (
                      <button
                        onClick={() => {
                          if (!open) toggle(d.id);
                        }}
                        title={latestNote(d)!.text}
                        className="mt-0.5 flex max-w-[16rem] items-start gap-1 text-left text-xs text-[var(--color-ink-500)] hover:text-[var(--color-ink-700)] cursor-pointer"
                      >
                        <StickyNote size={11} className="mt-0.5 shrink-0 text-[var(--color-ink-400)]" />
                        <span className="line-clamp-2">
                          {latestNote(d)!.text}
                          {(d.notes?.length ?? 0) > 1 && <span className="text-[var(--color-ink-400)]"> · +{d.notes!.length - 1} more</span>}
                        </span>
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--color-ink-800)]">{dateCell(d.dob)}</td>
                  <td className="py-2.5 pr-3 text-[var(--color-ink-800)]">
                    {d.licenseNumber ? <span className="font-mono text-xs">{d.licenseNumber}</span> : <span className="whitespace-nowrap text-xs italic text-[var(--color-ink-400)]">No license #</span>}
                    <div className="text-xs text-[var(--color-ink-500)]">
                      {[d.licenseState, d.licenseClass ? `Class ${d.licenseClass}` : null, d.isCDL ? 'CDL' : null].filter(Boolean).join(' · ') || ''}
                    </div>
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--color-ink-800)]">{dateCell(d.issueDate)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--color-ink-800)]">{dateCell(d.expirationDate)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--color-ink-800)]">
                    <CdlSinceCell driver={d} onSave={(date) => onUpdate(d.id, { cdlOriginalIssueDate: date, cdlOriginalIssueSource: undefined })} />
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--color-ink-800)]" data-testid="driver-experience">
                    {exp ? formatExperience(exp) : '—'}
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--color-ink-800)]">{dateCell(d.hireDate)}</td>
                  <td className="py-2.5 pr-3 text-[var(--color-ink-800)]">{d.violations ?? '—'}</td>
                  <td className="max-w-[6rem] py-2.5 pr-3 text-xs text-[var(--color-ink-400)]">
                    {d.isManual ? (
                      <span className="inline-flex items-center gap-1">
                        <User size={11} />
                        Manual
                      </span>
                    ) : (
                      <span className="block truncate" title={d.source?.documentName}>
                        {d.source?.documentName ?? '—'}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          if (!open) toggle(d.id);
                          // With no notes yet, go straight to writing one; otherwise show them.
                          if (!d.notes?.length) setNoteFocusId(d.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer whitespace-nowrap"
                        aria-label={`Notes for ${d.name ?? 'driver'}`}
                      >
                        <StickyNote size={13} />
                        {(d.notes?.length ?? 0) > 0 ? `Notes (${d.notes!.length})` : 'Add note'}
                      </button>
                      <button onClick={() => startEdit(d)} disabled={editingId !== null} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer disabled:opacity-40" aria-label="Edit driver">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setDeleteTarget(d)} disabled={editingId !== null} className="rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] cursor-pointer disabled:opacity-40" aria-label="Delete driver">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
                {open && (
                  <tr className="border-b border-[var(--color-ink-100)] bg-[var(--color-ink-50)]/60">
                    <td />
                    <td colSpan={COLS - 1} className="py-3 pr-4">
                      <DriverDetails accountId={accountId} driver={d} focusNote={noteFocusId === d.id} onNoteFocused={() => setNoteFocusId(null)} onCancelNote={() => toggle(d.id)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <Modal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title={`Merge ${selectedDrivers.length} drivers into one`}
        subtitle="Choose the row to keep. It takes any details it's missing from the others — nothing it already has is overwritten. Documents and notes are kept. The other rows are removed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmMerge} disabled={!mergeKeepId} data-testid="confirm-merge-drivers">
              Merge drivers
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2" data-testid="merge-drivers-dialog">
          {selectedDrivers.map((d) => (
            <label key={d.id} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm', mergeKeepId === d.id ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)]/50' : 'border-[var(--color-ink-100)]')}>
              <input type="radio" name="merge-keep" className="mt-1" checked={mergeKeepId === d.id} onChange={() => setMergeKeepId(d.id)} />
              <span>
                <span className="font-medium text-[var(--color-ink-900)]">{d.name ?? 'Unnamed driver'}</span>
                <span className="block text-xs text-[var(--color-ink-500)]">
                  {[d.dob ? `DOB ${dateCell(d.dob)}` : null, d.licenseNumber ? `License ${d.licenseNumber}` : null, d.licenseState, d.isManual ? 'Manual' : d.source?.documentName].filter(Boolean).join(' · ') || 'No other details'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </Modal>

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

/** The driver's most recent note, shown under their name in the list. */
function latestNote(d: DriverEntry): DriverNote | undefined {
  return [...(d.notes ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

/** Everything else about one driver, and their own notes. */
function DriverDetails({
  accountId,
  driver,
  focusNote,
  onNoteFocused,
  onCancelNote,
}: {
  accountId: string;
  driver: DriverEntry;
  focusNote?: boolean;
  onNoteFocused?: () => void;
  /** Cancel on the note box closes the driver's details again. */
  onCancelNote?: () => void;
}) {
  const addDriverNote = useAccountsStore((s) => s.addDriverNote);
  const [text, setText] = useState('');
  // The note box is only there while writing one: "Add a note" opens it, Cancel or Add closes it.
  const [composing, setComposing] = useState(!!focusNote);
  const noteInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusNote) return;
    setComposing(true);
    onNoteFocused?.();
  }, [focusNote, onNoteFocused]);
  useEffect(() => {
    if (composing) noteInput.current?.focus();
  }, [composing]);
  // Oldest first: a new note lands where the box was, and "Add a note" moves below it.
  const notes = [...(driver.notes ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const reset = () => {
    setText('');
    setComposing(false);
  };
  const cancel = () => {
    reset();
    onCancelNote?.();
  };
  const facts: [string, string | undefined][] = [
    ['Address', driver.address],
    ['Restrictions', driver.restrictions],
    ['Endorsements', driver.endorsements],
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[var(--color-ink-500)]">{k}</dt>
            <dd className={v ? 'text-[var(--color-ink-800)]' : 'italic text-[var(--color-ink-400)]'}>{v || 'Not on file'}</dd>
          </div>
        ))}
        <div>
          <dt className="text-[var(--color-ink-500)]">MVR report date</dt>
          <dd className={driver.mvrReportDate ? 'flex flex-wrap items-center gap-1.5 text-[var(--color-ink-800)]' : 'italic text-[var(--color-ink-400)]'}>
            {driver.mvrReportDate ? formatShortDate(driver.mvrReportDate) : 'Not on file'}
            <FreshnessBadge kind="mvr" reportDate={driver.mvrReportDate} />
          </dd>
        </div>
      </dl>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Driver notes</p>
        {notes.length > 0 && (
          <ul className="mb-2 flex flex-col gap-1.5" data-testid="driver-notes">
            {notes.map((n) => (
              <DriverNoteRow key={n.id} accountId={accountId} driverId={driver.id} note={n} />
            ))}
          </ul>
        )}
        {composing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              addDriverNote(accountId, driver.id, text);
              reset();
            }}
            className="flex gap-2"
          >
            <input
              ref={noteInput}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && cancel()}
              className={inputClass}
              placeholder={`Note about ${driver.name ?? 'this driver'}…`}
              aria-label="New driver note"
            />
            <Button type="submit" size="sm" disabled={!text.trim()}>
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer"
          >
            <StickyNote size={13} />
            Add a note
          </button>
        )}
      </div>
    </div>
  );
}

function DriverNoteRow({ accountId, driverId, note }: { accountId: string; driverId: string; note: DriverNote }) {
  const updateDriverNote = useAccountsStore((s) => s.updateDriverNote);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  if (editing) {
    return (
      <li>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateDriverNote(accountId, driverId, note.id, text);
            setEditing(false);
          }}
          className="flex gap-2"
        >
          <input value={text} onChange={(e) => setText(e.target.value)} className={inputClass} aria-label="Edit driver note" autoFocus />
          <Button type="submit" size="sm" disabled={!text.trim()}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 rounded-md bg-white px-2.5 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--color-ink-400)]">
          {formatTimestampShort(note.createdAt)}
          {note.authorName ? ` · ${note.authorName}` : ''}
          {note.updatedAt ? ` · edited ${formatTimestampShort(note.updatedAt)}${note.updatedByName ? ` by ${note.updatedByName}` : ''}` : ''}
        </p>
        <p className="whitespace-pre-line text-[var(--color-ink-800)]">{note.text}</p>
      </div>
      <button
        onClick={() => {
          setText(note.text);
          setEditing(true);
        }}
        className="shrink-0 rounded-md p-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-700)] cursor-pointer"
        aria-label="Edit driver note"
      >
        <Pencil size={12} />
      </button>
    </li>
  );
}
