import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, Building2, Search, Archive, ArrowLeft } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, EmptyState } from '../components/ui';
import { AccountCard } from '../components/dashboard/AccountCard';
import { HistoryDrawer } from '../components/history/HistoryDrawer';
import { useAccountsStore } from '../state/useAccountsStore';

export function DashboardPage() {
  const navigate = useNavigate();
  const accounts = useAccountsStore((s) => s.accounts);
  const activityLog = useAccountsStore((s) => s.activityLog);
  const ensureSampleAccount = useAccountsStore((s) => s.ensureSampleAccount);

  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [historyAccountId, setHistoryAccountId] = useState<string | null>(null);

  const archivedCount = useMemo(() => accounts.filter((a) => a.archived).length, [accounts]);

  const visible = useMemo(() => {
    return accounts
      .filter((a) => a.archived === showArchived)
      .filter((a) => a.namedInsured.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [accounts, showArchived, search]);

  const historyAccount = historyAccountId ? accounts.find((a) => a.id === historyAccountId) : null;

  return (
    <PageContainer
      title={showArchived ? 'Archived Submissions' : 'Submissions'}
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
      {accounts.length === 0 ? (
        <EmptyState
          icon={<Building2 size={28} strokeWidth={1.5} />}
          title="No submissions yet"
          description="Create your first account to start uploading documents and building a risk profile, or load the sample transportation account to explore Renewal IQ."
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
                  navigate(`/accounts/${id}/upload`);
                }}
              >
                Try Sample Account
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {!showArchived && (
            <div className="relative max-w-sm">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search submissions…"
                className="w-full rounded-lg border border-[var(--color-ink-200)] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
              />
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState
              icon={<Search size={24} strokeWidth={1.5} />}
              title={showArchived ? 'No archived submissions' : 'No matching submissions'}
              description={showArchived ? undefined : 'Try a different search term.'}
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
