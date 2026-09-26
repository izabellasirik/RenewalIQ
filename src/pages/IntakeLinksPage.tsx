import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, Copy, Download, Eye, FileText, FileWarning, Inbox, Link2, Loader2, X } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Badge, ConfirmDialog, EmptyState, Skeleton, Tabs } from '../components/ui';
import { COVERAGE_LABELS } from '../types';
import type { IntakeDocument, IntakeLink, IntakeSubmission, IntakeSubmissionStatus } from '../types';
import { useBrokerSession } from '../hooks/useBrokerSession';
import { createIntakeLink, dismissIntakeSubmission, downloadIntakeDocumentFile, fetchIntakeDocuments, fetchIntakeLinks, fetchIntakeSubmissions, setIntakeLinkActive } from '../services/supabase/intakeRepo';
import { DocumentPreviewModal, type PreviewableFile } from '../components/upload/DocumentPreviewModal';
import { saveBlobAs } from '../services/documents/fileAccess';
import { inferFileType } from '../utils/documents';
import { importIntakeSubmission } from '../services/intake/importIntakeSubmission';
import { findLikelyDuplicateAccount, type DuplicateMatch } from '../services/intake/duplicateDetection';
import { useAccountsStore } from '../state/useAccountsStore';
import { formatDate } from '../utils/dates';

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

function LinkRow({ link, onToggled }: { link: IntakeLink; onToggled: () => void }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `${window.location.origin}/intake/${link.token}`;

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
          <p className="truncate text-sm font-medium text-[var(--color-ink-800)]">{link.label}</p>
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
        </div>
      </div>
      {error && <p className="mt-1.5 text-xs text-[var(--color-danger-600)]">{error}</p>}
    </div>
  );
}

function LinksSection({ userId }: { userId: string }) {
  const [links, setLinks] = useState<IntakeLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  // The agency name clients see on the form — pre-filled from the most recent link that has one.
  const [orgName, setOrgName] = useState('');
  const [orgNameTouched, setOrgNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchIntakeLinks(userId);
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
    load();
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-ink-900)]">Submission Links</h2>
        <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">Share a link with an agency, safety company, or client so they can submit a new account without a RenewalIQ login.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs font-medium text-[var(--color-ink-600)]">
          Label (only you see this)
          <input className={`${inputClass} mt-1`} placeholder="e.g. ABC Client" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
        </label>
        <label className="flex-1 text-xs font-medium text-[var(--color-ink-600)]">
          Agency name (shown to the client)
          <input
            className={`${inputClass} mt-1`}
            placeholder="e.g. DXP Services Inc."
            value={orgName}
            onChange={(e) => {
              setOrgName(e.target.value);
              setOrgNameTouched(true);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </label>
        <Button disabled={!label.trim() || creating} onClick={handleCreate}>
          {creating ? 'Creating…' : 'New Link'}
        </Button>
      </div>
      {!orgName.trim() && !orgNameTouched && <p className="-mt-2 text-xs text-[var(--color-ink-400)]">Without an agency name, the form says “your insurance broker”.</p>}
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
            <LinkRow key={l.id} link={l} onToggled={load} />
          ))}
        </div>
      )}
    </div>
  );
}

const FILTER_ORDER: IntakeSubmissionStatus[] = ['pending', 'imported', 'dismissed'];
const FILTER_LABELS: Record<IntakeSubmissionStatus, string> = { pending: 'Pending', imported: 'Imported', dismissed: 'Dismissed' };

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

function SubmissionCard({ submission, onChanged, collapsed, onToggle }: { submission: IntakeSubmission; onChanged: () => void; collapsed: boolean; onToggle: () => void }) {
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

  // Warn before creating a second account for the same business (DOT # or named insured match).
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);

  function handleImportClick() {
    const { accounts, riskProfiles } = useAccountsStore.getState();
    const match = findLikelyDuplicateAccount(submission, accounts, riskProfiles);
    if (match) setDuplicate(match);
    else void handleImport();
  }

  async function handleImport() {
    setDuplicate(null);
    setBusy('import');
    setError(null);
    const result = await importIntakeSubmission(submission);
    setBusy(null);
    if (!result.ok) {
      setError(result.message ?? 'Could not import this submission.');
      return;
    }
    onChanged();
    if (result.accountId) navigate(`/accounts/${result.accountId}`);
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
            <p className="text-xs text-[var(--color-ink-400)]">
              {[submission.contactName, submission.contactEmail, submission.contactPhone].filter(Boolean).join(' · ')}
              {collapsed && documents && documents.length > 0 && ` · ${documents.length} document${documents.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        <p className="text-xs text-[var(--color-ink-400)]">Submitted {formatDate(submission.createdAt)}</p>
      </div>

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

      {submission.status === 'pending' && (
        <div className="mt-4 flex gap-2 border-t border-[var(--color-ink-100)] pt-3">
          <Button size="sm" disabled={busy !== null} onClick={handleImportClick}>
            {busy === 'import' ? 'Importing…' : 'Import'}
          </Button>
          <Button size="sm" variant="ghost" icon={<X size={13} />} disabled={busy !== null} onClick={handleDismiss}>
            Dismiss
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={!!duplicate}
        onCancel={() => setDuplicate(null)}
        onConfirm={() => void handleImport()}
        title="Possible duplicate account"
        description={
          duplicate
            ? `You already have "${duplicate.account.namedInsured}" (${duplicate.reason}). Import this submission as another account anyway?`
            : ''
        }
        confirmLabel="Import anyway"
        cancelLabel="Don't import"
        variant="default"
      />
      {submission.status === 'imported' && submission.importedAccountId && (
        <div className="mt-4 border-t border-[var(--color-ink-100)] pt-3">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/accounts/${submission.importedAccountId}/risk-profile`)}>
            View Submission
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

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchIntakeSubmissions(userId);
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.message);
      return;
    }
    setLoadError(null);
    setSubmissions(result.data);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<IntakeSubmissionStatus, number> = { pending: 0, imported: 0, dismissed: 0 };
    for (const s of submissions) c[s.status]++;
    return c;
  }, [submissions]);

  const filtered = submissions.filter((s) => s.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <Tabs items={FILTER_ORDER.map((key) => ({ key, label: FILTER_LABELS[key], count: counts[key] }))} active={filter} onChange={(k) => setFilter(k as IntakeSubmissionStatus)} />
      {loading ? (
        <Skeleton variant="block" className="h-32 w-full" />
      ) : loadError ? (
        <EmptyState icon={<FileWarning size={26} strokeWidth={1.5} />} title="Couldn't load submissions" description={loadError} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Inbox size={26} strokeWidth={1.5} />} title={`No ${FILTER_LABELS[filter].toLowerCase()} submissions`} description="Nothing to show in this view." />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((s) => (
            <SubmissionCard key={s.id} submission={s} onChanged={load} collapsed={collapsed.has(s.id)} onToggle={() => toggleCollapsed(s.id)} />
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
