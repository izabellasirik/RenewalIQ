import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Building2, ClipboardList, Clock, FileText, Hash, MapPin, CalendarDays, History, ArrowRight } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { AccountNotFound } from '../components/layout/AccountNotFound';
import { Badge, Card, CardBody, EmptyState, Tabs } from '../components/ui';
import { AccountInfoCard } from '../components/workspace/AccountInfoCard';
import { AccountStageSelect } from '../components/workspace/AccountStageSelect';
import { ContactsCard } from '../components/workspace/ContactsCard';
import { FollowUpsCard } from '../components/workspace/FollowUpsCard';
import { ChecklistPanel } from '../components/workspace/ChecklistPanel';
import { QuotesPanel } from '../components/workspace/QuotesPanel';
import { ActionList } from '../components/workspace/ActionList';
import { QUOTE_STATUS_TONE } from '../components/workspace/quoteStatus';
import { ActivityTimeline } from '../components/history/ActivityTimeline';
import { Dropzone } from '../components/upload/Dropzone';
import { DocumentList } from '../components/upload/DocumentList';
import { useAccountsStore } from '../state/useAccountsStore';
import { useAccountWorkflow } from '../hooks/useAccountWorkflow';
import { summarizeWaiting, type WorkspaceTab } from '../services/workflow/nextActions';
import { formatShortDate } from '../services/workflow/dates';
import { carriersFor, forwardedAt } from '../services/workflow/requirementKey';
import { QUOTE_STATUS_LABELS, WORKFLOW_EVENT_TYPES } from '../types';
import { EMPTY_ACTIVITY_EVENTS } from '../utils/emptyArrays';
import { AssignedAgent } from '../components/workspace/AssignedAgent';

const TABS: WorkspaceTab[] = ['overview', 'checklist', 'quotes', 'activity'];

/**
 * The Account Workspace — the broker's home for one account. Answers, at a glance: where does
 * this account stand, what are we waiting for, who are we waiting on, and what needs me next.
 * The detailed Risk Profile / Submission Assistant / Carrier Appetite pages are unchanged and
 * one click away in the sidebar.
 */
