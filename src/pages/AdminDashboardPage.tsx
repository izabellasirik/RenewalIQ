import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, CircleHelp, CircleCheck, CircleX, ArrowRight, MessageSquare } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Card, CardBody, EmptyState, Skeleton, Button, Badge } from '../components/ui';
import { AdminAuthGate } from '../components/admin/AdminAuthGate';
import { AppetiteUpdateStatusBadge } from '../components/admin/statusBadge';
import { FeedbackStatusBadge } from '../components/admin/feedbackStatusBadge';
import { fetchAllAppetiteUpdateRequests } from '../services/appetiteUpdates/appetiteUpdateService';
import { fetchAllProductFeedback } from '../services/feedback/feedbackService';
import type { AppetiteUpdateRequest, AppetiteUpdateStatus, FeedbackStatus, ProductFeedback } from '../types';
import { APPETITE_FIELD_KEY_LABELS, FEEDBACK_TYPE_LABELS } from '../types';
import { formatDate } from '../utils/dates';

const RECENT_COUNT = 8;

interface StatDef<S extends string> {
  status: S;
  label: string;
  icon: typeof Inbox;
  iconClass: string;
}

const STATS: StatDef<AppetiteUpdateStatus>[] = [
  { status: 'pending', label: 'Pending', icon: Inbox, iconClass: 'text-[var(--color-info-600)]' },
  { status: 'needs_more_information', label: 'Needs More Info', icon: CircleHelp, iconClass: 'text-[var(--color-warning-600)]' },
  { status: 'approved', label: 'Approved', icon: CircleCheck, iconClass: 'text-[var(--color-success-600)]' },
  { status: 'rejected', label: 'Rejected', icon: CircleX, iconClass: 'text-[var(--color-danger-600)]' },
];

const FEEDBACK_STATS: StatDef<FeedbackStatus>[] = [
  { status: 'new', label: 'New', icon: Inbox, iconClass: 'text-[var(--color-info-600)]' },
  { status: 'reviewed', label: 'Reviewed', icon: CircleHelp, iconClass: 'text-[var(--color-warning-600)]' },
  { status: 'resolved', label: 'Resolved', icon: CircleCheck, iconClass: 'text-[var(--color-success-600)]' },
];

function DashboardContent() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<AppetiteUpdateRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllAppetiteUpdateRequests().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setRequests(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return <EmptyState icon={<CircleX size={26} strokeWidth={1.5} />} title="Couldn't load appetite update requests" description={loadError} />;
  }

  if (!requests) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="block" className="h-24 w-full" />
          ))}
        </div>
        <Skeleton variant="block" className="h-64 w-full" />
      </div>
    );
  }

  const counts: Record<AppetiteUpdateStatus, number> = { pending: 0, needs_more_information: 0, approved: 0, rejected: 0 };
  for (const r of requests) counts[r.status]++;
  const recent = requests.slice(0, RECENT_COUNT);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink-900)]">Appetite Update Requests</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {STATS.map((s) => (
            <Card key={s.status}>
              <CardBody className="flex flex-col gap-2">
                <s.icon size={18} className={s.iconClass} />
                <p className="text-2xl font-semibold text-[var(--color-ink-900)]">{counts[s.status]}</p>
                <p className="text-xs font-medium text-[var(--color-ink-500)]">{s.label}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-ink-900)]">Recent Requests</h2>
          <Button variant="secondary" size="sm" icon={<ArrowRight size={14} />} onClick={() => navigate('/admin/appetite-updates')}>
            View all requests
          </Button>
        </div>

        {recent.length === 0 ? (
          <EmptyState icon={<Inbox size={24} strokeWidth={1.5} />} title="No appetite update requests yet" description="Broker-submitted corrections from Market Finder / Carrier Appetite will show up here." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--color-ink-100)] bg-white">
            <div className="hidden grid-cols-[1.4fr_1fr_1fr_0.8fr_0.9fr] gap-3 border-b border-[var(--color-ink-100)] bg-[var(--color-ink-50)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)] sm:grid">
              <span>Market / Program</span>
              <span>Field</span>
              <span>Submitted By</span>
              <span>Date</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-[var(--color-ink-100)]">
              {recent.map((r) => (
                <div key={r.id} className="grid grid-cols-1 gap-1 px-4 py-3 text-sm sm:grid-cols-[1.4fr_1fr_1fr_0.8fr_0.9fr] sm:items-center sm:gap-3">
                  <span className="truncate font-medium text-[var(--color-ink-800)]">{r.marketName}</span>
                  <span className="text-[var(--color-ink-600)]">{APPETITE_FIELD_KEY_LABELS[r.fieldKey] ?? r.fieldKey}</span>
                  <span className="truncate text-[var(--color-ink-600)]">{r.submitterName}</span>
                  <span className="text-xs text-[var(--color-ink-400)]">{formatDate(r.createdAt)}</span>
                  <span>
                    <AppetiteUpdateStatusBadge status={r.status} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FeedbackSummary() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ProductFeedback[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllProductFeedback().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setEntries(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink-900)]">Product Feedback</h2>
        <EmptyState icon={<CircleX size={26} strokeWidth={1.5} />} title="Couldn't load product feedback" description={loadError} />
      </div>
    );
  }

  if (!entries) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="block" className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const counts: Record<FeedbackStatus, number> = { new: 0, reviewed: 0, resolved: 0 };
  for (const e of entries) counts[e.status]++;
  const recent = entries.slice(0, RECENT_COUNT);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--color-ink-900)]">Product Feedback</h2>
        <Button variant="secondary" size="sm" icon={<ArrowRight size={14} />} onClick={() => navigate('/admin/feedback')}>
          View all feedback
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4">
        {FEEDBACK_STATS.map((s) => (
          <Card key={s.status}>
            <CardBody className="flex flex-col gap-2">
              <s.icon size={18} className={s.iconClass} />
              <p className="text-2xl font-semibold text-[var(--color-ink-900)]">{counts[s.status]}</p>
              <p className="text-xs font-medium text-[var(--color-ink-500)]">{s.label}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {recent.length === 0 ? (
        <EmptyState icon={<MessageSquare size={24} strokeWidth={1.5} />} title="No feedback yet" description="General feedback submitted from the Feedback button in the broker product will show up here." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--color-ink-100)] bg-white">
          <div className="divide-y divide-[var(--color-ink-100)]">
            {recent.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Badge tone="neutral">{FEEDBACK_TYPE_LABELS[e.feedbackType]}</Badge>
                    <FeedbackStatusBadge status={e.status} />
                  </div>
                  <p className="truncate text-[var(--color-ink-700)]">{e.message}</p>
                </div>
                <span className="shrink-0 text-xs text-[var(--color-ink-400)]">{formatDate(e.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminDashboardPage() {
  return (
    <PageContainer title="Admin Dashboard" description="Where broker-submitted appetite update requests and general product feedback are reviewed.">
      <AdminAuthGate>
        <div className="flex flex-col gap-10">
          <DashboardContent />
          <FeedbackSummary />
        </div>
      </AdminAuthGate>
    </PageContainer>
  );
}
