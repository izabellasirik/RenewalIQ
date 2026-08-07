import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageContainer } from '../components/layout/PageContainer';
import { Tabs, EmptyState, Button } from '../components/ui';
import { MarketCard } from '../components/appetite/MarketCard';
import { MarketDetailDrawer } from '../components/appetite/MarketDetailDrawer';
import { useAccountsStore } from '../state/useAccountsStore';
import { sampleAppetiteRecords } from '../data/carriers';
import type { MatchResult, Verdict } from '../types';
import { VERDICT_LABELS } from '../types';
import { Compass } from 'lucide-react';

type FilterKey = 'all' | Verdict;

export function CarrierAppetitePage() {
  const { accountId = '' } = useParams();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const matchResults = useAccountsStore((s) => s.matchResults[accountId] ?? []);
  const runMatching = useAccountsStore((s) => s.runMatching);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<MatchResult | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { strong_match: 0, possible_match: 0, verify: 0, not_eligible: 0 };
    for (const r of matchResults) c[r.verdict]++;
    return c;
  }, [matchResults]);

  const filtered = filter === 'all' ? matchResults : matchResults.filter((r) => r.verdict === filter);
  const selectedRecord = selected ? sampleAppetiteRecords.find((r) => r.id === selected.appetiteRecordId) ?? null : null;

  if (!account || !profile) {
    return (
      <PageContainer title="Account not found">
        <p className="text-sm text-[var(--color-ink-500)]">This submission doesn't exist yet.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={`Carrier Appetite — ${account.namedInsured}`}
      description="Matched against direct carriers and MGAs using the current risk profile. Always verify with the market before quoting."
      actions={
        matchResults.length === 0 ? (
          <Button icon={<Compass size={15} />} onClick={() => runMatching(accountId)}>
            Run Appetite Match
          </Button>
        ) : undefined
      }
    >
      {matchResults.length === 0 ? (
        <EmptyState
          icon={<Compass size={28} strokeWidth={1.5} />}
          title="No appetite results yet"
          description="Run the matching engine against this account's risk profile to see which of the sample markets fit."
          action={
            <Button icon={<Compass size={15} />} onClick={() => runMatching(accountId)}>
              Run Appetite Match
            </Button>
          }
        />
      ) : (
        <>
          <Tabs
            items={[
              { key: 'all', label: 'All Markets', count: matchResults.length },
              { key: 'strong_match', label: VERDICT_LABELS.strong_match, count: counts.strong_match },
              { key: 'possible_match', label: VERDICT_LABELS.possible_match, count: counts.possible_match },
              { key: 'verify', label: VERDICT_LABELS.verify, count: counts.verify },
              { key: 'not_eligible', label: VERDICT_LABELS.not_eligible, count: counts.not_eligible },
            ]}
            active={filter}
            onChange={(k) => setFilter(k as FilterKey)}
          />

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((result) => (
              <MarketCard
                key={result.appetiteRecordId}
                result={result}
                onClick={() => {
                  setSelected(result);
                  setDrawerOpen(true);
                }}
              />
            ))}
          </div>
        </>
      )}

      <MarketDetailDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} record={selectedRecord} result={selected} />
    </PageContainer>
  );
}
