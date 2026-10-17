import { useEffect, useMemo, useState } from 'react';
import { dayKey, trackEvent } from '../services/productAnalytics/trackEvent';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PageContainer } from '../components/layout/PageContainer';
import { AccountNotFound } from '../components/layout/AccountNotFound';
import { Tabs, EmptyState, Button } from '../components/ui';
import { MarketCard } from '../components/appetite/MarketCard';
import { MarketCardSkeleton } from '../components/appetite/MarketCardSkeleton';
import { MarketDetailDrawer } from '../components/appetite/MarketDetailDrawer';
import { AddToQuotesAction } from '../components/appetite/AddToQuotesAction';
import { CarrierDrawer, carrierRowFor, type Row as CarrierRow } from './CarriersPage';
import { useAccountsStore } from '../state/useAccountsStore';
import type { MatchResult, Verdict } from '../types';
import { VERDICT_LABELS } from '../types';
import { VERDICT_RANK } from '../services/appetite/matchingEngine';
import { EMPTY_DOCUMENTS, EMPTY_MATCH_RESULTS } from '../utils/emptyArrays';
import { Compass, Search, Info } from 'lucide-react';

type FilterKey = 'all' | Verdict;

export function CarrierAppetitePage() {
  const { accountId = '' } = useParams();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const documents = useAccountsStore((s) => s.documents[accountId]) ?? EMPTY_DOCUMENTS;
  const matchResults = useAccountsStore((s) => s.matchResults[accountId]) ?? EMPTY_MATCH_RESULTS;
  const runMatching = useAccountsStore((s) => s.runMatching);
  const effectiveAppetiteRecords = useAccountsStore((s) => s.effectiveAppetiteRecords);
  const loadEffectiveAppetiteRecords = useAccountsStore((s) => s.loadEffectiveAppetiteRecords);
  useEffect(() => {
    loadEffectiveAppetiteRecords();
  }, [loadEffectiveAppetiteRecords]);
  // Possible Match is the main view — first tab and open by default.
  const [filter, setFilter] = useState<FilterKey>('possible_match');
  const [search, setSearch] = useState('');
  // By id, so the market shows its fresh verdict after an edit re-runs matching.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: MatchResult | null = matchResults.find((r) => r.appetiteRecordId === selectedId) ?? null;
  const setSelected = (r: MatchResult | null) => {
    setSelectedId(r?.appetiteRecordId ?? null);
    if (r) trackEvent('carrier_match_opened', { accountId, metadata: { source: 'carrier_appetite' }, dedupeKey: `match_opened:${accountId}:${r.appetiteRecordId}:${dayKey()}` });
  };
  // Founder Analytics: appetite results were produced for this account (once a day per account).
  const hasResults = matchResults.length > 0 && !!account;
  useEffect(() => {
    if (hasResults) trackEvent('carrier_appetite_generated', { accountId, dedupeKey: `appetite:${accountId}:${dayKey()}` });
  }, [accountId, hasResults]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Agency admins edit a market's appetite right here — the same form as Manage Carrier Appetite; the
  // database only accepts it from an admin (0023). Saving re-matches every account.
  const isAgencyAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const reloadCarrierAppetite = useAccountsStore((s) => s.reloadCarrierAppetite);
  const [editRow, setEditRow] = useState<CarrierRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editMarket = (recordId: string) => {
    const record = effectiveAppetiteRecords.find((r) => r.id === recordId);
    if (!record) return;
    setDrawerOpen(false);
    setEditRow(carrierRowFor(record, useAccountsStore.getState().agencyCarriers));
  };
  const isAnalyzing = matchResults.length === 0 && documents.some((d) => d.status === 'processing');

  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { likely_match: 0, possible_match: 0, needs_more_information: 0, not_eligible: 0 };
    for (const r of matchResults) c[r.verdict]++;
    return c;
  }, [matchResults]);

  const filtered = (filter === 'all' ? matchResults : matchResults.filter((r) => r.verdict === filter))
    .filter((r) => r.marketName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || b.matchScore - a.matchScore);
  const selectedRecord = selected ? effectiveAppetiteRecords.find((r) => r.id === selected.appetiteRecordId) ?? null : null;

  if (!account || !profile) {
    return <AccountNotFound />;
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
      {notice && <p className="mb-4 rounded-lg border border-[var(--color-ink-100)] bg-white px-3 py-2 text-sm text-[var(--color-ink-700)]" role="status">{notice}</p>}
      <p className="mb-5 flex items-start gap-1.5 text-xs text-[var(--color-ink-400)]">
        <Info size={13} className="mt-0.5 shrink-0" />
        Carrier appetite changes frequently. RenewalIQ recommendations are based on the latest information available and should be confirmed with the market before binding.
      </p>

      {isAnalyzing ? (
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm text-[var(--color-ink-500)]">
            <Compass size={15} className="animate-spin text-[var(--color-brand-600)]" />
            Analyzing appetite fit against the risk profile as it comes in…
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <MarketCardSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : matchResults.length === 0 ? (
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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              items={[
                { key: 'possible_match', label: VERDICT_LABELS.possible_match, count: counts.possible_match },
                { key: 'all', label: 'All Markets', count: matchResults.length },
                { key: 'likely_match', label: VERDICT_LABELS.likely_match, count: counts.likely_match },
                { key: 'needs_more_information', label: VERDICT_LABELS.needs_more_information, count: counts.needs_more_information },
                { key: 'not_eligible', label: VERDICT_LABELS.not_eligible, count: counts.not_eligible },
              ]}
              active={filter}
              onChange={(k) => setFilter(k as FilterKey)}
            />
            <div className="relative w-full max-w-[220px] shrink-0 sm:mb-2">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search markets…"
                className="w-full rounded-lg border border-[var(--color-ink-200)] py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={<Search size={22} strokeWidth={1.5} />} title="No markets match" description="Try a different search term or filter." />
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((result, i) => (
                <motion.div key={result.appetiteRecordId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.2 }}>
                  <MarketCard
                    result={result}
                    onClick={() => {
                      setSelected(result);
                      setDrawerOpen(true);
                    }}
                    onEdit={isAgencyAdmin ? () => editMarket(result.appetiteRecordId) : undefined}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      <MarketDetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        record={selectedRecord}
        result={selected}
        actions={(record) => <AddToQuotesAction record={record} accountId={accountId} />}
        onEdit={isAgencyAdmin ? (record) => editMarket(record.id) : undefined}
      />
      <CarrierDrawer
        row={editRow}
        onClose={() => setEditRow(null)}
        onSaved={async (name) => {
          setEditRow(null);
          const res = await reloadCarrierAppetite();
          setNotice(res.ok ? `${name} saved — this account and every other account were re-matched.` : (res.message ?? `${name} saved, but matching couldn't refresh.`));
        }}
        onArchived={async (name) => {
          setEditRow(null);
          setSelectedId(null);
          await reloadCarrierAppetite();
          setNotice(`${name} archived — Market Finder no longer suggests it.`);
        }}
      />
    </PageContainer>
  );
}
