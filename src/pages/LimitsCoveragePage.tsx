import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { AccountNotFound } from '../components/layout/AccountNotFound';
import { Button } from '../components/ui';
import { SectionCard } from '../components/riskProfile/SectionCard';
import { CoverageSection } from '../components/riskProfile/CoverageSection';
import { useAccountsStore } from '../state/useAccountsStore';

/**
 * Requested/current coverage limits — previously a tab buried inside Risk Profile, promoted to its
 * own workflow step (Risk Profile → Limits & Coverage → Review) since it's a distinct broker task,
 * not a Risk Profile sub-view. Reuses CoverageSection and the exact same coverage store actions
 * Risk Profile's coverage tab used — the underlying RiskProfile.coverage model is unchanged, this
 * is only a different page to reach it from.
 */
export function LimitsCoveragePage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const updateCoverage = useAccountsStore((s) => s.updateCoverage);
  const resolveCoverageConflict = useAccountsStore((s) => s.resolveCoverageConflict);
  const addCoverageLine = useAccountsStore((s) => s.addCoverageLine);
  const deleteCoverageLine = useAccountsStore((s) => s.deleteCoverageLine);

  if (!account || !profile) {
    return <AccountNotFound />;
  }

  return (
    <PageContainer title={`Limits & Coverage — ${account.namedInsured}`} description="Expiring limits (from loss run) vs. requested limits (from application).">
      <SectionCard title="Coverage">
        <CoverageSection
          coverage={profile.coverage}
          onSave={(coverageType, field, value) => updateCoverage(accountId, coverageType, field, value)}
          onResolve={(coverageType, field, resolution) => resolveCoverageConflict(accountId, coverageType, field, resolution)}
          onAdd={(coverageType) => addCoverageLine(accountId, coverageType)}
          onDelete={(coverageType) => deleteCoverageLine(accountId, coverageType)}
        />
      </SectionCard>

      <div className="flex justify-between">
        <Button variant="secondary" icon={<ArrowLeft size={15} />} onClick={() => navigate(`/accounts/${accountId}/risk-profile`)}>
          Back to Risk Profile
        </Button>
        <Button icon={<ArrowRight size={15} />} onClick={() => navigate(`/accounts/${accountId}/review`)}>
          Continue to Review
        </Button>
      </div>
    </PageContainer>
  );
}
