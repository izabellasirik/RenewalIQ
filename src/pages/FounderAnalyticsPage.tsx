import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Loader2, Lock, RotateCcw } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Modal } from '../components/ui';
import { AiUsageSection } from '../components/founder/AiUsageSection';
import { checkIsFounder, fetchFounderSnapshot, setAccountAnalyticsMode } from '../services/productAnalytics/founderRepo';
import { FEATURES, FUNNEL_STAGES, FounderView, type FeatureKey, type FounderFilters, type FounderSnapshot } from '../services/productAnalytics/founderMetrics';
import { WORKFLOW_LABELS, TIME_SAVED_OPTIONS } from '../services/productAnalytics/timeSaved';
import { formatDate } from '../utils/dates';

const RANGES = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
] as const;

const selectClass = 'rounded-lg border border-[var(--color-ink-200)] bg-white px-2.5 py-1.5 text-sm text-[var(--color-ink-800)] outline-none focus:border-[var(--color-brand-500)]';
const th = 'border-b border-[var(--color-ink-100)] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]';
const td = 'border-b border-[var(--color-ink-50)] px-3 py-2 align-top text-sm text-[var(--color-ink-800)]';

function endOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}
const when = (iso: string | null | undefined) => (iso ? formatDate(iso) : '—');
const minutes = (m: number | null) => (m === null ? '—' : m >= 60 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);

/**
 * Founder Analytics — who is really using Renewal IQ, on which real accounts, which features, and
 * whether they come back. Only the founder sees the link; the database refuses the data to anyone
 * else (founder_analytics_snapshot, 0043), so the URL alone shows nothing.
 */
export function FounderAnalyticsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    checkIsFounder().then((ok) => !cancelled && setAllowed(ok));
    return () => {
      cancelled = true;
    };
  }, []);

  if (allowed === null) {
    return (
      <PageContainer title="Founder Analytics">
        <p className="flex items-center gap-2 text-sm text-[var(--color-ink-500)]">
          <Loader2 size={15} className="animate-spin" /> Checking access…
        </p>
      </PageContainer>
    );
  }
  if (!allowed) {
    return (
      <PageContainer title="Founder Analytics">
        <EmptyState icon={<Lock size={24} strokeWidth={1.5} />} title="Not available" description="This page is only available to the Renewal IQ founder account." />
      </PageContainer>
    );
  }
  return <FounderDashboard />;
}

