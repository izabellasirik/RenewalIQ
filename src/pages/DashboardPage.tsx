import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, Building2, Search, Archive, ArrowLeft, CalendarClock } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, EmptyState } from '../components/ui';
import { AccountCard } from '../components/dashboard/AccountCard';
import { HistoryDrawer } from '../components/history/HistoryDrawer';
import { LocalImportPrompt } from '../components/dashboard/LocalImportPrompt';
import { selectCanManageArchive, useAccountsStore } from '../state/useAccountsStore';
import { cn } from '../utils/cn';
import { effectiveAccountStage } from '../services/workflow/accountStage';
import { normalizeDateKey, todayKey } from '../services/workflow/dates';
import { isRenewalDue, resolveRenewals } from '../services/workflow/renewals';
import { ACCOUNT_STAGE_LABELS, ACCOUNT_STAGE_ORDER, type AccountStage } from '../types';
import { ALL_BROKERS, UNASSIGNED, matchesBroker } from '../services/workflow/brokerFilter';
import { useRememberedView } from '../hooks/useRememberedView';
import { aBoolean, aString, defined, oneOf } from '../services/preferences/viewPreferences';

/** The Accounts filters remembered between visits (per user, on this device). Search and the archived view aren't remembered. */
interface AccountsView {
  stage: AccountStage | 'all';
  broker: string;
  /** "Upcoming renewals" (the key is kept from the earlier "Renewal within 45 days", so a saved choice still applies). */
  renewalSoon: boolean;
}
const ACCOUNTS_VIEW_DEFAULTS: AccountsView = { stage: 'all', broker: ALL_BROKERS, renewalSoon: false };
const sanitizeAccountsView = (saved: Record<string, unknown>): Partial<AccountsView> =>
  defined<AccountsView>({ stage: oneOf(['all', ...ACCOUNT_STAGE_ORDER] as const)(saved.stage), broker: aString(saved.broker), renewalSoon: aBoolean(saved.renewalSoon) });
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
  const setStageFilter = (stage: AccountStage | 'all') => updateView({ stage });
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const agencyMembers = useAccountsStore((s) => s.agencyMembers);
  // In an agency, "who has this account" is the database assignment (a user id), so an admin filters
  // by agent; an agent only ever has their own accounts, so there's nothing to filter.
  const byAgent = agencyAccess?.role === 'admin';
  const showBrokerFilter = !agencyAccess || byAgent;
  const renewalSoon = view.renewalSoon;
  const [showArchived, setShowArchived] = useState(false);
  const [historyAccountId, setHistoryAccountId] = useState<string | null>(null);

  const archivedCount = useMemo(() => accounts.filter((a) => a.archived).length, [accounts]);

  const stageOf = useMemo(() => {
    const map: Record<string, AccountStage> = {};
    for (const a of accounts) map[a.id] = effectiveAccountStage(a, missingItems[a.id] ?? [], quotes[a.id] ?? []).stage;
    return map;
  }, [accounts, missingItems, quotes]);

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

  // Each account's soonest renewal that work has started on and that isn't bound (see renewals.ts) —
  // the same renewals Today's Plate reminds about. Absent when there's none.
  const dueRenewal = useMemo(() => {
    const today = todayKey();
    const map: Record<string, string> = {};
    for (const a of accounts) {
      const eff = normalizeDateKey((riskProfiles[a.id]?.business?.effectiveDate?.value as string | null | undefined) ?? null);
      const due = resolveRenewals(a, eff, quotes[a.id] ?? []).find((r) => isRenewalDue(r, today));
      if (due?.renewalDate) map[a.id] = due.renewalDate;
    }
    return map;
  }, [accounts, riskProfiles, quotes]);
  const renewsSoon = (id: string) => dueRenewal[id] !== undefined;
  const renewalSoonCount = accounts.filter((a) => a.archived === showArchived && renewsSoon(a.id)).length;

  const visible = useMemo(() => {
    return accounts
      .filter((a) => a.archived === showArchived)
      .filter((a) => a.namedInsured.toLowerCase().includes(search.toLowerCase()))
      .filter((a) => stageFilter === 'all' || stageOf[a.id] === stageFilter)
      // An agent's accounts: assigned to them, or ones they collaborate on (see matchesBroker).
      .filter((a) => matchesBroker(a, brokerFilter, { byAgent }))
      .filter((a) => !renewalSoon || dueRenewal[a.id] !== undefined)
      // Renewal filter on: soonest renewal first. Otherwise most recently updated first.
      .sort((a, b) => (renewalSoon ? dueRenewal[a.id].localeCompare(dueRenewal[b.id]) : a.updatedAt < b.updatedAt ? 1 : -1));
  }, [accounts, showArchived, search, stageFilter, brokerFilter, stageOf, renewalSoon, dueRenewal, byAgent]);

  const stageCounts = useMemo(() => {
    const counts: Partial<Record<AccountStage, number>> = {};
    for (const a of accounts) if (a.archived === showArchived) counts[stageOf[a.id]] = (counts[stageOf[a.id]] ?? 0) + 1;
    return counts;
  }, [accounts, showArchived, stageOf]);
  const filtersActive = stageFilter !== 'all' || brokerFilter !== ALL_BROKERS || renewalSoon;

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
            {!showArchived && (
              <div className="relative w-full sm:max-w-sm">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search accounts…"
                  className="w-full rounded-lg border border-[var(--color-ink-200)] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
                />
              </div>
            )}
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as AccountStage | 'all')} className={filterClass} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {ACCOUNT_STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {ACCOUNT_STAGE_LABELS[s]} ({stageCounts[s] ?? 0})
                </option>
              ))}
            </select>
            {showBrokerFilter && (
              <select value={brokerFilter} onChange={(e) => setBrokerFilter(e.target.value)} className={filterClass} aria-label={byAgent ? 'Filter by agent' : 'Filter by assigned broker'}>
                <option value={ALL_BROKERS}>{byAgent ? 'All agents' : 'All brokers'}</option>
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
            <button
              type="button"
              onClick={() => updateView({ renewalSoon: !renewalSoon })}
              aria-pressed={renewalSoon}
              title="Renewals whose start-working date has come and that aren’t bound yet, soonest first"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm cursor-pointer',
                renewalSoon
                  ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)] font-medium text-[var(--color-brand-800)]'
                  : 'border-[var(--color-ink-200)] bg-white text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)]'
              )}
            >
              <CalendarClock size={14} />
              Upcoming renewals ({renewalSoonCount})
            </button>
            {filtersActive && (
              <button
                onClick={resetView}
                className="text-sm font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer"
              >
                Clear filters
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<Search size={24} strokeWidth={1.5} />}
              title={showArchived ? 'No archived accounts' : 'No matching accounts'}
              description={showArchived ? undefined : renewalSoon ? 'No renewals to work on right now. A renewal shows here from its start-working date (45 days before, unless changed) until it’s bound.' : 'Try a different search term or clear the filters.'}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((account, i) => (
                <AccountCard key={account.id} account={account} index={i} onOpenHistory={() => setHistoryAccountId(account.id)} />
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
