import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, FileWarning, Inbox, Link2, Loader2, X } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Badge, EmptyState, Skeleton, Tabs } from '../components/ui';
import { COVERAGE_LABELS } from '../types';
import type { IntakeLink, IntakeSubmission, IntakeSubmissionStatus } from '../types';
import { useBrokerSession } from '../hooks/useBrokerSession';
import { createIntakeLink, dismissIntakeSubmission, fetchIntakeLinks, fetchIntakeSubmissions, setIntakeLinkActive } from '../services/supabase/intakeRepo';
import { importIntakeSubmission } from '../services/intake/importIntakeSubmission';
import { formatDate } from '../utils/dates';

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

function LinkRow({ link, onToggled }: { link: IntakeLink; onToggled: () => void }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = `${window.location.origin}/intake/${link.token}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function toggle() {
    setBusy(true);
    await setIntakeLinkActive(link.id, !link.active);
    setBusy(false);
    onToggled();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--color-ink-800)]">{link.label}</p>
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
  );
}

function LinksSection({ userId }: { userId: string }) {
  const [links, setLinks] = useState<IntakeLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchIntakeLinks(userId);
    setLoading(false);
    if (result.ok) setLinks(result.data);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!label.trim()) return;
    setCreating(true);
    const result = await createIntakeLink(userId, label.trim());
    setCreating(false);
    if (result.ok) {
      setLabel('');
      load();
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-ink-900)]">Submission Links</h2>
        <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">Share a link with an agency, safety company, or client so they can submit a new account without a Renewal IQ login.</p>
      </div>
      <div className="flex gap-2">
        <input className={inputClass} placeholder="Label, e.g. Acme Safety Group" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
        <Button disabled={!label.trim() || creating} onClick={handleCreate}>
          {creating ? 'Creating…' : 'New Link'}
        </Button>
      </div>
      {loading ? (
        <Skeleton variant="block" className="h-16 w-full" />
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

function SubmissionCard({ submission, onChanged }: { submission: IntakeSubmission; onChanged: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'import' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setBusy('import');
    setError(null);
    const result = await importIntakeSubmission(submission);
    setBusy(null);
    if (!result.ok) {
      setError(result.message ?? 'Could not import this submission.');
      return;
    }
    onChanged();
    if (result.accountId) navigate(`/accounts/${result.accountId}/risk-profile`);
  }

  async function handleDismiss() {
    setBusy('dismiss');
    await dismissIntakeSubmission(submission.id);
    setBusy(null);
    onChanged();
  }

  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink-900)]">{submission.namedInsured || 'Unnamed submission'}</p>
          <p className="text-xs text-[var(--color-ink-400)]">
            {[submission.contactName, submission.contactEmail, submission.contactPhone].filter(Boolean).join(' · ')}
          </p>
        </div>
        <p className="text-xs text-[var(--color-ink-400)]">Submitted {formatDate(submission.createdAt)}</p>
      </div>

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
  );
}

function SubmissionsSection({ userId }: { userId: string }) {
  const [submissions, setSubmissions] = useState<IntakeSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<IntakeSubmissionStatus>('pending');

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
            <SubmissionCard key={s.id} submission={s} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

export function IntakeLinksPage() {
  const session = useBrokerSession();

  return (
    <PageContainer title="Submission Intake" description="Let an agency, safety company, or client submit a new account directly — no Renewal IQ login required.">
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
