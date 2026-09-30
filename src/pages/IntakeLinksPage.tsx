import { useCallback, useEffect, useMemo, useState } from 'react';
import { intakeUrl } from '../services/publicLinks';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, Copy, Download, Eye, FileText, FileWarning, Inbox, Link2, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Badge, ConfirmDialog, EmptyState, Skeleton, Tabs } from '../components/ui';
import { COVERAGE_LABELS } from '../types';
import type { IntakeDocument, IntakeEvent, IntakeLink, IntakeSubmission, IntakeSubmissionStatus } from '../types';
import { useBrokerSession } from '../hooks/useBrokerSession';
import {
  createIntakeLink,
  dismissIntakeSubmission,
  downloadIntakeDocumentFile,
  fetchIntakeDocuments,
  fetchIntakeEvents,
  fetchManageableIntakeLinks,
  fetchIntakeDuplicateCandidates,
  fetchIntakeSubmissions,
  deleteIntakeLink,
  markStaleIntakeSubmissions,
  setIntakeLinkActive,
} from '../services/supabase/intakeRepo';
import { DocumentPreviewModal, type PreviewableFile } from '../components/upload/DocumentPreviewModal';
import { saveBlobAs } from '../services/documents/fileAccess';
import { inferFileType } from '../utils/documents';
import { addIntakeSubmissionToAccount, importIntakeSubmission, type ImportResult } from '../services/intake/importIntakeSubmission';
import { classifyDuplicates, intakeIdentity, localDuplicateCandidates, type DuplicateMatch } from '../services/intake/duplicateDetection';
import { useAccountsStore } from '../state/useAccountsStore';
import { fetchIntakeAgencyName, saveIntakeAgencyName } from '../services/supabase/profileRepo';
import { formatDate } from '../utils/dates';

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

