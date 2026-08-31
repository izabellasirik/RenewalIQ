import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleX, CircleHelp } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Badge, EmptyState, Skeleton, Tabs } from '../components/ui';
import { AdminAuthGate } from '../components/admin/AdminAuthGate';
import { FeedbackStatusBadge } from '../components/admin/feedbackStatusBadge';
import type { FeedbackStatus, ProductFeedback } from '../types';
import { FEEDBACK_STATUS_LABELS, FEEDBACK_TYPE_LABELS } from '../types';
import { fetchAllProductFeedback, updateFeedbackStatus } from '../services/feedback/feedbackService';
import { formatDate } from '../utils/dates';

type FilterKey = 'all' | FeedbackStatus;

const FILTER_ORDER: FilterKey[] = ['new', 'reviewed', 'resolved', 'all'];
const FILTER_LABELS: Record<FilterKey, string> = { ...FEEDBACK_STATUS_LABELS, all: 'All' };

function FeedbackCard({ entry, onUpdated }: { entry: ProductFeedback; onUpdated: () => void }) {
  const [submitting, setSubmitting] = useState<FeedbackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: FeedbackStatus) {
    setSubmitting(status);
    setError(null);
    const result = await updateFeedbackStatus(entry.id, status);
    setSubmitting(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onUpdated();
  }

  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{FEEDBACK_TYPE_LABELS[entry.feedbackType]}</Badge>
          <FeedbackStatusBadge status={entry.status} />
        </div>
        <p className="text-xs text-[var(--color-ink-400)]">
          {entry.name || entry.email ? (
            <>
              {[entry.name, entry.email].filter(Boolean).join(' · ')}
              <br />
            </>
          ) : null}
          Submitted {formatDate(entry.createdAt)}
        </p>
      </div>

      <p className="mt-3 whitespace-pre-line text-sm text-[var(--color-ink-800)]">{entry.message}</p>

      {entry.pagePath && (
        <p className="mt-2 text-xs text-[var(--color-ink-400)]">
          Page: {entry.pagePath}
          {entry.accountId ? ` · submission ${entry.accountId}` : ''}
          {entry.appetiteRecordId ? ` · market ${entry.appetiteRecordId}` : ''}
        </p>
      )}

      {error && <p className="mt-2 text-sm text-[var(--color-danger-600)]">{error}</p>}

      <div className="mt-4 flex gap-2 border-t border-[var(--color-ink-100)] pt-3">
        {entry.status !== 'reviewed' && (
          <Button size="sm" variant="secondary" icon={<CircleHelp size={14} />} disabled={submitting !== null} onClick={() => setStatus('reviewed')}>
            {submitting === 'reviewed' ? 'Saving…' : 'Mark Reviewed'}
          </Button>
        )}
        {entry.status !== 'resolved' && (
          <Button size="sm" icon={<CircleCheck size={14} />} disabled={submitting !== null} onClick={() => setStatus('resolved')}>
            {submitting === 'resolved' ? 'Saving…' : 'Mark Resolved'}
          </Button>
        )}
      </div>
    </div>
  );
}

function FeedbackQueue() {
  const [entries, setEntries] = useState<ProductFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('new');

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchAllProductFeedback();
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.message);
      setEntries([]);
      return;
    }
    setLoadError(null);
    setEntries(result.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: entries.length, new: 0, reviewed: 0, resolved: 0 };
    for (const e of entries) c[e.status]++;
    return c;
  }, [entries]);

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <Tabs items={FILTER_ORDER.map((key) => ({ key, label: FILTER_LABELS[key], count: counts[key] }))} active={filter} onChange={(k) => setFilter(k as FilterKey)} />

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} variant="block" className="h-32 w-full" />
          ))}
        </div>
      ) : loadError ? (
        <EmptyState icon={<CircleX size={26} strokeWidth={1.5} />} title="Couldn't load feedback" description={loadError} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<CircleCheck size={26} strokeWidth={1.5} />} title={`No ${filter === 'all' ? '' : FILTER_LABELS[filter].toLowerCase() + ' '}feedback`} description="Nothing to show in this view." />
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((e) => (
            <FeedbackCard key={e.id} entry={e} onUpdated={load} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminFeedbackPage() {
  return (
    <PageContainer title="Product Feedback" description="General feedback about Renewal IQ — bugs, ideas, and comments submitted from the Feedback button in the broker product.">
      <AdminAuthGate>
        <FeedbackQueue />
      </AdminAuthGate>
    </PageContainer>
  );
}
