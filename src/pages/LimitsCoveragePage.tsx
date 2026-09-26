import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { CoverageType } from '../types';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { AccountNotFound } from '../components/layout/AccountNotFound';
import { Button } from '../components/ui';
import { SectionCard } from '../components/riskProfile/SectionCard';
import { CoverageSection } from '../components/riskProfile/CoverageSection';
import { useAccountsStore } from '../state/useAccountsStore';

/**
 * Requested/current coverage limits — previously a tab buried inside Risk Profile, promoted to its
 * own workflow step (Risk Profile → Limits & Coverage → Submission Assistant) since it's a distinct
 * broker task, not a Risk Profile sub-view. Reuses CoverageSection and the exact same coverage
 * store actions Risk Profile's coverage tab used — the underlying RiskProfile.coverage model is
 * unchanged, this is only a different page to reach it from.
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
  const location = useLocation();
  const [highlightType, setHighlightType] = useState<CoverageType | null>(null);

  // Deep link from What's Missing: scroll to and briefly highlight one coverage line.
  useEffect(() => {
    const type = (location.state as { focusCoverage?: CoverageType } | null)?.focusCoverage;
    if (!type) return;
    setHighlightType(type);
    const scroll = setTimeout(() => document.getElementById(`coverage-${type}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    const clear = setTimeout(() => setHighlightType((cur) => (cur === type ? null : cur)), 2200);
    return () => {
      clearTimeout(scroll);
      clearTimeout(clear);
    };
  }, [location.state]);

  if (!account || !profile) {
    return <AccountNotFound />;
  }

  return (
    <PageContainer title={`Limits & Coverage — ${account.namedInsured}`} description="Expiring limits vs. Requested limits">
      <SectionCard title="Coverage">
        <CoverageSection
          coverage={profile.coverage}
          highlightType={highlightType}
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
        <Button icon={<ArrowRight size={15} />} onClick={() => navigate(`/accounts/${accountId}/submission-assistant`)}>
          Continue to Submission Assistant
        </Button>
      </div>
    </PageContainer>
  );
}