function LinkRow({ link, onToggled, mine }: { link: IntakeLink; onToggled: () => void; mine: boolean }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const open = link.openSubmissions ?? 0;

  async function remove() {
    setConfirmDelete(false);
    setBusy(true);
    setError(null);
    const result = await deleteIntakeLink(link.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onToggled();
  }
  const url = intakeUrl(link.token);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function toggle() {
    setBusy(true);
    setError(null);
    const result = await setIntakeLinkActive(link.id, !link.active);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onToggled();
  }

  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--color-ink-800)]">
            {link.label}
            {!mine && link.ownerName && <span className="font-normal text-[var(--color-ink-500)]"> · {link.ownerName}’s link</span>}
          </p>
          <p className="truncate text-xs text-[var(--color-ink-500)]">
            Shown to the client as: <span className="font-medium text-[var(--color-ink-700)]">{link.organizationName || 'your insurance broker (no agency name set)'}</span>
          </p>
          <p className="truncate text-xs text-[var(--color-ink-400)]">{url}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={link.active ? 'success' : 'neutral'}>{link.active ? 'Active' : 'Inactive'}</Badge>
          <Button size="sm" variant="secondary" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={toggle}>
            {link.active ? 'Deactivate' : 'Activate'}
          </Button>
          <button
            onClick={() =>
              open > 0
                ? setError(`${open} submission${open === 1 ? '' : 's'} from this link ${open === 1 ? 'has' : 'have'} not been imported or dismissed yet — deal with ${open === 1 ? 'it' : 'them'} first, or deactivate the link instead.`)
                : setConfirmDelete(true)
            }
            disabled={busy}
            className="rounded-md p-1.5 text-[var(--color-ink-400)] hover:bg-[var(--color-danger-100)] hover:text-[var(--color-danger-600)] disabled:opacity-40 cursor-pointer"
            aria-label={`Delete link ${link.label}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {error && <p className="mt-1.5 text-xs text-[var(--color-danger-600)]">{error}</p>}
      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete this link?"
        description={`Anyone who has "${link.label}" will no longer be able to submit through it. Accounts already imported from it are not affected.`}
        confirmLabel="Delete link"
        variant="danger"
      />
    </div>
  );
}

function LinksSection({ userId }: { userId: string }) {
  const [links, setLinks] = useState<IntakeLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  // The agency name clients see on the form — pre-filled from the broker's saved default, else the
  // most recent link that has one, else their agency's name.
  const [orgName, setOrgName] = useState('');
  const [orgNameTouched, setOrgNameTouched] = useState(false);
  const [savedOrgName, setSavedOrgName] = useState<string | null>(null);
  const [savingOrgName, setSavingOrgName] = useState(false);
  const [orgNameNote, setOrgNameNote] = useState<string | null>(null);
  const agencyName = useAccountsStore((s) => s.agencyAccess?.agencyName ?? null);

  useEffect(() => {
    fetchIntakeAgencyName().then((saved) => {
      setSavedOrgName(saved);
      if (saved) setOrgName((cur) => cur || saved);
    });
  }, []);
  useEffect(() => {
    if (agencyName && savedOrgName !== null && !savedOrgName) setOrgName((cur) => cur || agencyName);
  }, [agencyName, savedOrgName]);

  async function rememberOrgName(name: string) {
    const trimmed = name.trim();
    if (trimmed === (savedOrgName ?? '')) return true;
    const res = await saveIntakeAgencyName(trimmed);
    if (res.ok) setSavedOrgName(trimmed);
    return res.ok;
  }

  async function handleSaveOrgName() {
    setSavingOrgName(true);
    const ok = await rememberOrgName(orgName);
    setSavingOrgName(false);
    setOrgNameNote(ok ? 'Saved — new links will use this name.' : "Couldn't save the agency name — try again.");
  }
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchManageableIntakeLinks(userId);
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.message);
      return;
    }
    setLoadError(null);
    setLinks(result.data);
    const lastName = result.data.find((l) => l.organizationName)?.organizationName;
    if (lastName) setOrgName((cur) => cur || lastName);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!label.trim()) return;
    setCreating(true);
    setCreateError(null);
    const result = await createIntakeLink(userId, label.trim(), orgName.trim() || null);
    setCreating(false);
    if (!result.ok) {
      // Never fail silently — a broker clicking "New Link" and seeing nothing happen (no new row,
      // no explanation) looks exactly like the feature being broken, which is the whole reason this
      // needed fixing: the previous version dropped this error on the floor.
      setCreateError(result.message);
      return;
    }
    setLabel('');
    setOrgNameTouched(false);
    // The name used for a link becomes the default for the next one.
    if (orgName.trim()) void rememberOrgName(orgName);
    load();
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-ink-900)]">Submission Links</h2>
        <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">Share a link with an agency, safety company, or client so they can submit a new account without a RenewalIQ login.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <label className="flex-1 text-xs font-medium text-[var(--color-ink-600)]">
          Label (only you see this)
          <input className={`${inputClass} mt-1`} placeholder="e.g. ABC Client" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
        </label>
        <div className="flex-1">
          <label className="block text-xs font-medium text-[var(--color-ink-600)]">
            Agency name (shown to the client)
            <input
              className={`${inputClass} mt-1`}
              placeholder="e.g. DXP Services Inc."
              value={orgName}
              onChange={(e) => {
                setOrgName(e.target.value);
                setOrgNameTouched(true);
                setOrgNameNote(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </label>
          {!orgName.trim() && !orgNameTouched && <p className="mt-1 text-xs font-normal text-[var(--color-ink-400)]">Without an agency name, the form says “your insurance broker”.</p>}
          {savedOrgName !== null && orgName.trim() && orgName.trim() !== savedOrgName ? (
            <p className="mt-1 text-xs font-normal text-[var(--color-ink-500)]">
              <button onClick={handleSaveOrgName} disabled={savingOrgName} className="font-medium text-[var(--color-brand-700)] hover:underline disabled:opacity-60 cursor-pointer">
                {savingOrgName ? 'Saving…' : 'Save as default'}
              </button>{' '}
              so you don't have to type it next time.
            </p>
          ) : (
            orgNameNote && <p className="mt-1 text-xs font-normal text-[var(--color-ink-500)]">{orgNameNote}</p>
          )}
        </div>
        {/* Lined up with the inputs (not their hints below). */}
        <Button disabled={!label.trim() || creating} onClick={handleCreate} className="sm:mt-5">
          {creating ? 'Creating…' : 'New Link'}
        </Button>
      </div>
      {createError && <p className="text-xs text-[var(--color-danger-600)]">{createError}</p>}
      {loading ? (
        <Skeleton variant="block" className="h-16 w-full" />
      ) : loadError ? (
        <EmptyState icon={<FileWarning size={26} strokeWidth={1.5} />} title="Couldn't load submission links" description={loadError} />
      ) : links.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-400)]">No submission links yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {links.map((l) => (
            <LinkRow key={l.id} link={l} onToggled={load} mine={l.userId === userId} />
          ))}
        </div>
      )}
    </div>
  );
}

const FILTER_ORDER: IntakeSubmissionStatus[] = ['pending', 'uploading', 'incomplete', 'imported', 'dismissed'];
const FILTER_LABELS: Record<IntakeSubmissionStatus, string> = { pending: 'Pending', uploading: 'Being sent', incomplete: 'Incomplete', imported: 'Imported', dismissed: 'Dismissed' };

const EVENT_LABELS: Record<IntakeEvent['event'], string> = {
  started: 'Client started sending',
  resumed: 'Client came back to finish',
  file_uploaded: 'File received',
  file_failed: 'File failed to upload',
  file_retry: 'Upload retried',
  file_removed: 'File removed by the client',
  verification_failed: 'Verification found something missing',
  completed: 'Verified complete — reference given to the client',
  abandoned: 'Client stopped before finishing',
  imported: 'Imported',
  dismissed: 'Dismissed',
};

/** Who did what, when — the submission's audit trail (0029). */
function SubmissionHistory({ submissionId }: { submissionId: string }) {
  const [events, setEvents] = useState<IntakeEvent[] | null>(null);
  useEffect(() => {
    fetchIntakeEvents(submissionId).then((r) => setEvents(r.ok ? r.data : []));
  }, [submissionId]);
  if (!events) return <p className="text-xs text-[var(--color-ink-400)]">Loading…</p>;
  if (events.length === 0) return <p className="text-xs italic text-[var(--color-ink-400)]">No history recorded for this submission.</p>;
  return (
    <ol className="flex flex-col gap-1 text-xs" aria-label="Submission history">
      {events.map((e) => {
        const d = e.detail as { file?: string; files?: unknown; error?: string; missing?: string[]; attempt?: number };
        const extra = [
          typeof d.file === 'string' ? d.file : null,
          Array.isArray(d.files) ? (d.files as string[]).join(', ') : null,
          typeof d.attempt === 'number' ? `attempt ${d.attempt}` : null,
          typeof d.error === 'string' ? d.error : null,
          Array.isArray(d.missing) && d.missing.length ? `${d.missing.length} file${d.missing.length === 1 ? '' : 's'} not confirmed` : null,
        ].filter(Boolean);
        return (
          <li key={e.id} className="flex gap-2">
            <span className="w-32 shrink-0 text-[var(--color-ink-400)]">{formatDate(e.createdAt)}</span>
            <span className={e.event === 'file_failed' || e.event === 'verification_failed' || e.event === 'abandoned' ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-ink-700)]'}>
              {EVENT_LABELS[e.event] ?? e.event}
              {extra.length > 0 && <span className="text-[var(--color-ink-500)]"> — {extra.join(' · ')}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Which submission cards are collapsed — remembered in this browser only (a view preference). */
function useCollapsedSubmissions(): [Set<string>, (id: string) => void] {
  const key = 'renewaliq.collapsedIntake';
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        // per-browser convenience only
      }
      return next;
    });
  }
  return [collapsed, toggle];
}

function SubmissionCard({
  submission,
  onChanged,
  onNotice,
  collapsed,
  onToggle,
  linkLabel,
  brokerName,
}: {
  submission: IntakeSubmission;
  /** The broker's label for the submission link the client used (e.g. "ABC Client"). */
  linkLabel?: string;
  /** Whose submission it is (the link's broker) — shown to admins, who see the whole agency's. */
  brokerName?: string;
  onChanged: () => void;
  /** A message that should outlive this card (it moves to another tab after importing). */
  onNotice: (text: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'import' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fetched once per card so a broker can see what was attached before deciding to import — the
  // "review it" step in the intake flow otherwise had no visibility into documents at all.
  const [documents, setDocuments] = useState<IntakeDocument[] | null>(null);
  const [preview, setPreview] = useState<PreviewableFile | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchIntakeDocuments(submission.id).then((result) => {
      if (!cancelled && result.ok) setDocuments(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [submission.id]);

  // Before creating an account: is this business already an account in the organization? (0039)
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);

  async function handleImportClick() {
    setError(null);
    setBusy('import');
    const server = await fetchIntakeDuplicateCandidates(submission.id);
    setBusy(null);
    if (!server.ok) {
      setError(`Couldn't check for an existing account, so nothing was imported: ${server.message}`);
      return;
    }
    const { accounts, riskProfiles } = useAccountsStore.getState();
    const candidates = server.data ?? localDuplicateCandidates(accounts, riskProfiles);
    const matches = classifyDuplicates(intakeIdentity(submission), candidates);
    if (matches.length > 0) setDuplicates(matches);
    else void runImport(() => importIntakeSubmission(submission));
  }

  async function runImport(action: () => Promise<ImportResult>) {
    setDuplicates(null);
    setBusy('import');
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      setError(result.message ?? 'Could not import this submission.');
      return;
    }
    // Something needs attention (a file didn't come through): stay here and say so.
    if (result.warning) {
      onNotice(`${submission.namedInsured || 'Submission'}: ${result.warning}`);
      onChanged();
    } else {
      onChanged();
      if (result.accountId) navigate(`/accounts/${result.accountId}/risk-profile`);
    }
  }

  function openPreview(d: IntakeDocument) {
    setPreview({
      id: d.id,
      name: d.fileName,
      fileType: inferFileType(d.fileName),
      loadBlob: async () => {
        const res = await downloadIntakeDocumentFile(d);
        return res.ok ? res.data : null;
      },
    });
  }

  async function download(d: IntakeDocument) {
    setDownloading(d.id);
    setError(null);
    const res = await downloadIntakeDocumentFile(d);
    setDownloading(null);
    if (res.ok) saveBlobAs(res.data, d.fileName);
    else setError(res.message);
  }

  async function handleDismiss() {
    setBusy('dismiss');
    await dismissIntakeSubmission(submission.id);
    setBusy(null);
    onChanged();
  }

  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white p-4">
      {/* Click the header to collapse / expand this client. */}
      <div
        onClick={onToggle}
        className="-m-2 flex cursor-pointer flex-wrap items-start justify-between gap-2 rounded-lg p-2 hover:bg-[var(--color-ink-50)]"
        title={collapsed ? 'Click to show details' : 'Click to collapse'}
        aria-expanded={!collapsed}
      >
        <div className="flex min-w-0 items-start gap-1.5">
          {collapsed ? <ChevronRight size={16} className="mt-0.5 shrink-0 text-[var(--color-ink-400)]" /> : <ChevronDown size={16} className="mt-0.5 shrink-0 text-[var(--color-ink-400)]" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-ink-900)]">{submission.namedInsured || 'Unnamed submission'}</p>
            {/* Who sent it — the person who filled in the form, and through which of your links. */}
            <p className="mt-0.5 text-sm text-[var(--color-ink-700)]">
              <span className="text-[var(--color-ink-500)]">From: </span>
              {[submission.contactName, submission.contactEmail, submission.contactPhone].filter(Boolean).join(' · ') || <span className="italic text-[var(--color-ink-400)]">no contact details given</span>}
            </p>
            <p className="text-xs text-[var(--color-ink-500)]">
              {brokerName && <>Broker: <span className="font-medium text-[var(--color-ink-700)]" data-testid="submission-broker">{brokerName}</span> · </>}
              {linkLabel ? <>Via link: <span className="font-medium text-[var(--color-ink-700)]">{linkLabel}</span></> : 'Via a submission link'}
              {submission.dotNumber && ` · DOT ${submission.dotNumber}`}
              {collapsed && documents && documents.length > 0 && ` · ${documents.length} document${documents.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        <div className="text-right text-xs text-[var(--color-ink-400)]">
          <p>{submission.status === 'uploading' ? 'Started' : 'Submitted'} {formatDate(submission.completedAt ?? submission.createdAt)}</p>
          {submission.reference && <p className="font-mono text-[var(--color-ink-600)]">{submission.reference}</p>}
        </div>
      </div>
      {(submission.status === 'uploading' || submission.status === 'incomplete') && (
        <div
          className={`mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${submission.status === 'uploading' ? 'bg-[var(--color-ink-50)] text-[var(--color-ink-700)]' : 'bg-[var(--color-warning-100)]/50 text-[var(--color-ink-800)]'}`}
          role="status"
        >
          {submission.status === 'uploading' ? <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" /> : <FileWarning size={13} className="mt-0.5 shrink-0 text-[var(--color-warning-600)]" />}
          <p>
            {submission.status === 'uploading'
              ? `The client is still sending this${documents ? ` — ${documents.length}${submission.expectedFiles ? ` of ${submission.expectedFiles}` : ''} file${(submission.expectedFiles ?? documents.length) === 1 ? '' : 's'} so far` : ''}. It can be imported once they finish.`
              : `The client stopped before finishing${documents ? ` — ${documents.length}${submission.expectedFiles ? ` of ${submission.expectedFiles}` : ''} file${(submission.expectedFiles ?? documents.length) === 1 ? '' : 's'} arrived` : ''}. They can still finish it from the same browser, or you can import what arrived.`}
          </p>
        </div>
      )}

      {!collapsed && (
        <>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        {submission.dotNumber && <p><span className="text-[var(--color-ink-400)]">DOT:</span> {submission.dotNumber}</p>}
        {submission.mcNumber && <p><span className="text-[var(--color-ink-400)]">MC:</span> {submission.mcNumber}</p>}
        {submission.yearsInBusiness !== null && <p><span className="text-[var(--color-ink-400)]">Years in business:</span> {submission.yearsInBusiness}</p>}
        {submission.powerUnits !== null && <p><span className="text-[var(--color-ink-400)]">Power units:</span> {submission.powerUnits}</p>}
        {submission.driverCount !== null && <p><span className="text-[var(--color-ink-400)]">Drivers:</span> {submission.driverCount}</p>}
        {submission.operationType && <p><span className="text-[var(--color-ink-400)]">Operation:</span> {submission.operationType}</p>}
        {submission.commoditiesHauled && <p><span className="text-[var(--color-ink-400)]">Commodities:</span> {submission.commoditiesHauled}</p>}
        {submission.operatingRadius && <p><span className="text-[var(--color-ink-400)]">Radius:</span> {submission.operatingRadius}</p>}
        {submission.operatingStates && <p><span className="text-[var(--color-ink-400)]">States:</span> {submission.operatingStates}</p>}
        {submission.currentCarrier && <p><span className="text-[var(--color-ink-400)]">Current carrier:</span> {submission.currentCarrier}</p>}
        {submission.effectiveDate && <p><span className="text-[var(--color-ink-400)]">Effective date:</span> {submission.effectiveDate}</p>}
      </div>

      {submission.coverageRequested.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {submission.coverageRequested.map((type) => (
            <Badge key={type} tone="brand">
              {COVERAGE_LABELS[type]}
            </Badge>
          ))}
        </div>
      )}

      {submission.additionalNotes && (
        <p className="mt-3 whitespace-pre-line rounded-lg bg-[var(--color-ink-50)] px-3 py-2 text-xs text-[var(--color-ink-600)]">{submission.additionalNotes}</p>
      )}

      {documents && documents.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-500)]">
            {documents.length} document{documents.length === 1 ? '' : 's'} attached
          </p>
          <ul className="flex flex-col gap-1.5">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-1.5 text-sm">
                <FileText size={14} className="shrink-0 text-[var(--color-ink-400)]" />
                <button onClick={() => openPreview(d)} className="min-w-0 flex-1 truncate text-left text-[var(--color-ink-800)] hover:text-[var(--color-brand-700)] hover:underline cursor-pointer" title="Preview">
                  {d.fileName}
                </button>
                <Button size="sm" variant="ghost" icon={<Eye size={13} />} onClick={() => openPreview(d)}>
                  Preview
                </Button>
                <Button size="sm" variant="ghost" icon={downloading === d.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} disabled={downloading === d.id} onClick={() => download(d)}>
                  Download
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {documents && documents.length === 0 && <p className="mt-3 text-xs italic text-[var(--color-ink-400)]">No documents attached.</p>}

      {error && <p className="mt-2 text-sm text-[var(--color-danger-600)]">{error}</p>}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-ink-500)] hover:text-[var(--color-ink-700)]">History</summary>
        <div className="mt-2">
          <SubmissionHistory submissionId={submission.id} />
        </div>
      </details>

      {(submission.status === 'pending' || submission.status === 'incomplete') && (
        <div className="mt-4 flex gap-2 border-t border-[var(--color-ink-100)] pt-3">
          <Button size="sm" disabled={busy !== null} onClick={handleImportClick}>
            {busy === 'import' ? 'Importing…' : submission.status === 'incomplete' ? 'Import what arrived' : 'Import'}
          </Button>
          <Button size="sm" variant="ghost" icon={<X size={13} />} disabled={busy !== null} onClick={handleDismiss}>
            Dismiss
          </Button>
        </div>
      )}
      {duplicates && (
        <div className="mt-3 rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/40 p-3" data-testid="possible-existing-account" role="alert">
          <p className="text-sm font-semibold text-[var(--color-ink-900)]">Possible existing account</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-600)]">Nothing has been imported yet — the submission and its files stay here until you choose.</p>
          <ul className="mt-2 flex flex-col gap-2">
            {duplicates.map(({ candidate, reason }) => (
              <li key={candidate.accountId} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-ink-100)] bg-white px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--color-ink-900)]">
                    {candidate.namedInsured}
                    {candidate.archived && <span className="ml-1 text-xs font-normal text-[var(--color-ink-500)]">(archived)</span>}
                  </p>
                  <p className="text-xs text-[var(--color-ink-500)]">
                    {reason}
                    {candidate.assignedName ? ` · Broker: ${candidate.assignedName}` : ''}
                    {!candidate.canOpen && ' · assigned to someone else — ask them or an admin'}
                  </p>
                </div>
                <Button size="sm" disabled={busy !== null || !candidate.canOpen} onClick={() => void runImport(() => addIntakeSubmissionToAccount(submission, candidate.accountId))}>
                  Add submission to this account
                </Button>
                <Button size="sm" variant="secondary" disabled={!candidate.canOpen} onClick={() => navigate(`/accounts/${candidate.accountId}`)}>
                  Open existing account
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void runImport(() => importIntakeSubmission(submission))}>
              Create new account anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDuplicates(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {(submission.status === 'imported' || submission.status === 'dismissed') && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-ink-100)] pt-3">
          {submission.status === 'imported' && submission.importedAccountId && (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/accounts/${submission.importedAccountId}/risk-profile`)}>
              View Submission
            </Button>
          )}
          {/* Import again — e.g. the files didn't come through, or the account was removed. Warns first if an account for this business already exists. */}
          <Button size="sm" variant="secondary" icon={busy === 'import' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} disabled={busy !== null} onClick={handleImportClick}>
            {busy === 'import' ? 'Importing…' : 'Reimport'}
          </Button>
        </div>
      )}
        </>
      )}
      <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function SubmissionsSection({ userId }: { userId: string }) {
  const [submissions, setSubmissions] = useState<IntakeSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<IntakeSubmissionStatus>('pending');
  const [collapsed, toggleCollapsed] = useCollapsedSubmissions();
  const [notice, setNotice] = useState<string | null>(null);
  const [linkLabels, setLinkLabels] = useState<Record<string, string>>({});
  const [linkOwners, setLinkOwners] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    // Link labels only name the source on each card — a failure here just leaves them out.
    fetchManageableIntakeLinks(userId).then((links) => {
      if (!links.ok) return;
      setLinkLabels(Object.fromEntries(links.data.map((l) => [l.id, l.label])));
      setLinkOwners(Object.fromEntries(links.data.map((l) => [l.id, l.userId === userId ? 'You' : (l.ownerName ?? 'A teammate')])));
    });
    // Submissions a client stopped sending (2 hours without activity) show as incomplete.
    await markStaleIntakeSubmissions();
    const result = await fetchIntakeSubmissions(userId);
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.message);
      return;
    }
    setLoadError(null);
    setSubmissions(result.data);
    // Keeps the sidebar's pending dot in step right after an import / dismiss.
    useAccountsStore.getState().setPendingIntakeCount(result.data.filter((x) => x.status === 'pending').length);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<IntakeSubmissionStatus, number> = { pending: 0, uploading: 0, incomplete: 0, imported: 0, dismissed: 0 };
    for (const s of submissions) c[s.status]++;
    return c;
  }, [submissions]);

  const filtered = submissions.filter((s) => s.status === filter);

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/40 px-3 py-2 text-sm text-[var(--color-ink-800)]">
          <FileWarning size={16} className="mt-0.5 shrink-0 text-[var(--color-warning-600)]" />
          <p className="flex-1">{notice}</p>
          <button onClick={() => setNotice(null)} className="rounded p-0.5 text-[var(--color-ink-400)] hover:text-[var(--color-ink-700)] cursor-pointer" aria-label="Dismiss message">
            <X size={14} />
          </button>
        </div>
      )}
      <Tabs
        items={FILTER_ORDER.filter((key) => (key !== 'uploading' && key !== 'incomplete') || counts[key] > 0 || filter === key).map((key) => ({ key, label: FILTER_LABELS[key], count: counts[key] }))} active={filter} onChange={(k) => setFilter(k as IntakeSubmissionStatus)} />
      {loading ? (
        <Skeleton variant="block" className="h-32 w-full" />
      ) : loadError ? (
        <EmptyState icon={<FileWarning size={26} strokeWidth={1.5} />} title="Couldn't load submissions" description={loadError} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Inbox size={26} strokeWidth={1.5} />} title={`No ${FILTER_LABELS[filter].toLowerCase()} submissions`} description="Nothing to show in this view." />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((s) => (
            <SubmissionCard key={s.id} submission={s} onChanged={load} onNotice={setNotice} collapsed={collapsed.has(s.id)} onToggle={() => toggleCollapsed(s.id)} linkLabel={linkLabels[s.intakeLinkId]} brokerName={s.userId !== userId ? (linkOwners[s.intakeLinkId] ?? 'A teammate') : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

export function IntakeLinksPage() {
  const session = useBrokerSession();

  return (
    <PageContainer title="Submission Intake">
      {session.status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-ink-500)]">
          <Loader2 size={16} className="animate-spin" />
          Loading…
        </div>
      )}
      {session.status === 'not_configured' && (
        <EmptyState
          icon={<Link2 size={26} strokeWidth={1.5} />}
          title="Cloud sign-in isn't configured"
          description="Submission intake requires Supabase and a signed-in broker account, since a shared link has to point at your own workspace. See SUPABASE_SETUP.md."
        />
      )}
      {session.status === 'signed_out' && (
        <EmptyState
          icon={<Link2 size={26} strokeWidth={1.5} />}
          title="Sign in to use Submission Intake"
          description="Intake links belong to your broker account so submissions land in your own workspace."
        />
      )}
      {session.status === 'signed_in' && session.userId && (
        <div className="flex flex-col gap-6">
          <LinksSection userId={session.userId} />
          <SubmissionsSection userId={session.userId} />
        </div>
      )}
    </PageContainer>
  );
}