export function AccountWorkspacePage() {
  const { accountId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as WorkspaceTab | null;
  const tab: WorkspaceTab = tabParam && TABS.includes(tabParam) ? tabParam : 'overview';
  const focusQuoteId = params.get('quote') ?? undefined;

  const { account, profile, documents, items, quotes, effectiveDate, dotNumber, actions } = useAccountWorkflow(accountId);
  const ensureChecklist = useAccountsStore((s) => s.ensureChecklist);
  const cloudHydratedFor = useAccountsStore((s) => s.cloudHydratedFor);
  // Accounts from before new accounts got a checklist automatically get it the first time they're opened.
  useEffect(() => {
    ensureChecklist(accountId);
  }, [accountId, cloudHydratedFor, ensureChecklist]);
  const activity = useAccountsStore((s) => s.activityLog[accountId]) ?? EMPTY_ACTIVITY_EVENTS;
  const addFiles = useAccountsStore((s) => s.addFiles);
  const deleteDocument = useAccountsStore((s) => s.deleteDocument);
  const [showSystemEvents, setShowSystemEvents] = useState(false);

  const waiting = useMemo(() => summarizeWaiting(items, quotes), [items, quotes]);
  const workflowEvents = useMemo(() => activity.filter((e) => WORKFLOW_EVENT_TYPES.has(e.type)), [activity]);

  if (!account || !profile) return <AccountNotFound />;

  function setTab(next: WorkspaceTab) {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    p.delete('quote');
    setParams(p, { replace: true });
  }

  const openCarrierRequests = items.filter((i) => i.status !== 'waived' && carriersFor(i).some((q) => !forwardedAt(i, q))).length;

  return (
    <PageContainer>
      {/* Header — the "where does this account stand" strip */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/* Plain text — the name is changed from the Account card's Edit. */}
            <h1 className="truncate text-2xl font-semibold tracking-tight text-[var(--color-ink-900)]">{account.namedInsured}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-ink-600)]">
              <span className="inline-flex items-center gap-1">
                <Hash size={13} className="text-[var(--color-ink-400)]" />
                DOT <span className="font-semibold text-[var(--color-ink-900)]">{dotNumber || '—'}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin size={13} className="text-[var(--color-ink-400)]" />
                <span className="font-semibold text-[var(--color-ink-900)]">{account.state || '—'}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <CalendarDays size={13} className="text-[var(--color-ink-400)]" />
                Effective <span className="font-medium text-[var(--color-ink-900)]">{effectiveDate ? formatShortDate(effectiveDate) : '—'}</span>
              </span>
              <AssignedAgent account={account} />
            </div>
          </div>
          <AccountStageSelect accountId={accountId} />
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <StatusPill tone={waiting.onClient > 0 ? 'warning' : 'neutral'} label={waiting.onClient > 0 ? `Waiting on client · ${waiting.onClient} item${waiting.onClient === 1 ? '' : 's'}` : 'Nothing requested from client'} />
          <StatusPill
            tone={waiting.onCarriers.length > 0 ? 'info' : 'neutral'}
            label={waiting.onCarriers.length > 0 ? `Waiting on ${waiting.onCarriers.join(', ')}` : 'No carriers pending'}
          />
          {waiting.missing > 0 && <StatusPill tone="danger" label={`${waiting.missing} not yet requested`} />}
          {openCarrierRequests > 0 && <StatusPill tone="brand" label={`${openCarrierRequests} carrier request${openCarrierRequests === 1 ? '' : 's'} open`} />}
          {actions.now.length > 0 && <StatusPill tone="danger" label={`${actions.now.length} need${actions.now.length === 1 ? 's' : ''} attention`} />}
        </div>
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <Tabs
          items={[
            { key: 'overview', label: 'Overview', count: actions.now.length || undefined },
            { key: 'checklist', label: 'Checklist & Documents', count: waiting.missing + waiting.onClient || undefined },
            { key: 'quotes', label: 'Markets & Quotes', count: quotes.length || undefined },
            { key: 'activity', label: 'Activity' },
          ]}
          active={tab}
          onChange={(k) => setTab(k as WorkspaceTab)}
        />
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
            <Card>
              <CardBody className="pt-5">
                <h3 className="mb-3 text-sm font-semibold text-[var(--color-ink-900)]">Needs your attention</h3>
                <ActionList actions={actions.now} emptyText="Nothing needs you right now — every follow-up is scheduled and nothing is waiting to be sent." />
                {actions.upcoming.length > 0 && (
                  <>
                    <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Coming up</h4>
                    <ActionList actions={actions.upcoming} />
                  </>
                )}
              </CardBody>
            </Card>
            {/* Follow-ups right under "Needs your attention"; the checklist itself lives on its own tab. */}
            <FollowUpsCard accountId={accountId} />
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <AccountInfoCard accountId={accountId} />
            <ContactsCard accountId={accountId} />
            <Card>
              <CardBody className="pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
                    <Building2 size={16} className="text-[var(--color-ink-500)]" />
                    Markets
                  </h3>
                  <button onClick={() => setTab('quotes')} className="text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
                    Manage →
                  </button>
                </div>
                {quotes.length === 0 ? (
                  <p className="mt-2 text-sm italic text-[var(--color-ink-400)]">No markets yet.</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {/* Most recently added market first — same order as the Markets & Quotes tab. */}
                    {[...quotes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).map((q) => (
                      <li key={q.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium text-[var(--color-ink-800)]">{q.marketName}</span>
                        <Badge tone={QUOTE_STATUS_TONE[q.status]} className="shrink-0 px-2 py-0.5 text-[11px]">
                          {q.status === 'quoted' && q.premium ? `$${q.premium.toLocaleString('en-US')}` : QUOTE_STATUS_LABELS[q.status]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardBody className="pt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
                    <History size={16} className="text-[var(--color-ink-500)]" />
                    Recent activity
                  </h3>
                  <button onClick={() => setTab('activity')} className="text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
                    All →
                  </button>
                </div>
                {workflowEvents.length === 0 ? (
                  <p className="text-sm italic text-[var(--color-ink-400)]">No activity yet.</p>
                ) : (
                  <ActivityTimeline events={[...workflowEvents].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 6)} />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardBody className="flex flex-col gap-1 pt-5 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Submission details</p>
                <Link to={`/accounts/${accountId}/risk-profile`} className="inline-flex items-center justify-between gap-2 rounded-md px-1 py-1 text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)]">
                  Risk Profile <ArrowRight size={13} />
                </Link>
                <Link to={`/accounts/${accountId}/submission-assistant`} className="inline-flex items-center justify-between gap-2 rounded-md px-1 py-1 text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)]">
                  Submission Assistant <ArrowRight size={13} />
                </Link>
                <Link to={`/accounts/${accountId}/carrier-appetite`} className="inline-flex items-center justify-between gap-2 rounded-md px-1 py-1 text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)]">
                  Carrier Appetite <ArrowRight size={13} />
                </Link>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === 'checklist' && (
        <div className="flex flex-col gap-5">
          <ChecklistPanel accountId={accountId} />
          <Card>
            <CardBody className="pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
                  <FileText size={16} className="text-[var(--color-ink-500)]" />
                  Uploaded documents
                  <span className="font-normal text-[var(--color-ink-500)]">({documents.length})</span>
                </h3>
                <Link to={`/accounts/${accountId}/upload`} className="text-xs font-medium text-[var(--color-brand-700)] hover:underline">
                  Open upload & extraction view →
                </Link>
              </div>
              <Dropzone onFiles={(files) => addFiles(accountId, files)} />
              <div className="mt-3">
                <DocumentList documents={documents} profile={profile} onDelete={(documentId) => deleteDocument(accountId, documentId)} />
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'quotes' && <QuotesPanel accountId={accountId} focusQuoteId={focusQuoteId} />}

      {tab === 'activity' && (
        <Card>
          <CardBody className="pt-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
                <Clock size={16} className="text-[var(--color-ink-500)]" />
                Account activity
              </h3>
              <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-600)]">
                <input type="checkbox" checked={showSystemEvents} onChange={(e) => setShowSystemEvents(e.target.checked)} />
                Show document & extraction events
              </label>
            </div>
            {(showSystemEvents ? activity : workflowEvents).length === 0 ? (
              <EmptyState icon={<ClipboardList size={24} strokeWidth={1.5} />} title="No activity yet" description="Requests, follow-ups, carrier updates, and quotes will show up here." />
            ) : (
              <ActivityTimeline events={showSystemEvents ? activity : workflowEvents} />
            )}
          </CardBody>
        </Card>
      )}
    </PageContainer>
  );
}

function StatusPill({ tone, label }: { tone: 'neutral' | 'warning' | 'info' | 'danger' | 'brand'; label: string }) {
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}
