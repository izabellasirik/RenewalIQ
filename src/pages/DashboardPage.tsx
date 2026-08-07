import { useNavigate } from 'react-router-dom';
import { Plus, ArrowRight, Sparkles, Building2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Card, CardBody, EmptyState, Badge } from '../components/ui';
import { useAccountsStore } from '../state/useAccountsStore';
import { formatDate } from '../utils/dates';

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  documents_uploaded: 'Documents Uploaded',
  profile_in_review: 'Profile In Review',
  ready_for_market: 'Ready for Market',
};

export function DashboardPage() {
  const navigate = useNavigate();
  const accounts = useAccountsStore((s) => s.accounts);
  const documents = useAccountsStore((s) => s.documents);
  const matchResults = useAccountsStore((s) => s.matchResults);
  const ensureSampleAccount = useAccountsStore((s) => s.ensureSampleAccount);

  return (
    <PageContainer
      title="Submissions"
      description="Every account and renewal you're working, in one place."
      actions={
        <Button
          icon={<Plus size={16} />}
          onClick={() => navigate('/accounts/new')}
        >
          New Submission
        </Button>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account, i) => {
            const docs = documents[account.id] ?? [];
            const matches = matchResults[account.id] ?? [];
            const strongMatches = matches.filter((m) => m.verdict === 'strong_match').length;
            return (
              <motion.div
                key={account.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.25 }}
              >
                <Card
                  className="group cursor-pointer transition-shadow hover:[box-shadow:var(--shadow-card-hover)]"
                  onClick={() => navigate(`/accounts/${account.id}/risk-profile`)}
                >
                  <CardBody className="pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-[var(--color-ink-900)]">{account.namedInsured}</p>
                        <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{account.state} · Commercial Auto</p>
                      </div>
                      <Badge tone="neutral">{STATUS_LABELS[account.status]}</Badge>
                    </div>

                    <div className="mt-4 flex items-center gap-4 text-xs text-[var(--color-ink-500)]">
                      <span>{docs.length} document{docs.length === 1 ? '' : 's'}</span>
                      {matches.length > 0 && (
                        <span>
                          {strongMatches} strong match{strongMatches === 1 ? '' : 'es'}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-[var(--color-ink-100)] pt-3 text-xs">
                      <span className="text-[var(--color-ink-400)]">Updated {formatDate(account.updatedAt)}</span>
                      <span className="flex items-center gap-1 font-medium text-[var(--color-brand-700)] opacity-0 transition-opacity group-hover:opacity-100">
                        Open <ArrowRight size={13} />
                      </span>
                    </div>
                  </CardBody>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
