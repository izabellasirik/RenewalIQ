import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { PageContainer } from '../layout/PageContainer';
import { EmptyState, Skeleton } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { commissionsAccess } from '../../services/commissions/access';

// Loaded only when an admin opens Commissions, so brokers' browsers never fetch it in normal use.
const CommissionsPage = lazy(() => import('../../pages/CommissionsPage').then((m) => ({ default: m.CommissionsPage })));

/**
 * /commissions: switched off unless enabled (see commissionsFeatureEnabled) and agency admins only.
 * Everyone else gets no figures at all — not even the sample.
 */
export function CommissionsRoute() {
  const access = useAccountsStore((s) => commissionsAccess(s.agencyAccess));
  if (access === 'feature-off') return <Navigate to="/" replace />;
  if (access !== 'allowed') {
    return (
      <PageContainer title="Commissions">
        <div data-testid="commissions-denied">
          <EmptyState
            icon={<Lock size={28} />}
            title="Commissions are available to agency admins only"
            description={access === 'no-agency' ? 'Commissions belong to an agency. Join or set up your agency to use them.' : 'Ask your agency admin if you need commission figures.'}
          />
        </div>
      </PageContainer>
    );
  }
  return (
    <Suspense
      fallback={
        <PageContainer title="Commissions">
          <Skeleton className="h-28 w-full" />
        </PageContainer>
      }
    >
      <CommissionsPage />
    </Suspense>
  );
}