function FounderDashboard() {
  const [rangeKey, setRangeKey] = useState<string>('30');
  const [orgId, setOrgId] = useState('');
  const [userId, setUserId] = useState('');
  const [feature, setFeature] = useState<FeatureKey | ''>('');
  const [accounts, setAccounts] = useState<FounderFilters['accounts']>('real');
  const [includeFounder, setIncludeFounder] = useState(false);
  const [snapshot, setSnapshot] = useState<FounderSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [brokerOpen, setBrokerOpen] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState<string | null>(null);

  const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 30;
  const to = useMemo(() => endOfToday(), []);
  const from = useMemo(() => new Date(to.getTime() - days * 86400000), [to, days]);

  const load = useCallback(async () => {
    setLoading(true);
    // Two extra weeks before the range, so "last week" and "returning" work for short ranges too.
    const res = await fetchFounderSnapshot(new Date(from.getTime() - 14 * 86400000), to);
    setLoading(false);
    if (!res.ok) return setError(res.message);
    setError(null);
    setSnapshot(res.data);
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  const view = useMemo(
    () => (snapshot ? new FounderView(snapshot, { from, to, orgId: orgId || undefined, userId: userId || undefined, feature: feature || undefined, accounts, includeFounder }) : null),
    [snapshot, from, to, orgId, userId, feature, accounts, includeFounder]
  );

  return (
    <PageContainer
      title="Founder Analytics"
      description="Who uses Renewal IQ, on which real accounts, which features — and whether they come back."
      actions={
        <Button variant="secondary" icon={loading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2" data-testid="founder-filters">
        <select className={selectClass} value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} aria-label="Date range">
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <select className={selectClass} value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Brokerage">
          <option value="">All brokerages</option>
          {(snapshot?.orgs ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select className={selectClass} value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Broker">
          <option value="">All brokers</option>
          {(snapshot?.users ?? []).filter((u) => includeFounder || !u.isFounder).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select className={selectClass} value={feature} onChange={(e) => setFeature(e.target.value as FeatureKey | '')} aria-label="Feature">
          <option value="">All features</option>
          {FEATURES.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <select className={selectClass} value={accounts} onChange={(e) => setAccounts(e.target.value as FounderFilters['accounts'])} aria-label="Accounts">
          <option value="real">Real accounts</option>
          <option value="test">Test / Demo accounts</option>
          <option value="all">Real + Test</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-[var(--color-ink-600)]">
          <input type="checkbox" checked={includeFounder} onChange={(e) => setIncludeFounder(e.target.checked)} /> Include my own activity
        </label>
      </div>

      <AiUsageSection />

      {error && <p className="rounded-lg border border-[var(--color-danger-300)] bg-[var(--color-danger-100)]/40 px-4 py-3 text-sm text-[var(--color-danger-700)]">{error}</p>}
      {snapshot?.truncated && <p className="text-xs text-[var(--color-warning-600)]">More than 50,000 events in this range — showing the first 50,000. Narrow the date range.</p>}
      {!view && !error && <p className="flex items-center gap-2 text-sm text-[var(--color-ink-500)]"><Loader2 size={15} className="animate-spin" /> Loading…</p>}
      {view && <Dashboard view={view} onBroker={setBrokerOpen} onAccount={setAccountOpen} />}

      {view && brokerOpen && <BrokerDetail view={view} userId={brokerOpen} onClose={() => setBrokerOpen(null)} onAccount={(a) => (setBrokerOpen(null), setAccountOpen(a))} />}
      {view && accountOpen && (
        <AccountDetail
          view={view}
          accountId={accountOpen}
          onClose={() => setAccountOpen(null)}
          onModeChanged={async () => {
            await load();
          }}
        />
      )}
    </PageContainer>
  );
}

/** Agency members and invitations: who has started using Renewal IQ, and who hasn't yet. */
function AdoptionCard({ view }: { view: FounderView }) {
  const a = view.adoption();
  return (
    <Card data-testid="founder-adoption">
      <CardHeader className="pb-2">
        <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Broker adoption</h3>
        <p className="text-xs text-[var(--color-ink-500)]">Agency members who have done at least one real action ever, and the people who haven’t started yet. Your own account is never counted.</p>
      </CardHeader>
      <CardBody className="flex flex-col gap-3 pt-0">
        {!a.complete && <p className="text-xs text-[var(--color-warning-600)]">Run migration 0047 to list members and invitations with no activity — until then only brokers with activity are known.</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Agency members" value={a.eligibleMembers} testId="adoption-members" />
          <Stat label="Activated" value={a.activatedMembers} hint="at least one real action" testId="adoption-activated" />
          <Stat label="Invited, not joined" value={a.invitations.length} testId="adoption-invited" />
          <Stat label="Signed up, no agency" value={a.unaffiliatedSignups} hint="never active" testId="adoption-unaffiliated" />
        </div>
        {(a.notActivated.length > 0 || a.invitations.length > 0) && (
          <ul className="flex flex-col divide-y divide-[var(--color-ink-50)] text-sm" data-testid="adoption-not-active">
            {a.notActivated.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-[var(--color-ink-800)]">{m.name}</span>
                  <span className="block text-xs text-[var(--color-ink-500)]">
                    {m.brokerage}
                    {m.role === 'admin' ? ' · Admin' : ''}
                  </span>
                </span>
                <span className="text-xs text-[var(--color-ink-500)]">Joined {when(m.joinedAt)} · no activity yet</span>
              </li>
            ))}
            {a.invitations.map((i) => (
              <li key={`${i.orgId}:${i.email}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-[var(--color-ink-800)]">{i.email}</span>
                  <span className="block text-xs text-[var(--color-ink-500)]">{i.brokerage}</span>
                </span>
                <span className="text-xs text-[var(--color-ink-500)]">
                  Invited {when(i.createdAt)} · {i.status === 'expired' ? 'invitation expired' : 'not accepted yet'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({ label, value, hint, testId }: { label: string; value: string | number; hint?: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white px-4 py-3 [box-shadow:var(--shadow-card)]" data-testid={testId}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--color-ink-900)]">{value}</p>
      {hint && <p className="text-xs text-[var(--color-ink-500)]">{hint}</p>}
    </div>
  );
}

function Dashboard({ view, onBroker, onAccount }: { view: FounderView; onBroker: (id: string) => void; onAccount: (id: string) => void }) {
  const k = view.kpis();
  const r = view.retention();
  const funnel = view.funnel();
  const brokers = view.brokers();
  const accountsWorked = view.accountsWorked();
  const features = view.featureUsage();
  const timeSaved = view.timeSaved();

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="founder-kpis">
        <Stat label="Active brokerages" value={k.activeBrokerages} testId="kpi-brokerages" />
        <Stat label="Active brokers" value={k.activeBrokers} testId="kpi-brokers" />
        <Stat label="Weekly active accounts" value={k.weeklyActiveAccounts} hint={`last week: ${k.weeklyActiveAccountsLastWeek}`} testId="kpi-waa" />
        <Stat label="New real accounts" value={k.newRealAccounts} testId="kpi-new-accounts" />
        <Stat label="Weekly active brokers" value={k.weeklyActiveBrokers} hint="a real action in the last 7 days" testId="kpi-weekly-brokers" />
        <Stat label="Returning brokers" value={k.returningBrokers} hint="active this week and the week before" testId="kpi-returning" />
        <Stat label="Market Finder accounts" value={k.marketFinderAccounts} hint={`${k.marketFinderSearches} account-free searches`} testId="kpi-market-finder" />
        <Stat label="Applications reviewed / downloaded" value={`${k.applicationsReviewed} / ${k.applicationsDownloaded}`} hint="accounts" testId="kpi-applications" />
        <Stat label="Markets added" value={k.marketsAdded} testId="kpi-markets" />
        <Stat label="Quotes added" value={k.quotesAdded} testId="kpi-quotes" />
        <Stat label="Follow-ups completed" value={k.followUpsCompleted} testId="kpi-followups" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Workflow funnel</h3>
            <p className="text-xs text-[var(--color-ink-500)]">Real accounts created or imported in this range, and how far each has got.</p>
          </CardHeader>
          <CardBody className="flex flex-col gap-2 pt-1" data-testid="founder-funnel">
            {funnel.map((s) => (
              <div key={s.label}>
                <div className="flex justify-between text-xs text-[var(--color-ink-700)]">
                  <span>{s.label}</span>
                  <span className="font-medium">
                    {s.accounts} · {s.percent}%
                  </span>
                </div>
                <div className="mt-0.5 h-2 rounded-full bg-[var(--color-ink-100)]">
                  <div className="h-2 rounded-full bg-[var(--color-brand-700)]" style={{ width: `${s.percent}%` }} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Retention</h3>
            <p className="text-xs text-[var(--color-ink-500)]">This week = the last 7 days of the range; last week = the 7 days before.</p>
          </CardHeader>
          <CardBody className="grid grid-cols-2 gap-3 pt-1" data-testid="founder-retention">
            <Stat label="Brokers active this week" value={r.brokersThisWeek} />
            <Stat label="…also active last week" value={r.brokersAlsoLastWeek} hint={`${r.returningPercent}% returning`} />
            <Stat label="Accounts worked on 2+ days" value={r.accountsMultipleDays} hint={`of ${r.accountsWorked}`} />
            <Stat label="Accounts worked in 2+ weeks" value={r.accountsMultipleWeeks} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Brokers</h3>
          <p className="text-xs text-[var(--color-ink-500)]">
            Only real work counts as activity — re-opening an account doesn’t, and neither do test/demo accounts. “This week” is the last 7 days of the range; returning = active this week
            and the 7 days before.
          </p>
        </CardHeader>
        <CardBody className="pt-0">
          {brokers.length === 0 ? (
            <p className="py-4 text-sm text-[var(--color-ink-500)]">No broker activity in this range.</p>
          ) : (
            <>
              {/* Phones: one card per broker. */}
              <ul className="flex flex-col gap-2 md:hidden" data-testid="founder-brokers-cards">
                {brokers.map((b) => (
                  <li key={b.userId}>
                    <button onClick={() => onBroker(b.userId)} className="w-full cursor-pointer rounded-lg border border-[var(--color-ink-100)] p-3 text-left">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[var(--color-brand-800)]">{b.name}</span>
                          <span className="block truncate text-xs text-[var(--color-ink-500)]">{b.brokerage}</span>
                        </span>
                        {b.returningFromPreviousWeek ? <Badge tone="success">Returning</Badge> : b.activeThisWeek ? <Badge tone="info">Active this week</Badge> : null}
                      </span>
                      <span className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--color-ink-600)]">
                        <span>
                          <span className="block font-semibold text-[var(--color-ink-900)]">{b.activeDays}</span>active days
                        </span>
                        <span>
                          <span className="block font-semibold text-[var(--color-ink-900)]">{b.daysActiveThisWeek}</span>this week
                        </span>
                        <span>
                          <span className="block font-semibold text-[var(--color-ink-900)]">{b.realAccounts}</span>accounts
                        </span>
                      </span>
                      <span className="mt-2 block text-xs text-[var(--color-ink-500)]">
                        First {when(b.firstActivity)} · Last {when(b.lastActivity)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full border-collapse" data-testid="founder-brokers">
                  <thead>
                    <tr>
                      {['Broker', 'Brokerage', 'Real accounts', 'Active days', 'Days this week', 'Returning', 'First activity', 'Last activity', 'Main features used'].map((h) => (
                        <th key={h} className={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {brokers.map((b) => (
                      <tr key={b.userId} className="cursor-pointer hover:bg-[var(--color-ink-50)]" onClick={() => onBroker(b.userId)}>
                        <td className={td}>
                          <span className="font-medium text-[var(--color-brand-800)] hover:underline">{b.name}</span>
                          {b.email && b.email !== b.name && <span className="block text-xs text-[var(--color-ink-400)]">{b.email}</span>}
                        </td>
                        <td className={td}>{b.brokerage}</td>
                        <td className={td}>{b.realAccounts}</td>
                        <td className={td}>{b.activeDays}</td>
                        <td className={td}>{b.daysActiveThisWeek || <span className="text-[var(--color-ink-400)]">—</span>}</td>
                        <td className={td} data-testid="broker-returning">
                          {b.returningFromPreviousWeek ? (
                            <Badge tone="success">Yes</Badge>
                          ) : b.activeThisWeek ? (
                            <span className="text-xs text-[var(--color-ink-500)]">New this week</span>
                          ) : (
                            <span className="text-xs text-[var(--color-ink-400)]">Not active this week</span>
                          )}
                        </td>
                        <td className={td}>{when(b.firstActivity)}</td>
                        <td className={td}>{when(b.lastActivity)}</td>
                        <td className={td}>{b.mainFeatures.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <AdoptionCard view={view} />

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Accounts worked</h3>
        </CardHeader>
        <CardBody className="overflow-x-auto pt-0">
          {accountsWorked.length === 0 ? (
            <p className="py-4 text-sm text-[var(--color-ink-500)]">No account activity in this range.</p>
          ) : (
            <table className="min-w-full border-collapse" data-testid="founder-accounts">
              <thead>
                <tr>
                  {['Account', 'Brokerage', 'Broker', 'Furthest stage', 'Last active'].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accountsWorked.slice(0, 100).map((a) => (
                  <tr key={a.accountId} className="cursor-pointer hover:bg-[var(--color-ink-50)]" onClick={() => onAccount(a.accountId)}>
                    <td className={td}>
                      <span className="font-medium text-[var(--color-brand-800)] hover:underline">{a.name}</span> {a.isTest && <Badge tone="warning">Test/Demo</Badge>}
                    </td>
                    <td className={td}>{a.brokerage}</td>
                    <td className={td}>{a.brokers.join(', ')}</td>
                    <td className={td}>{a.stage}</td>
                    <td className={td}>{when(a.lastActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Feature usage</h3>
            <p className="text-xs text-[var(--color-ink-500)]">People, accounts and brokerages — not clicks. Repeat users used it on 2+ days.</p>
          </CardHeader>
          <CardBody className="overflow-x-auto pt-0">
            <table className="min-w-full border-collapse" data-testid="founder-features">
              <thead>
                <tr>
                  {['Feature', 'Unique brokers', 'Real accounts', 'Brokerages', 'Repeat users'].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.key}>
                    <td className={td}>{f.label}</td>
                    <td className={td}>{f.uniqueBrokers}</td>
                    <td className={td}>{f.realAccounts}</td>
                    <td className={td}>{f.brokerages}</td>
                    <td className={td}>{f.repeatUsers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Time saved (estimates)</h3>
            <p className="text-xs text-[var(--color-ink-500)]">
              Brokers' own estimates of the normal time (answer midpoints; “60+” counted as 75 min). Renewal IQ time only where it was measured in one sitting. Not exact.
            </p>
          </CardHeader>
          <CardBody className="overflow-x-auto pt-0">
            <table className="min-w-full border-collapse" data-testid="founder-time-saved">
              <thead>
                <tr>
                  {['Workflow', 'Responses', 'Normal (median)', 'With RQ (median)', 'Saved (median)'].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timeSaved.map((w) => (
                  <tr key={w.workflow}>
                    <td className={td}>
                      {WORKFLOW_LABELS[w.workflow]}
                      {w.responses > 0 && (
                        <span className="block text-xs text-[var(--color-ink-400)]">
                          {TIME_SAVED_OPTIONS.filter((o) => w.byAnswer[o.value]).map((o) => `${o.label}: ${w.byAnswer[o.value]}`).join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      {w.responses}
                      {w.skipped > 0 && <span className="text-xs text-[var(--color-ink-400)]"> ({w.skipped} skipped)</span>}
                    </td>
                    <td className={td}>{minutes(w.medianNormalMinutes)}</td>
                    <td className={td}>
                      {minutes(w.medianRqMinutes)}
                      {w.measuredCount > 0 && <span className="text-xs text-[var(--color-ink-400)]"> (n={w.measuredCount})</span>}
                    </td>
                    <td className={td}>{w.medianSavedMinutes == null ? minutes(null) : `~${minutes(w.medianSavedMinutes)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      <p className="text-xs text-[var(--color-ink-500)]">
        Weekly active account = a real account with at least one workflow action in the last 7 days (re-opening alone doesn't count; ten actions = one account). Test/Demo
        accounts (marked, built-in sample, sample documents, or named test/demo/sample) and your own activity are excluded unless you choose otherwise above.
      </p>
    </div>
  );
}

function Timeline({ items, view, showUser }: { items: ReturnType<FounderView['accountDetail']>['timeline']; view: FounderView; showUser?: boolean }) {
  if (!items.length) return <p className="text-sm text-[var(--color-ink-500)]">No activity.</p>;
  return (
    <ol className="flex flex-col gap-1.5" data-testid="founder-timeline">
      {items.map((t, i) => (
        <li key={`${t.at}-${i}`} className="flex gap-3 text-sm">
          <span className="w-20 shrink-0 text-[var(--color-ink-500)]">{formatDate(t.at)}</span>
          <span className="text-[var(--color-ink-800)]">
            {t.label}
            {showUser && t.userId && <span className="text-[var(--color-ink-400)]"> · {view.userName(t.userId)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function BrokerDetail({ view, userId, onClose, onAccount }: { view: FounderView; userId: string; onClose: () => void; onAccount: (id: string) => void }) {
  const d = view.brokerDetail(userId);
  return (
    <Modal open onClose={onClose} title={d.name} subtitle={`${d.brokerage}${d.email ? ` · ${d.email}` : ''}`} size="lg">
      <div className="flex flex-col gap-4" data-testid="founder-broker-detail">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="First active" value={when(d.firstActive)} />
          <Stat label="Last active" value={when(d.lastActive)} />
          <Stat label="Active days" value={d.activeDays} />
          <Stat label="Active weeks" value={d.activeWeeks} />
          <Stat label="Real accounts worked" value={d.realAccounts.length} />
          <Stat label="Meaningful actions" value={d.actions} />
          <Stat label="Returned the following week" value={d.returnedFollowingWeek ? 'Yes' : 'No'} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Features used</p>
          <p className="text-sm text-[var(--color-ink-800)]">{d.features.map((f) => f.label).join(', ') || '—'}</p>
        </div>
        {d.realAccounts.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Accounts</p>
            <div className="flex flex-wrap gap-1.5">
              {d.realAccounts.map((a) => (
                <button key={a} onClick={() => onAccount(a)} className="rounded-full border border-[var(--color-ink-200)] px-2.5 py-1 text-xs text-[var(--color-brand-800)] hover:bg-[var(--color-ink-50)] cursor-pointer">
                  {view.accountName(a)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Recent activity</p>
          <Timeline items={d.timeline} view={view} />
        </div>
      </div>
    </Modal>
  );
}

function AccountDetail({ view, accountId, onClose, onModeChanged }: { view: FounderView; accountId: string; onClose: () => void; onModeChanged: () => Promise<void> }) {
  const d = view.accountDetail(accountId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function setMode(mode: 'auto' | 'real' | 'test') {
    setBusy(true);
    setError(null);
    const res = await setAccountAnalyticsMode(accountId, mode);
    setBusy(false);
    if (!res.ok) return setError(res.message ?? 'Could not change it.');
    await onModeChanged();
  }
  return (
    <Modal open onClose={onClose} title={d.name} subtitle={`${d.brokerage} · ${d.brokers.join(', ') || '—'}`} size="lg">
      <div className="flex flex-col gap-4" data-testid="founder-account-detail">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Activity size={14} className="text-[var(--color-ink-400)]" />
          <span>
            {d.activeDays} active day{d.activeDays === 1 ? '' : 's'} · furthest stage: {FUNNEL_STAGES[Math.max(0, d.stageReached)].label}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {d.isTest ? <Badge tone="warning">Test/Demo{d.flag ? '' : ' (auto)'}</Badge> : <Badge tone="success">Real{d.flag ? '' : ' (auto)'}</Badge>}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setMode(d.isTest ? 'real' : 'test')} data-testid="toggle-test">
              Mark as {d.isTest ? 'Real' : 'Test/Demo'}
            </Button>
            {d.flag && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setMode('auto')}>
                Use automatic
              </Button>
            )}
          </span>
        </div>
        {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
        <Timeline items={d.timeline} view={view} showUser />
      </div>
    </Modal>
  );
}
