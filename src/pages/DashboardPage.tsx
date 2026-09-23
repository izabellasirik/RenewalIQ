import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, Building2, Search, Archive, ArrowLeft, CalendarClock } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, EmptyState } from '../components/ui';
import { AccountCard } from '../components/dashboard/AccountCard';
import { HistoryDrawer } from '../components/history/HistoryDrawer';
import { LocalImportPrompt } from '../components/dashboard/LocalImportPrompt';
import { useAccountsStore } from '../state/useAccountsStore';
import { cn } from '../utils/cn';
import { effectiveAccountStage } from '../services/workflow/accountStage';
import { daysBetween, normalizeDateKey, todayKey } from '../services/workflow/dates';
import { RENEWAL_WINDOW_DAYS } from '../services/workflow/nextActions';
import { ACCOUNT_STAGE_LABELS, ACCOUNT_STAGE_ORDER, type AccountStage } from '../types';

const ALL_BROKERS = '__all__';
const UNASSIGNED = '__unassigned__';
const filterClass =
  'cursor-pointer rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

export function DashboardPage() {
  const navigate = useNavigate();
  const accounts = useAccountsStore((s) => s.accounts);
  const activityLog = useAccountsStore((s) => s.activityLog);
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
  const [stageFilter, setStageFilter] = useState<AccountStage | 'all'>('all');
  const [brokerFilter, setBrokerFilter] = useState<string>(ALL_BROKERS);
  const [renewalSoon, setRenewalSoon] = useState(false);
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

  // Days until each account's renewal/effective date (Risk Profile → Requested Effective Date); absent when unknown.
  const daysToRenewal = useMemo(() => {
    const today = todayKey();
    const map: Record<string, number> = {};
    for (const a of accounts) {
      const eff = normalizeDateKey((riskProfiles[a.id]?.business?.effectiveDate?.value as string | null | undefined) ?? null);
      if (eff) map[a.id] = daysBetween(today, eff);
    }
    return map;
  }, [accounts, riskProfiles]);
  const renewsSoon = (id: string) => daysToRenewal[id] !== undefined && daysToRenewal[id] >= 0 && daysToRenewal[id] <= RENEWAL_WINDOW_DAYS;
  const renewalSoonCount = accounts.filter((a) => a.archived === showArchived && renewsSoon(a.id)).length;

  const visible = useMemo(() => {
    return accounts
      .filter((a) => a.archived === showArchived)
      .filter((a) => a.namedInsured.toLowerCase().includes(search.toLowerCase()))
      .filter((a) => stageFilter === 'all' || stageOf[a.id] === stageFilter)
      .filter((a) =>
        brokerFilter === ALL_BROKERS ? true : brokerFilter === UNASSIGNED ? !a.assignedBroker?.name : a.assignedBroker?.name?.trim().toLowerCase() === brokerFilter
      )
      .filter((a) => !renewalSoon || (daysToRenewal[a.id] !== undefined && daysToRenewal[a.id] >= 0 && daysToRenewal[a.id] <= RENEWAL_WINDOW_DAYS))
      // Renewal filter on: soonest renewal first. Otherwise most recently updated first.
      .sort((a, b) => (renewalSoon ? daysToRenewal[a.id] - daysToRenewal[b.id] : a.updatedAt < b.updatedAt ? 1 : -1));
  }, [accounts, showArchived, search, stageFilter, brokerFilter, stageOf, renewalSoon, daysToRenewal]);

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
      description={showArchived ? 'Restore an archived submission or remove it for good.' : "Every account and renewal you're working, in one place."}
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
            <select value={brokerFilter} onChange={(e) => setBrokerFilter(e.target.value)} className={filterClass} aria-label="Filter by assigned broker">
              <option value={ALL_BROKERS}>All brokers</option>
              {brokerOptions.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
              <option value={UNASSIGNED}>Unassigned</option>
            </select>
            <button
              type="button"
              onClick={() => setRenewalSoon((v) => !v)}
              aria-pressed={renewalSoon}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm cursor-pointer',
                renewalSoon
                  ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)] font-medium text-[var(--color-brand-800)]'
                  : 'border-[var(--color-ink-200)] bg-white text-[var(--color-ink-700)] hover:bg-[var(--color-ink-50)]'
              )}
            >
              <CalendarClock size={14} />
              Renewal within {RENEWAL_WINDOW_DAYS} days ({renewalSoonCount})
            </button>
            {filtersActive && (
              <button
                onClick={() => {
                  setStageFilter('all');
                  setBrokerFilter(ALL_BROKERS);
                  setRenewalSoon(false);
                }}
                className="text-sm font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer"
              >
                Clear filters
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<Search size={24} strokeWidth={1.5} />}
              title={showArchived ? 'No archived submissions' : 'No matching accounts'}
              description={showArchived ? undefined : renewalSoon ? `No accounts renew in the next ${RENEWAL_WINDOW_DAYS} days. An account shows here once its Risk Profile has a Requested Effective Date.` : 'Try a different search term or clear the filters.'}
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
