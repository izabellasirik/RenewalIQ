import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Compass, Search, Info, RotateCcw } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, EmptyState } from '../components/ui';
import { MarketCard } from '../components/appetite/MarketCard';
import { MarketDetailDrawer } from '../components/appetite/MarketDetailDrawer';
import { sampleAppetiteRecords } from '../data/carriers';
import { matchAllMarkets, VERDICT_RANK } from '../services/appetite/matchingEngine';
import {
  buildProfileFromFilters,
  EMPTY_MARKET_FINDER_FILTERS,
  OPERATION_TYPE_OPTIONS,
  COVERAGE_OPTIONS,
  type MarketFinderFilters,
  type TriState,
} from '../services/appetite/marketFinderInput';
import { US_STATES, parseStateList } from '../utils/usStates';
import type { MatchResult } from '../types';
import { cn } from '../utils/cn';

function fieldLabelClass() {
  return 'mb-1 block text-xs font-medium text-[var(--color-ink-600)]';
}

function inputClass() {
  return 'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm text-[var(--color-ink-900)] outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';
}

function ToggleChips({ options, selected, onToggle }: { options: readonly string[]; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isActive = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
              isActive
                ? 'border-[var(--color-brand-700)] bg-[var(--color-brand-800)]/8 text-[var(--color-brand-800)]'
                : 'border-[var(--color-ink-200)] text-[var(--color-ink-600)] hover:border-[var(--color-ink-300)]'
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function TriStateToggle({ value, onChange }: { value: TriState; onChange: (v: TriState) => void }) {
  const options: { key: TriState; label: string }[] = [
    { key: 'unknown', label: 'Unknown' },
    { key: 'yes', label: 'Yes' },
    { key: 'no', label: 'No' },
  ];
  return (
    <div className="inline-flex rounded-lg border border-[var(--color-ink-200)] p-0.5">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
            value === opt.key ? 'bg-[var(--color-brand-800)] text-white' : 'text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export function MarketFinderPage() {
  const [filters, setFilters] = useState<MarketFinderFilters>(EMPTY_MARKET_FINDER_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<MarketFinderFilters | null>(null);
  const [showNotEligible, setShowNotEligible] = useState(false);
  const [selected, setSelected] = useState<MatchResult | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function update<K extends keyof MarketFinderFilters>(key: K, value: MarketFinderFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const allResults = useMemo(() => {
    if (!appliedFilters) return null;
    const profile = buildProfileFromFilters(appliedFilters);
    let results = matchAllMarkets(sampleAppetiteRecords, profile);
    if (appliedFilters.coverageNeeded.length > 0) {
      const wanted = appliedFilters.coverageNeeded.map((c) => c.toLowerCase());
      results = results.filter((r) => {
        const record = sampleAppetiteRecords.find((rec) => rec.id === r.appetiteRecordId);
        const lines = record?.linesOffered;
        if (!lines || lines.value === null) return true; // unconfirmed lines never excluded — don't guess
        return lines.value.some((line) => wanted.includes(line.toLowerCase()));
      });
    }
    return results;
  }, [appliedFilters]);

  const visibleResults = useMemo(() => {
    if (!allResults) return [];
    const base = showNotEligible ? allResults : allResults.filter((r) => r.verdict !== 'not_eligible');
    return [...base].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || b.matchScore - a.matchScore);
  }, [allResults, showNotEligible]);

  const notEligibleCount = allResults?.filter((r) => r.verdict === 'not_eligible').length ?? 0;
  const filtersChangedSinceSearch = appliedFilters !== null && JSON.stringify(filters) !== JSON.stringify(appliedFilters);
  const selectedRecord = selected ? sampleAppetiteRecords.find((r) => r.id === selected.appetiteRecordId) ?? null : null;

  function handleFind() {
    setAppliedFilters(filters);
  }

  function handleClear() {
    setFilters(EMPTY_MARKET_FINDER_FILTERS);
    setAppliedFilters(null);
  }

  return (
    <PageContainer title="Market Finder" description="Search trucking markets based on risk characteristics — no submission required.">
      <p className="mb-2 flex items-start gap-1.5 text-xs text-[var(--color-ink-400)]">
        <Info size={13} className="mt-0.5 shrink-0" />
        Carrier appetite changes frequently. Renewal IQ recommendations are based on the latest information available and should be confirmed with the market before binding.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-ink-100)] bg-white p-4 lg:sticky lg:top-4 lg:self-start">
          <p className="text-sm font-semibold text-[var(--color-ink-900)]">Filters</p>

          <div>
            <label className={fieldLabelClass()}>Domicile State</label>
            <select value={filters.domicileState} onChange={(e) => update('domicileState', e.target.value)} className={inputClass()}>
              <option value="">Any</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={fieldLabelClass()}>Operating States</label>
            <input
              value={filters.operatingStates.join(', ')}
              onChange={(e) => update('operatingStates', parseStateList(e.target.value))}
              placeholder="e.g. NJ, NY, PA"
              className={inputClass()}
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={fieldLabelClass()}>Fleet Size</label>
              <input type="number" min={0} value={filters.fleetSize} onChange={(e) => update('fleetSize', e.target.value)} placeholder="Units" className={inputClass()} />
            </div>
            <div>
              <label className={fieldLabelClass()}>Years in Business</label>
              <input
                type="number"
                min={0}
                value={filters.yearsInBusiness}
                onChange={(e) => update('yearsInBusiness', e.target.value)}
                placeholder="Years"
                className={inputClass()}
                disabled={filters.newVenture}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-ink-600)]">
            <input
              type="checkbox"
              checked={filters.newVenture}
              onChange={(e) => update('newVenture', e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--color-ink-300)] accent-[var(--color-brand-700)]"
            />
            New venture (no exact years known)
          </label>

          <div>
            <label className={fieldLabelClass()}>Operating Radius</label>
            <input value={filters.operatingRadius} onChange={(e) => update('operatingRadius', e.target.value)} placeholder="e.g. 500 miles or Regional" className={inputClass()} />
          </div>

          <div>
            <label className={fieldLabelClass()}>Operation Type</label>
            <ToggleChips options={OPERATION_TYPE_OPTIONS} selected={filters.operationTypes} onToggle={(v) => update('operationTypes', toggleInArray(filters.operationTypes, v))} />
          </div>

          <div>
            <label className={fieldLabelClass()}>Cargo / Commodity</label>
            <input value={filters.cargoText} onChange={(e) => update('cargoText', e.target.value)} placeholder="e.g. steel, produce" className={inputClass()} />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={fieldLabelClass()}>Min. Driver Experience</label>
              <input type="number" min={0} value={filters.minDriverExperienceYears} onChange={(e) => update('minDriverExperienceYears', e.target.value)} placeholder="Years" className={inputClass()} />
            </div>
            <div>
              <label className={fieldLabelClass()}>Min. Driver Age</label>
              <input type="number" min={0} value={filters.minDriverAge} onChange={(e) => update('minDriverAge', e.target.value)} placeholder="Age" className={inputClass()} />
            </div>
          </div>

          <div>
            <p className={fieldLabelClass()}>Telematics</p>
            <TriStateToggle value={filters.telematics} onChange={(v) => update('telematics', v)} />
          </div>
          <div>
            <p className={fieldLabelClass()}>Dashcams</p>
            <TriStateToggle value={filters.dashcams} onChange={(v) => update('dashcams', v)} />
          </div>

          <div>
            <label className={fieldLabelClass()}>Coverage Needed</label>
            <ToggleChips options={COVERAGE_OPTIONS} selected={filters.coverageNeeded} onToggle={(v) => update('coverageNeeded', toggleInArray(filters.coverageNeeded, v))} />
          </div>

          <div className="mt-1 flex items-center gap-2">
            <Button icon={<Search size={14} />} onClick={handleFind} className="flex-1">
              Find Markets
            </Button>
            <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>

        <div className="min-w-0">
          {appliedFilters === null ? (
            <EmptyState
              icon={<Compass size={28} strokeWidth={1.5} />}
              title="Search for a market"
              description="Enter what you know about the risk — fleet size, state, operations — and click Find Markets. Leave anything you don't know blank."
            />
          ) : (
            <>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-[var(--color-ink-500)]">
                  {visibleResults.length} market{visibleResults.length === 1 ? '' : 's'} shown
                  {filtersChangedSinceSearch && ' · filters changed — click Find Markets to refresh'}
                </p>
                {notEligibleCount > 0 && (
                  <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-500)]">
                    <input
                      type="checkbox"
                      checked={showNotEligible}
                      onChange={(e) => setShowNotEligible(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-[var(--color-ink-300)] accent-[var(--color-brand-700)]"
                    />
                    Show Not Eligible ({notEligibleCount})
                  </label>
                )}
              </div>

              {visibleResults.length === 0 ? (
                <EmptyState
                  icon={<Search size={22} strokeWidth={1.5} />}
                  title="No markets to show"
                  description={notEligibleCount > 0 ? 'Every match came back Not Eligible — check "Show Not Eligible" to see why.' : 'Try broadening the filters.'}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleResults.map((result, i) => (
                    <motion.div key={result.appetiteRecordId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.2 }}>
                      <MarketCard
                        result={result}
                        onClick={() => {
                          setSelected(result);
                          setDrawerOpen(true);
                        }}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <MarketDetailDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} record={selectedRecord} result={selected} />
    </PageContainer>
  );
}

