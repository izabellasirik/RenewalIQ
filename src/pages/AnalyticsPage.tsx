import { useMemo, type ReactNode } from 'react';
import { FileStack, FileSearch, Gauge, Target, Compass } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../components/ui';
import { useAccountsStore } from '../state/useAccountsStore';
import { computeAnalytics, type RankedItem } from '../services/analytics/computeAnalytics';
import { VERDICT_LABELS, type Verdict } from '../types';

const VERDICT_TONE: Record<Verdict, string> = {
  likely_match: 'bg-[var(--color-success-500)]',
  possible_match: 'bg-[var(--color-info-500)]',
  needs_more_information: 'bg-[var(--color-warning-500)]',
  not_eligible: 'bg-[var(--color-danger-500)]',
};

function StatCard({ icon, label, value, caption }: { icon: ReactNode; label: string; value: string; caption?: string }) {
  return (
    <Card>
      <CardBody className="pt-5">
        <div className="flex items-center gap-2 text-[var(--color-ink-400)]">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className="mt-2 text-2xl font-semibold text-[var(--color-ink-900)]">{value}</p>
        {caption && <p className="mt-1 text-xs text-[var(--color-ink-400)]">{caption}</p>}
      </CardBody>
    </Card>
  );
}

function RankedList({ items, emptyLabel }: { items: RankedItem[]; emptyLabel: string }) {
  if (items.length === 0) return <p className="py-4 text-center text-sm text-[var(--color-ink-400)]">{emptyLabel}</p>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-sm text-[var(--color-ink-700)]">{item.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-ink-100)]">
            <div className="h-full rounded-full bg-[var(--color-brand-600)]" style={{ width: `${(item.count / max) * 100}%` }} />
          </div>
          <span className="w-6 shrink-0 text-right text-sm font-medium text-[var(--color-ink-800)]">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsPage() {
  const accounts = useAccountsStore((s) => s.accounts);
  const documents = useAccountsStore((s) => s.documents);
  const riskProfiles = useAccountsStore((s) => s.riskProfiles);
  const matchResults = useAccountsStore((s) => s.matchResults);
  const activityLog = useAccountsStore((s) => s.activityLog);

  const analytics = useMemo(
    () => computeAnalytics(accounts, documents, riskProfiles, matchResults, activityLog),
    [accounts, documents, riskProfiles, matchResults, activityLog]
  );

  const totalVerdicts = Object.values(analytics.verdictBreakdown).reduce((a, b) => a + b, 0);

  return (
    <PageContainer title="Analytics" description="Cross-submission insights across every account in this workspace.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={<FileStack size={16} />} label="Submissions" value={String(analytics.totalSubmissions)} caption={analytics.archivedSubmissions > 0 ? `${analytics.archivedSubmissions} archived` : undefined} />
        <StatCard icon={<FileSearch size={16} />} label="Fields Extracted" value={analytics.totalFieldsExtracted.toLocaleString('en-US')} caption={`from ${analytics.totalDocuments} document${analytics.totalDocuments === 1 ? '' : 's'}`} />
        <StatCard icon={<Gauge size={16} />} label="Average Extraction Confidence" value={analytics.averageConfidence !== null ? `${analytics.averageConfidence}%` : '—'} caption="High/medium/low weighted, manual entries excluded" />
        <StatCard
          icon={<Target size={16} />}
          label="Extraction Accuracy (proxy)"
          value={analytics.extractionAccuracy !== null ? `${analytics.extractionAccuracy}%` : '—'}
          caption={`${analytics.correctionsCount} broker correction${analytics.correctionsCount === 1 ? '' : 's'} — not a ground-truth benchmark`}
        />
        <StatCard icon={<Compass size={16} />} label="Carrier Matches Run" value={analytics.totalMatchesRun.toLocaleString('en-US')} caption={`across ${accounts.length} submission${accounts.length === 1 ? '' : 's'}`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Carrier Recommendation Breakdown</h3>
          </CardHeader>
          <CardBody className="pt-2">
            {totalVerdicts === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--color-ink-400)]">No matches run yet.</p>
            ) : (
              <>
                <div className="flex h-3 overflow-hidden rounded-full">
                  {(Object.keys(analytics.verdictBreakdown) as Verdict[]).map((v) => {
                    const count = analytics.verdictBreakdown[v];
                    if (count === 0) return null;
                    return <div key={v} className={VERDICT_TONE[v]} style={{ width: `${(count / totalVerdicts) * 100}%` }} />;
                  })}
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  {(Object.keys(analytics.verdictBreakdown) as Verdict[]).map((v) => (
                    <div key={v} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-[var(--color-ink-600)]">
                        <span className={`h-2 w-2 rounded-full ${VERDICT_TONE[v]}`} />
                        {VERDICT_LABELS[v]}
                      </span>
                      <span className="font-medium text-[var(--color-ink-800)]">{analytics.verdictBreakdown[v]}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Submissions by Status</h3>
          </CardHeader>
          <CardBody className="pt-2">
            <RankedList items={analytics.submissionsByStatus} emptyLabel="No submissions yet." />
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Top Recommended Markets</h3>
          </CardHeader>
          <CardBody className="pt-2">
            <RankedList items={analytics.topMarkets} emptyLabel="No strong matches yet." />
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Most Frequently Missing Fields</h3>
          </CardHeader>
          <CardBody className="pt-2">
            <RankedList items={analytics.missingFieldsRanked} emptyLabel="Nothing missing across submissions." />
          </CardBody>
        </Card>
      </div>
    </PageContainer>
  );
}
