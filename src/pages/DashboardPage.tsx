import { useMemo, useState } from 'react';
import { accountsEmptyState } from '../services/workflow/accountsEmptyState';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, Building2, Search, Archive, ArrowLeft } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, EmptyState } from '../components/ui';
import { AccountCard } from '../components/dashboard/AccountCard';
import { HistoryDrawer } from '../components/history/HistoryDrawer';
import { LocalImportPrompt } from '../components/dashboard/LocalImportPrompt';
import { selectCanManageArchive, useAccountsStore } from '../state/useAccountsStore';
import { effectiveAccountStage } from '../services/workflow/accountStage';
import { normalizeDateKey, todayKey } from '../services/workflow/dates';
import { renewalLabelOn } from '../services/workflow/renewals';
import { BOUND_FILTERS, RENEWAL_FILTERS, boundRange, latestBoundIn, renewalFilterDate, type BoundFilter, type RenewalFilter } from '../services/workflow/accountFilters';
import { ACCOUNT_STAGE_LABELS, ACCOUNT_STAGE_ORDER, type AccountStage } from '../types';
import { useCancelledPolicies } from '../hooks/usePolicyCancellations';
import { ALL_BROKERS, UNASSIGNED, matchesBroker } from '../services/workflow/brokerFilter';
import { useRememberedView } from '../hooks/useRememberedView';
import { aBoolean, aString, defined, oneOf } from '../services/preferences/viewPreferences';

/** The Accounts filters remembered between visits (per user, on this device). Search and the archived view aren't remembered. */
interface AccountsView {
  /** A status, or 'renewal_label': accounts showing the Renewal label (whatever their status). */
  stage: AccountStage | 'all' | 'renewal_label';
  broker: string;
  /** Renewals: being worked now ("due"), or with a renewal date in the next 30 / 60 / 90 days — see accountFilters.ts. */
  renewals: RenewalFilter;
  /** "Bound in": markets bound in the last 7 days, this or last month, or between two dates. */
  bound: BoundFilter;
  boundFrom: string;
  boundTo: string;
}
const ACCOUNTS_VIEW_DEFAULTS: AccountsView = { stage: 'all', broker: ALL_BROKERS, renewals: 'any', bound: 'any', boundFrom: '', boundTo: '' };
const aDate = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const sanitizeAccountsView = (saved: Record<string, unknown>): Partial<AccountsView> =>
  defined<AccountsView>({
    stage: oneOf(['all', 'renewal_label', ...ACCOUNT_STAGE_ORDER] as const)(saved.stage),
    broker: aString(saved.broker),
    // The earlier on/off "Renewal within 45 days" / "Upcoming renewals" choice still applies.
    renewals: oneOf(RENEWAL_FILTERS)(saved.renewals) ?? (aBoolean(saved.renewalSoon) ? 'due' : undefined),
    bound: oneOf(BOUND_FILTERS)(saved.bound),
    boundFrom: aDate(saved.boundFrom),
    boundTo: aDate(saved.boundTo),
  });
const RENEWAL_FILTER_LABELS: Record<RenewalFilter, string> = { any: 'All renewal dates', due: 'Upcoming renewals (work started)', '30': 'Renewal in the next 30 days', '60': 'Renewal in the next 60 days', '90': 'Renewal in the next 90 days' };
const BOUND_FILTER_LABELS: Record<BoundFilter, string> = { any: 'Bound: any time', last_7_days: 'Bound in the last 7 days', this_month: 'Bound this month', last_month: 'Bound last month', custom: 'Bound between dates…' };
const filterClass =
  'cursor-pointer rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

