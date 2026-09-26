import { BarChart3 } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Card, CardBody } from '../components/ui';

const TOPICS = ['Renewals', 'Account activity', 'Broker workload', 'Carrier performance', 'Accounts that need attention'];

/**
 * V1: Analytics is "coming soon". The full dashboard (AnalyticsPage + services/analytics) is kept
 * in the codebase — just not routed — so it can be switched back on later.
 */
export function AnalyticsComingSoonPage() {
  return (
    <PageContainer title="Analytics">
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-brand-800)]/10 text-[var(--color-brand-800)]">
            <BarChart3 size={20} />
          </span>
          <p className="text-lg font-semibold text-[var(--color-ink-900)]">Coming Soon</p>
          <p className="text-sm text-[var(--color-ink-500)]">Agency-level insights on:</p>
          <ul className="flex flex-col gap-1 text-sm text-[var(--color-ink-700)]">
            {TOPICS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </PageContainer>
  );
}
