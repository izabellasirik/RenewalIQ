import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, Copy, FileText, FileWarning, Inbox, Link2, Loader2, X } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Badge, EmptyState, Skeleton, Tabs } from '../components/ui';
import { COVERAGE_LABELS } from '../types';
import type { IntakeDocument, IntakeLink, IntakeSubmission, IntakeSubmissionStatus } from '../types';
import { useBrokerSession } from '../hooks/useBrokerSession';
import {
  createIntakeLink,
  dismissIntakeSubmission,
  fetchIntakeDocuments,
  fetchIntakeLinks,
  fetchIntakeSubmissions,
  getSignedIntakeDocumentUrl,
  setIntakeLinkActive,
} from '../services/supabase/intakeRepo';
import { importIntakeSubmission } from '../services/intake/importIntakeSubmission';
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
          <p className="truncate text-xs text-[var(--color-ink-400)]">{url}</p>
          {/* So the broker can confirm what recipients actually see, distinct from the internal label above. */}
          <p className="truncate text-xs text-[var(--color-ink-400)]">
            Shown to recipients as: <span className="font-medium text-[var(--color-ink-600)]">{link.organizationName || 'your insurance broker (not set)'}</span>
          </p>
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
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Pre-fill "shown to recipients as" from the broker's own most recently created link, so they
  // only have to type their brokerage name once rather than for every new link — but never
  // overwrite something the broker has already started typing this session.
  useEffect(() => {
    if (orgNameTouched || orgName) return;
    const mostRecentWithOrgName = links.find((l) => l.organizationName);
    if (mostRecentWithOrgName?.organizationName) setOrgName(mostRecentWithOrgName.organizationName);
  }, [links, orgName, orgNameTouched]);

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
    load();
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Internal label</label>
          <input
            className={inputClass}
            placeholder="Internal label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Brokerage name</label>
          <input
            className={inputClass}
            placeholder="Brokerage name"
            value={orgName}
            onChange={(e) => {
              setOrgName(e.target.value);
              setOrgNameTouched(true);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
        <Button disabled={!label.trim() || creating} onClick={handleCreate}>
          {creating ? 'Creating…' : 'New Link'}
        </Button>
      </div>
      {createError && <p className="text-xs text-[var(--color-danger-600)]">{createError}</p>}
      {loading ? (
        <Skeleton variant="block" className="h-16 w-full" />
      ) : loadError ? (
        <EmptyState icon={<FileWarning size={26} strokeWidth={1.5} />} title="Couldn't load submission links" description={loadError} />
      ) : links.length > 0 ? (
        <div className="flex flex-col gap-2">
          {links.map((l) => (
            <LinkRow key={l.id} link={l} onToggled={load} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const FILTER_ORDER: IntakeSubmissionStatus[] = ['pending', 'imported', 'dismissed'];
const FILTER_LABELS: Record<IntakeSubmissionStatus, string> = { pending: 'Pending', imported: 'Imported', dismissed: 'Dismissed' };
const STATUS_TONE: Record<IntakeSubmissionStatus, 'warning' | 'success' | 'neutral'> = { pending: 'warning', imported: 'success', dismissed: 'neutral' };

/**
 * One compact row per incoming submission — collapsed by default so a broker scanning the inbox
 * sees source/client/contact/date/status at a glance instead of a full detail block for every row
 * (that used to be the only view). Clicking the row (or its chevron) expands it in place to show
 * everything the old always-expanded card showed: full fields, coverage requested, notes,
 * documents, and the Import/Dismiss/View Submission actions — nothing from that detail view was
 * removed, it's just hidden until asked for.
 */
function SubmissionRow({
  submission,
  sourceLabel,
  expanded,
  onToggle,
  onChanged,
}: {
  submission: IntakeSubmission;
  sourceLabel: string | null;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'import' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fetched lazily — only once this row is actually expanded — so scanning a long compact list
  // never fires N document queries for rows the broker hasn't opened.
  const [documents, setDocuments] = useState<IntakeDocument[] | null>(null);
  const [docActionId, setDocActionId] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || documents !== null) return;
    let cancelled = false;
    fetchIntakeDocuments(submission.id).then((result) => {
      if (!cancelled && result.ok) setDocuments(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, documents, submission.id]);

  async function openDocument(doc: IntakeDocument) {
    setDocActionId(doc.id);
    setDocError(null);
    const result = await getSignedIntakeDocumentUrl(doc.storagePath);
    setDocActionId(null);
    if (!result.ok) {
      setDocError(result.message);
      return;
    }
    window.open(result.data, '_blank', 'noopener,noreferrer');
  }

  async function downloadDocument(doc: IntakeDocument) {
    setDocActionId(doc.id);
    setDocError(null);
    const result = await getSignedIntakeDocumentUrl(doc.storagePath, { download: true });
    setDocActionId(null);
    if (!result.ok) {
      setDocError(result.message);
      return;
    }
    window.open(result.data, '_blank', 'noopener,noreferrer');
  }

  async function handleImport() {
    setBusy('import');
    setError(null);
    const result = await importIntakeSubmission(submission);
    setBusy(null);
    if (!result.ok) {
      // alreadyImported means someone else (a second click, another tab) already claimed this one —
      // refresh the list so this row now shows its real Imported state instead of a stale error.
      if (result.alreadyImported) {
        onChanged();
        return;
      }
      setError(result.message ?? 'Could not import this submission.');
      return;
    }
    if (result.message) setError(result.message); // account created, but a non-fatal warning (see importIntakeSubmission.ts)
    onChanged();
    if (result.accountId) navigate(`/accounts/${result.accountId}/risk-profile`);
  }

  async function handleDismiss() {
    setBusy('dismiss');
    await dismissIntakeSubmission(submission.id);
    setBusy(null);
    onChanged();
  }

  const summaryParts = [submission.contactName, submission.contactEmail, submission.contactPhone].filter(Boolean).join(' · ');

  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left cursor-pointer"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={15} className="shrink-0 text-[var(--color-ink-400)]" /> : <ChevronRight size={15} className="shrink-0 text-[var(--color-ink-400)]" />}
        <div className="grid min-w-0 flex-1 grid-cols-2 items-center gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto]">
          <span className="truncate text-xs font-medium text-[var(--color-ink-500)]" title={sourceLabel ?? undefined}>
            {sourceLabel ?? '—'}
          </span>
          <span className="truncate text-sm font-semibold text-[var(--color-ink-900)]">{submission.namedInsured || 'Unnamed submission'}</span>
          <span className="col-span-2 truncate text-xs text-[var(--color-ink-500)] sm:col-span-1" title={summaryParts || undefined}>
            {submission.contactName || summaryParts || '—'}
          </span>
          <span className="hidden shrink-0 text-xs text-[var(--color-ink-400)] sm:block">{formatDate(submission.createdAt)}</span>
        </div>
        <Badge tone={STATUS_TONE[submission.status]}>{FILTER_LABELS[submission.status]}</Badge>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-ink-100)] p-4">
          <p className="text-xs text-[var(--color-ink-400)] sm:hidden">Submitted {formatDate(submission.createdAt)}</p>

          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            {submission.contactEmail && <p><span className="text-[var(--color-ink-400)]">Email:</span> {submission.contactEmail}</p>}
            {submission.contactPhone && <p><span className="text-[var(--color-ink-400)]">Phone:</span> {submission.contactPhone}</p>}
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
            <div className="mt-3 flex flex-col gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-500)]">
                <FileText size={12} />
                {documents.length} document{documents.length === 1 ? '' : 's'} attached
              </span>
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] px-2.5 py-1.5">
                  <button
                    onClick={() => openDocument(doc)}
                    disabled={docActionId === doc.id}
                    className="min-w-0 truncate text-left text-xs text-[var(--color-ink-700)] hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {doc.fileName}
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" disabled={docActionId === doc.id} onClick={() => openDocument(doc)}>
                      {docActionId === doc.id ? '…' : 'Preview'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={docActionId === doc.id} onClick={() => downloadDocument(doc)}>
                      Download
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {documents && documents.length === 0 && <p className="mt-3 text-xs italic text-[var(--color-ink-400)]">No documents attached.</p>}
          {documents === null && <Skeleton variant="block" className="mt-3 h-8 w-full" />}
          {docError && <p className="mt-1.5 text-xs text-[var(--color-danger-600)]">{docError}</p>}

          {error && <p className="mt-2 text-sm text-[var(--color-danger-600)]">{error}</p>}

          {submission.status === 'pending' && (
            <div className="mt-4 flex gap-2 border-t border-[var(--color-ink-100)] pt-3">
              <Button size="sm" disabled={busy !== null} onClick={handleImport}>
                {busy === 'import' ? 'Importing…' : 'Import'}
              </Button>
              <Button size="sm" variant="ghost" icon={<X size={13} />} disabled={busy !== null} onClick={handleDismiss}>
                Dismiss
              </Button>
            </div>
          )}
          {submission.status === 'imported' && submission.importedAccountId && (
            <div className="mt-4 border-t border-[var(--color-ink-100)] pt-3">
              <Button size="sm" variant="secondary" onClick={() => navigate(`/accounts/${submission.importedAccountId}/risk-profile`)}>
                View Submission
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubmissionsSection({ userId }: { userId: string }) {
  const [submissions, setSubmissions] = useState<IntakeSubmission[]>([]);
  // Source labels for every one of this broker's intake links, fetched once (not per-row) so the
  // compact list's "Source" column is available immediately for every row instead of firing one
  // query per submission — see IntakeLink.label's own comment for why this is the internal label,
  // never the recipient-facing organizationName.
  const [sourceLabels, setSourceLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<IntakeSubmissionStatus>('pending');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [subsResult, linksResult] = await Promise.all([fetchIntakeSubmissions(userId), fetchIntakeLinks(userId)]);
    setLoading(false);
    if (!subsResult.ok) {
      setLoadError(subsResult.message);
      return;
    }
    setLoadError(null);
    setSubmissions(subsResult.data);
    if (linksResult.ok) setSourceLabels(Object.fromEntries(linksResult.data.map((l) => [l.id, l.label])));
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
        <div className="flex flex-col gap-2">
          {filtered.map((s) => (
            <SubmissionRow
              key={s.id}
              submission={s}
              sourceLabel={sourceLabels[s.intakeLinkId] ?? null}
              expanded={expandedId === s.id}
              onToggle={() => setExpandedId((cur) => (cur === s.id ? null : s.id))}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function IntakeLinksPage() {
  const session = useBrokerSession();

  return (
    <PageContainer title="Submission Links" description="Create reusable links for agencies or clients to send new submissions directly to your workspace.">
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
          title="Sign in to use Submission Links"
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
