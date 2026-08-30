import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleX, CircleHelp, ExternalLink } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Badge, EmptyState, Skeleton, Tabs } from '../components/ui';
import { AdminAuthGate } from '../components/admin/AdminAuthGate';
import { AppetiteUpdateStatusBadge, STATUS_LABELS } from '../components/admin/statusBadge';
import type { AppetiteFieldKey, AppetiteUpdateRequest, AppetiteUpdateStatus, VerificationStatus } from '../types';
import { APPETITE_FIELD_KEY_LABELS } from '../types';
import { fetchAllAppetiteUpdateRequests, reviewAppetiteUpdateRequest } from '../services/appetiteUpdates/appetiteUpdateService';
import { formatDate } from '../utils/dates';

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not on file';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

type ExpandedAction = 'none' | Exclude<AppetiteUpdateStatus, 'pending'>;
type FilterKey = 'all' | AppetiteUpdateStatus;

const FILTER_ORDER: FilterKey[] = ['pending', 'needs_more_information', 'approved', 'rejected', 'all'];
const FILTER_LABELS: Record<FilterKey, string> = { ...STATUS_LABELS, all: 'All' };

function RequestCard({ request, onReviewed }: { request: AppetiteUpdateRequest; onReviewed: () => void }) {
  const [expanded, setExpanded] = useState<ExpandedAction>('none');
  const [reviewNotes, setReviewNotes] = useState('');
  const [approveValue, setApproveValue] = useState(request.proposedValue);
  const [approveStatus, setApproveStatus] = useState<Extract<VerificationStatus, 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NEEDS_CONFIRMATION'>>('NEEDS_CONFIRMATION');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isResolved = request.status === 'approved' || request.status === 'rejected';

  async function confirm(decision: Exclude<AppetiteUpdateStatus, 'pending'>) {
    setSubmitting(true);
    setError(null);
    let approvedValue: unknown = undefined;
    if (decision === 'approved') {
      try {
        approvedValue = JSON.parse(approveValue);
      } catch {
        approvedValue = approveValue; // plain string/number-as-text is fine for string-typed criteria
      }
    }
    const result = await reviewAppetiteUpdateRequest({
      request,
      decision,
      reviewNotes: reviewNotes.trim(),
      approvedValue,
      approvedVerificationStatus: decision === 'approved' ? approveStatus : undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onReviewed();
  }

  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink-900)]">{request.marketName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{APPETITE_FIELD_KEY_LABELS[request.fieldKey as AppetiteFieldKey] ?? request.fieldKey}</Badge>
            <AppetiteUpdateStatusBadge status={request.status} />
          </div>
        </div>
        <p className="text-xs text-[var(--color-ink-400)]">
          {request.submitterName} · {request.submitterEmail}
          <br />
          Submitted {formatDate(request.createdAt)}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-dashed border-[var(--color-ink-200)] bg-[var(--color-ink-50)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)]">Current Value</p>
          <p className="mt-0.5 text-sm text-[var(--color-ink-700)]">{displayValue(request.currentValue)}</p>
        </div>
        <div className="rounded-lg border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-500)]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-700)]">Proposed Value</p>
          <p className="mt-0.5 text-sm font-medium text-[var(--color-ink-900)]">{request.proposedValue}</p>
        </div>
      </div>

      {request.notes && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)]">Broker Notes</p>
          <p className="mt-0.5 text-sm text-[var(--color-ink-600)]">{request.notes}</p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-ink-500)]">
        {request.sourceUrl && (
          <a href={request.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-700)] hover:underline">
            Source <ExternalLink size={11} />
          </a>
        )}
        {request.sourceReference && <span>Reference: {request.sourceReference}</span>}
      </div>

      {isResolved ? (
        <div className="mt-3 rounded-lg bg-[var(--color-ink-50)] px-3 py-2.5 text-xs text-[var(--color-ink-500)]">
          {STATUS_LABELS[request.status]} by {request.reviewedBy ?? 'an admin'}
          {request.reviewedAt && ` on ${formatDate(request.reviewedAt)}`}
          {request.reviewNotes && (
            <>
              <br />
              <span className="text-[var(--color-ink-600)]">{request.reviewNotes}</span>
            </>
          )}
        </div>
      ) : (
        <>
          {expanded === 'none' && (
            <div className="mt-4 flex gap-2">
              <Button size="sm" icon={<CircleCheck size={14} />} onClick={() => setExpanded('approved')}>
                Approve
              </Button>
              <Button size="sm" variant="danger" icon={<CircleX size={14} />} onClick={() => setExpanded('rejected')}>
                Reject
              </Button>
              <Button size="sm" variant="secondary" icon={<CircleHelp size={14} />} onClick={() => setExpanded('needs_more_information')}>
                Needs More Information
              </Button>
            </div>
          )}

          {expanded !== 'none' && (
            <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-ink-100)] pt-3">
              {expanded === 'approved' && (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">
                      Value to write live — confirm/edit before approving. Plain text/number/true-false for simple fields; JSON for States or Fleet Size (e.g. {'{"min":5,"max":40}'}).
                    </label>
                    <input value={approveValue} onChange={(e) => setApproveValue(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">
                      Verification status — never defaults to Verified. Choose Verified only if you've confirmed this against official carrier documentation.
                    </label>
                    <select value={approveStatus} onChange={(e) => setApproveStatus(e.target.value as typeof approveStatus)} className={inputClass}>
                      <option value="NEEDS_CONFIRMATION">Needs Confirmation — broker/underwriter said so, not independently confirmed</option>
                      <option value="PARTIALLY_VERIFIED">Partially Verified — part of this is confirmed</option>
                      <option value="VERIFIED">Verified — confirmed against official carrier documentation</option>
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Review notes (optional)</label>
                <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={2} className={inputClass} />
              </div>
              {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" disabled={submitting} onClick={() => confirm(expanded)}>
                  {submitting ? 'Saving…' : `Confirm ${expanded === 'needs_more_information' ? 'Needs More Information' : expanded === 'approved' ? 'Approval' : 'Rejection'}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setExpanded('none')}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RequestQueue() {
  const [requests, setRequests] = useState<AppetiteUpdateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('pending');

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchAllAppetiteUpdateRequests();
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.message);
      setRequests([]);
      return;
    }
    setLoadError(null);
    setRequests(result.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: requests.length, pending: 0, needs_more_information: 0, approved: 0, rejected: 0 };
    for (const r of requests) c[r.status]++;
    return c;
  }, [requests]);

  const filtered = filter === 'all' ? requests : requests.filter((r) => r.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <Tabs items={FILTER_ORDER.map((key) => ({ key, label: FILTER_LABELS[key], count: counts[key] }))} active={filter} onChange={(k) => setFilter(k as FilterKey)} />

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} variant="block" className="h-40 w-full" />
          ))}
        </div>
      ) : loadError ? (
        <EmptyState icon={<CircleX size={26} strokeWidth={1.5} />} title="Couldn't load requests" description={loadError} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<CircleCheck size={26} strokeWidth={1.5} />} title={`No ${filter === 'all' ? '' : FILTER_LABELS[filter].toLowerCase() + ' '}requests`} description="Nothing to show in this view." />
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((r) => (
            <RequestCard key={r.id} request={r} onReviewed={load} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminAppetiteUpdatesPage() {
  return (
    <PageContainer
      title="Appetite Update Requests"
      description="Every broker-submitted appetite correction is stored here — from the 'Request Appetite Update' button on Market Finder and Carrier Appetite — and reviewed by an admin before it goes live."
    >
      <AdminAuthGate>
        <RequestQueue />
      </AdminAuthGate>
    </PageContainer>
  );
}
