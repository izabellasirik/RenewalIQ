import { Fragment, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, User, AlertTriangle, ChevronDown, ChevronRight, StickyNote } from 'lucide-react';
import type { DriverEntry, DriverNote } from '../../types';
import { Button, ConfirmDialog } from '../ui';
import { formatDuration, toMonths } from '../../utils/duration';
import { driverExperience, monthsSince } from '../../utils/driverExperience';
import { DurationInput } from './DurationInput';
import { EMPTY_DURATION_DRAFT, draftToDuration, durationToDraft, type DurationDraft } from '../../utils/durationDraft';
import { useAccountsStore } from '../../state/useAccountsStore';
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
  hireDate: string;
  mvrReportDate: string;
  yearsExperience: DurationDraft;
  violations: string;
};

const EMPTY_DRAFT: Draft = { name: '', address: '', dob: '', licenseState: '', licenseNumber: '', licenseClass: '', issueDate: '', expirationDate: '', hireDate: '', mvrReportDate: '', yearsExperience: EMPTY_DURATION_DRAFT, violations: '' };

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
    hireDate: d.hireDate ?? '',
    mvrReportDate: d.mvrReportDate ?? '',
    yearsExperience: durationToDraft(driverExperience(d)),
    violations: d.violations ?? '',
  };
}

/**
 * Experience: counted from the license issue date unless the broker typed something different —
 * then their figure is kept as a manual correction. `experienceTouched`: the broker changed the
 * experience box in this edit.
 */