export function DashboardPage() {
  const navigate = useNavigate();
  const accounts = useAccountsStore((s) => s.accounts);
  const activityLog = useAccountsStore((s) => s.activityLog);
  const canManageArchive = useAccountsStore(selectCanManageArchive);
  const ensureSampleAccount = useAccountsStore((s) => s.ensureSampleAccount);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const cloudAccountIds = useAccountsStore((s) => s.cloudAccountIds);
  const dismissedImportIds = useAccountsStore((s) => s.dismissedImportIds);

  const localOnlyAccounts = useMemo(
    () => (currentUserId ? accounts.filter((a) => !a.archived && !cloudAccountIds[a.id] && !dismissedImportIds[a.id]) : []),
    [accounts, currentUserId, cloudAccountIds, dismissedImportIds]
  );

  const missingItems = useAccountsStore((s) => s.missingItems);
  const quotes = useAccountsStore((s) => s.quotes);
  const riskProfiles = useAccountsStore((s) => s.riskProfiles);
  const [search, setSearch] = useState('');
  const [view, updateView, resetView] = useRememberedView('accounts', ACCOUNTS_VIEW_DEFAULTS, sanitizeAccountsView);
  const stageFilter = view.stage;
  const setStageFilter = (stage: AccountsView['stage']) => updateView({ stage });
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const agencyMembers = useAccountsStore((s) => s.agencyMembers);
  // In an agency, "who has this account" is the database assignment (a user id), so an admin filters
  // by agent; an agent only ever has their own accounts, so there's nothing to filter.
  const byAgent = agencyAccess?.role === 'admin';
  const showBrokerFilter = !agencyAccess || byAgent;
  const renewalFilter = view.renewals;
  const boundFilter = view.bound;
  const [showArchived, setShowArchived] = useState(false);
  const [historyAccountId, setHistoryAccountId] = useState<string | null>(null);

  const archivedCount = useMemo(() => accounts.filter((a) => a.archived).length, [accounts]);

  // Accounts showing the Renewal label (automatic or switched on by hand) — see renewalLabelOn.
  const renewalLabelOf = useMemo(() => {
    const today = todayKey();
    const map: Record<string, boolean> = {};
    for (const a of accounts) map[a.id] = renewalLabelOn(a, normalizeDateKey((riskProfiles[a.id]?.business?.effectiveDate?.value as string | null | undefined) ?? null), quotes[a.id] ?? [], today).on;
    return map;
  }, [accounts, riskProfiles, quotes]);

  const cancelledFor = useCancelledPolicies();
  const stageOf = useMemo(() => {
    const map: Record<string, AccountStage> = {};
    for (const a of accounts) map[a.id] = effectiveAccountStage(a, missingItems[a.id] ?? [], quotes[a.id] ?? [], cancelledFor(a.id)).stage;
    return map;
  }, [accounts, missingItems, quotes, cancelledFor]);

  // Brokers are keyed by name (case-insensitive) — the lightweight assignment model has no broker directory.
  const brokerOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const a of accounts) if (a.assignedBroker?.name) names.set(a.assignedBroker.name.trim().toLowerCase(), a.assignedBroker.name.trim());
    return [...names.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [accounts]);

  // A remembered broker who isn't on the list any more (left the agency, renamed) shows everyone instead.
  const brokerFilter =
    view.broker === ALL_BROKERS || view.broker === UNASSIGNED || (byAgent ? agencyMembers.some((m) => m.userId === view.broker) : brokerOptions.some(([key]) => key === view.broker))
      ? view.broker
      : ALL_BROKERS;
  const setBrokerFilter = (broker: string) => updateView({ broker });

  // Each account's renewal date under each renewal choice (see accountFilters.ts), for the filter, its counts and the sort.
  const renewalDates = useMemo(() => {
    const today = todayKey();
    const map: Record<RenewalFilter, Record<string, string>> = { any: {}, due: {}, '30': {}, '60': {}, '90': {} };
    for (const a of accounts) {
      const eff = normalizeDateKey((riskProfiles[a.id]?.business?.effectiveDate?.value as string | null | undefined) ?? null);
      for (const f of RENEWAL_FILTERS) {
        const d = renewalFilterDate(a, eff, quotes[a.id] ?? [], f, today);
        if (d) map[f][a.id] = d;
      }
    }
    return map;
  }, [accounts, riskProfiles, quotes]);
  const renewalCount = (f: RenewalFilter) => accounts.filter((a) => a.archived === showArchived && renewalDates[f][a.id] !== undefined).length;
  const range = useMemo(() => boundRange(boundFilter, todayKey(), { from: view.boundFrom || undefined, to: view.boundTo || undefined }), [boundFilter, view.boundFrom, view.boundTo]);
  const boundOn = useMemo(() => {
    const map: Record<string, string> = {};
    if (!range) return map;
    for (const a of accounts) {
      const d = latestBoundIn(quotes[a.id] ?? [], range);
      if (d) map[a.id] = d;
    }
    return map;
  }, [accounts, quotes, range]);

  // Archived view: when each was archived (its latest "archived" activity; else its last update).
  const archivedAt = useMemo(() => {
    const at: Record<string, string> = {};
    if (!showArchived) return at;
    for (const a of accounts) {
      if (!a.archived) continue;
      const last = (activityLog[a.id] ?? []).reduce((m, e) => (e.type === 'account_archived' && e.timestamp > m ? e.timestamp : m), '');
      at[a.id] = last || a.updatedAt;
    }
    return at;
  }, [accounts, activityLog, showArchived]);

  const visible = useMemo(() => {
    return accounts
      .filter((a) => a.archived === showArchived)
      .filter((a) => a.namedInsured.toLowerCase().includes(search.toLowerCase()))
      .filter((a) => stageFilter === 'all' || (stageFilter === 'renewal_label' ? renewalLabelOf[a.id] : stageOf[a.id] === stageFilter))
      // An agent's accounts: assigned to them, or ones they collaborate on (see matchesBroker).
      .filter((a) => matchesBroker(a, brokerFilter, { byAgent }))
      .filter((a) => renewalFilter === 'any' || renewalDates[renewalFilter][a.id] !== undefined)
      .filter((a) => !range || boundOn[a.id] !== undefined)
      // Renewal filter on: soonest renewal first; "Bound in": most recently bound first. Archived: most recently
      // archived first. Otherwise most recently updated first.
      .sort((a, b) =>
        renewalFilter !== 'any'
          ? renewalDates[renewalFilter][a.id].localeCompare(renewalDates[renewalFilter][b.id])
          : range
            ? boundOn[b.id].localeCompare(boundOn[a.id])
            : showArchived
              ? (archivedAt[b.id] ?? '').localeCompare(archivedAt[a.id] ?? '')
              : a.updatedAt < b.updatedAt ? 1 : -1
      );
  }, [accounts, showArchived, search, stageFilter, brokerFilter, stageOf, renewalLabelOf, renewalFilter, renewalDates, range, boundOn, byAgent, archivedAt]);

  const renewalLabelCount = accounts.filter((a) => a.archived === showArchived && renewalLabelOf[a.id]).length;
  const stageCounts = useMemo(() => {
    const counts: Partial<Record<AccountStage, number>> = {};
    for (const a of accounts) if (a.archived === showArchived) counts[stageOf[a.id]] = (counts[stageOf[a.id]] ?? 0) + 1;
    return counts;
  }, [accounts, showArchived, stageOf]);
  const filtersActive = stageFilter !== 'all' || brokerFilter !== ALL_BROKERS || renewalFilter !== 'any' || boundFilter !== 'any';
  const clearAll = () => {
    setSearch('');
    resetView();
  };
  // Empty archive vs. archived accounts all hidden by the search or the filters (they apply in both views).
  const empty = accountsEmptyState({ showArchived, inView: accounts.filter((a) => a.archived === showArchived).length, searching: !!search.trim(), filtersActive });

  const historyAccount = historyAccountId ? accounts.find((a) => a.id === historyAccountId) : null;

  return (
    <PageContainer
      title={showArchived ? 'Archived Accounts' : 'Accounts'}
      description={
        showArchived
          ? canManageArchive
            ? 'Restore an archived account, or delete it permanently.'
            : 'Accounts you archived. Your agency admin can restore them.'
          : byAgent
            ? `Every account in ${agencyAccess?.agencyName ?? 'your agency'}, across all agents.`
            : "Every account and renewal you're working, in one place."
      }
      actions={
        showArchived ? (
          <Button variant="secondary" icon={<ArrowLeft size={15} />} onClick={() => setShowArchived(false)}>
            Back to Submissions
          </Button>
        ) : (
          <>
            {archivedCount > 0 && (
              <Button variant="secondary" icon={<Archive size={15} />} onClick={() => setShowArchived(true)}>
                Archived ({archivedCount})
              </Button>
            )}
            <Button icon={<Plus size={16} />} onClick={() => navigate('/accounts/new')}>
              New Submission
            </Button>
          </>
        )
      }
    >
      {!showArchived && <LocalImportPrompt accounts={localOnlyAccounts} />}
      {accounts.length === 0 ? (
        <EmptyState
          icon={<Building2 size={28} strokeWidth={1.5} />}
          title="No submissions yet"
          description="Create your first account to start uploading documents and building a risk profile, or load the sample transportation account to explore RenewalIQ."
          action={
            <div className="mt-2 flex items-center gap-2">
              <Button icon={<Plus size={16} />} onClick={() => navigate('/accounts/new')}>
                New Submission
              </Button>
              <Button
                variant="secondary"
                icon={<Sparkles size={16} />}
                onClick={() => {
                  const id = ensureSampleAccount();
                  navigate(`/accounts/${id}`);
                }}
              >
                Try Sample Account
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {(
              <div className="relative w-full sm:max-w-sm">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={showArchived ? 'Search archived accounts…' : 'Search accounts…'}
                  className="w-full rounded-lg border border-[var(--color-ink-200)] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
                />
              </div>
            )}
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as AccountsView['stage'])} className={filterClass} aria-label="Filter by status">
              <option value="all">All statuses</option>
              <option value="renewal_label">Renewal ({renewalLabelCount})</option>
              <option disabled>──────────</option>
              {ACCOUNT_STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {ACCOUNT_STAGE_LABELS[s]} ({stageCounts[s] ?? 0})
                </option>
              ))}
            </select>
            {showBrokerFilter && (
              <select value={brokerFilter} onChange={(e) => setBrokerFilter(e.target.value)} className={filterClass} aria-label={byAgent ? 'Filter by agent' : 'Filter by assigned agent'}>
                <option value={ALL_BROKERS}>All agents</option>
                {byAgent
                  ? agencyMembers.map((m) => {
                      const shown = accounts.filter((a) => a.archived === showArchived);
                      const assigned = shown.filter((a) => a.assignedUserId === m.userId).length;
                      const helping = shown.filter((a) => a.assignedUserId !== m.userId && (a.collaboratorIds ?? []).includes(m.userId)).length;
                      return (
                        <option key={m.userId} value={m.userId}>
                          {m.name} ({assigned + helping}
                          {helping ? `, incl. ${helping} collaborating` : ''})
                        </option>
                      );
                    })
                  : brokerOptions.map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                <option value={UNASSIGNED}>Unassigned</option>
              </select>
            )}
            <select value={renewalFilter} onChange={(e) => updateView({ renewals: e.target.value as RenewalFilter })} className={filterClass} aria-label="Filter by renewal" title="Upcoming renewals: from the start-working date until bound (overdue ones stay). Or: renewal date in the next 30, 60 or 90 days.">
              {RENEWAL_FILTERS.map((f) => (
                <option key={f} value={f}>
                  {RENEWAL_FILTER_LABELS[f]}
                  {f === 'any' ? '' : ` (${renewalCount(f)})`}
                </option>
              ))}
            </select>
            <select value={boundFilter} onChange={(e) => updateView({ bound: e.target.value as BoundFilter })} className={filterClass} aria-label="Filter by bound date">
              {BOUND_FILTERS.map((f) => (
                <option key={f} value={f}>
                  {BOUND_FILTER_LABELS[f]}
                </option>
              ))}
            </select>
            {boundFilter === 'custom' && (
              <span className="inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-600)]">
                <input type="date" value={view.boundFrom} onChange={(e) => updateView({ boundFrom: e.target.value })} className={filterClass} aria-label="Bound from" />
                to
                <input type="date" value={view.boundTo} onChange={(e) => updateView({ boundTo: e.target.value })} className={filterClass} aria-label="Bound to" />
              </span>
            )}
            {(filtersActive || search) && (
              <button
                onClick={clearAll}
                className="text-sm font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer"
              >
                Clear search and filters
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<Search size={24} strokeWidth={1.5} />}
              title={empty.title}
              action={
                empty.hiddenByFilters ? (
                  <Button size="sm" variant="secondary" onClick={clearAll}>
                    Clear search and filters
                  </Button>
                ) : undefined
              }
              description={showArchived ? undefined : renewalFilter === 'due' ? 'No renewals to work on right now. A renewal shows here from its start-working date (45 days before, unless changed) until it’s bound.' : range ? 'No markets were bound in these dates. A market’s bound date is set when it’s marked Bound (and can be changed on the market).' : 'Try a different search term or clear the filters.'}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((account, i) => (
                <AccountCard key={account.id} account={account} index={i} onOpenHistory={() => setHistoryAccountId(account.id)} archivedAt={archivedAt[account.id]} />
              ))}
            </div>
          )}
        </>
      )}

      <HistoryDrawer
        open={!!historyAccount}
        onClose={() => setHistoryAccountId(null)}
        accountName={historyAccount?.namedInsured ?? ''}
        events={historyAccount ? (activityLog[historyAccount.id] ?? []) : []}
      />
    </PageContainer>
  );
}