export function fromDraft(d: Draft, experienceTouched: boolean): Omit<DriverEntry, 'id'> {
  const typed = draftToDuration(d.yearsExperience) ?? undefined;
  const fromIssue = d.issueDate ? monthsSince(d.issueDate) : null;
  const auto = fromIssue !== null && (!experienceTouched || typed === undefined || toMonths(typed) === fromIssue);
  return {
    name: d.name.trim() || undefined,
    address: d.address.trim() || undefined,
    dob: d.dob.trim() || undefined,
    licenseState: d.licenseState.trim() || undefined,
    licenseNumber: d.licenseNumber.trim() || undefined,
    licenseClass: d.licenseClass.trim() || undefined,
    issueDate: d.issueDate.trim() || undefined,
    expirationDate: d.expirationDate.trim() || undefined,
    hireDate: d.hireDate || undefined,
    mvrReportDate: d.mvrReportDate || undefined,
    yearsExperience: auto ? { months: fromIssue! } : typed,
    experienceFromIssueDate: auto,
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

const COLS = 11;
const dateCell = (v?: string) => (v ? (normalizeDateKey(v) ? formatShortDate(v) : v) : '—');

export function DriversTable({
  accountId,
  drivers,
  onAdd,
  onUpdate,
  onDelete,
}: {
  accountId: string;
  drivers: DriverEntry[];
  onAdd: (entry: Omit<DriverEntry, 'id'>) => void;
  onUpdate: (id: string, patch: Partial<DriverEntry>) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [experienceTouched, setExperienceTouched] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<DriverEntry | null>(null);

  function startAdd() {
    setDraft(EMPTY_DRAFT);
    setExperienceTouched(false);
    setEditingId('new');
  }
  function startEdit(d: DriverEntry) {
    setDraft(toDraft(d));
    setExperienceTouched(false);
    setEditingId(d.id);
  }
  function save(e: FormEvent) {
    e.preventDefault();
    if (editingId === 'new') onAdd(fromDraft(draft, experienceTouched));
    else if (editingId) onUpdate(editingId, fromDraft(draft, experienceTouched));
    setEditingId(null);
  }
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const fromIssue = draft.issueDate ? monthsSince(draft.issueDate) : null;

  function editor(isNew: boolean) {
    const field = (label: string, key: keyof Omit<Draft, 'yearsExperience'>, type: 'text' | 'date' = 'text', placeholder?: string) => (
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
            {field('Date of hire', 'hireDate', 'date')}
            {field('MVR report date', 'mvrReportDate', 'date')}
            <div className="col-span-2">
              <span className={labelClass}>Driving / license experience</span>
              <DurationInput
                value={draft.yearsExperience}
                onChange={(v) => {
                  setExperienceTouched(true);
                  setDraft({ ...draft, yearsExperience: v });
                }}
                inputClassName={inputClass}
                label="Driver experience"
              />
              {fromIssue !== null && (
                <p className="mt-1 text-xs text-[var(--color-ink-500)]">
                  From the issue date: {formatDuration({ months: fromIssue }) || '0 months'}
                  {experienceTouched && toMonths(draftToDuration(draft.yearsExperience) ?? undefined) !== fromIssue ? ' — your figure will be kept as a correction.' : ' — kept up to date automatically.'}
                  {experienceTouched && (
                    <button
                      type="button"
                      className="ml-1 font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer"
                      onClick={() => {
                        setExperienceTouched(false);
                        setDraft({ ...draft, yearsExperience: durationToDraft({ months: fromIssue }) });
                      }}
                    >
                      Use issue date
                    </button>
                  )}
                </p>
              )}
            </div>
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
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={startAdd} disabled={editingId !== null}>
          Add driver
        </Button>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-ink-100)] text-xs text-[var(--color-ink-500)]">
            <th className="w-6 py-2" />
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">DOB</th>
            <th className="py-2 pr-4 font-medium">License</th>
            <th className="py-2 pr-4 font-medium">Issued</th>
            <th className="py-2 pr-4 font-medium">Expires</th>
            <th className="py-2 pr-4 font-medium">Experience</th>
            <th className="py-2 pr-4 font-medium">Hired</th>
            <th className="py-2 pr-4 font-medium">Violations</th>
            <th className="py-2 pr-4 font-medium">Source</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {editingId === 'new' && editor(true)}
          {drivers.map((d) => {
            if (editingId === d.id) return editor(false);
            const open = expanded.has(d.id);
            const exp = driverExperience(d);
            return (
              <Fragment key={d.id}>
                <tr className="border-b border-[var(--color-ink-100)] last:border-0">
                  <td className="py-2.5 align-top">
                    <button onClick={() => toggle(d.id)} className="rounded p-0.5 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] cursor-pointer" aria-label={`${open ? 'Hide' : 'Show'} details for ${d.name ?? 'driver'}`} aria-expanded={open}>
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">
                    <span className="inline-flex items-center gap-1.5">
                      {d.name ?? '—'}
                      {needsReview(d) && (
                        <span title={reviewTooltip(d)} className="inline-flex items-center text-[var(--color-warning-600,#b45309)]">
                          <AlertTriangle size={12} />
                        </span>
                      )}
                      {reportAge('mvr', d.mvrReportDate)?.outdated && <FreshnessBadge kind="mvr" reportDate={d.mvrReportDate} />}
                      {(d.notes?.length ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-[var(--color-ink-400)]" title="Driver notes">
                          <StickyNote size={11} />
                          {d.notes!.length}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{dateCell(d.dob)}</td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">
                    <span className="font-mono text-xs">{d.licenseNumber ?? '—'}</span>
                    <div className="text-xs text-[var(--color-ink-500)]">
                      {[d.licenseState, d.licenseClass ? `Class ${d.licenseClass}` : null, d.isCDL ? 'CDL' : null].filter(Boolean).join(' · ') || ''}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{dateCell(d.issueDate)}</td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{dateCell(d.expirationDate)}</td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">
                    {exp !== undefined ? formatDuration(exp) || '—' : '—'}
                    {d.experienceFromIssueDate && d.issueDate && <div className="text-[11px] text-[var(--color-ink-400)]">from issue date</div>}
                  </td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{dateCell(d.hireDate)}</td>
                  <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.violations ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-xs text-[var(--color-ink-400)]">
                    {d.isManual ? (
                      <span className="inline-flex items-center gap-1">
                        <User size={11} />
                        Entered by broker
                      </span>
                    ) : (
                      (d.source?.documentName ?? '—')
                    )}
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-1">
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
                      <DriverDetails accountId={accountId} driver={d} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
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

/** Everything else about one driver, and their own notes. */
function DriverDetails({ accountId, driver }: { accountId: string; driver: DriverEntry }) {
  const addDriverNote = useAccountsStore((s) => s.addDriverNote);
  const [text, setText] = useState('');
  const notes = [...(driver.notes ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addDriverNote(accountId, driver.id, text);
            setText('');
          }}
          className="flex gap-2"
        >
          <input value={text} onChange={(e) => setText(e.target.value)} className={inputClass} placeholder={`Note about ${driver.name ?? 'this driver'}…`} aria-label="New driver note" />
          <Button type="submit" size="sm" disabled={!text.trim()}>
            Add
          </Button>
        </form>
        {notes.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {notes.map((n) => (
              <DriverNoteRow key={n.id} accountId={accountId} driverId={driver.id} note={n} />
            ))}
          </ul>
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
