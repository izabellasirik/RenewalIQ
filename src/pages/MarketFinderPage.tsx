import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Compass, Search, Info, RotateCcw, X } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Badge, EmptyState } from '../components/ui';
import { MarketCard } from '../components/appetite/MarketCard';
import { MarketDetailDrawer } from '../components/appetite/MarketDetailDrawer';
import { useAccountsStore } from '../state/useAccountsStore';
import { matchAllMarkets, VERDICT_RANK } from '../services/appetite/matchingEngine';
import {
  buildProfileFromFilters,
  hasAnyFilter,
  EMPTY_MARKET_FINDER_FILTERS,
  OPERATION_TYPE_OPTIONS,
  COVERAGE_OPTIONS,
  type MarketFinderFilters,
  type TriState,
} from '../services/appetite/marketFinderInput';
import { US_STATES, parseStateList } from '../utils/usStates';
import type { AppetiteRecord, MatchResult, Verdict } from '../types';
import { VERDICT_LABELS } from '../types';
import { cn } from '../utils/cn';

const VERDICT_ORDER: Verdict[] = ['likely_match', 'possible_match', 'needs_more_information', 'not_eligible'];

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

interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

function buildFilterChips(filters: MarketFinderFilters, update: <K extends keyof MarketFinderFilters>(key: K, value: MarketFinderFilters[K]) => void): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.domicileState) chips.push({ id: 'domicileState', label: filters.domicileState, onRemove: () => update('domicileState', '') });

  filters.operatingStates.forEach((s) => {
    chips.push({ id: `opState-${s}`, label: `Operates in ${s}`, onRemove: () => update('operatingStates', filters.operatingStates.filter((x) => x !== s)) });
  });

  if (filters.fleetSize) chips.push({ id: 'fleetSize', label: `${filters.fleetSize} Power Units`, onRemove: () => update('fleetSize', '') });

  if (filters.newVenture) {
    chips.push({ id: 'newVenture', label: 'New Venture', onRemove: () => update('newVenture', false) });
  } else if (filters.yearsInBusiness) {
    chips.push({ id: 'yearsInBusiness', label: `${filters.yearsInBusiness} Years in Business`, onRemove: () => update('yearsInBusiness', '') });
  }

  if (filters.operatingRadius.trim()) chips.push({ id: 'operatingRadius', label: filters.operatingRadius.trim(), onRemove: () => update('operatingRadius', '') });

  filters.operationTypes.forEach((t) => {
    chips.push({ id: `opType-${t}`, label: t, onRemove: () => update('operationTypes', filters.operationTypes.filter((x) => x !== t)) });
  });

  filters.cargoText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((c) => {
      chips.push({
        id: `cargo-${c}`,
        label: c,
        onRemove: () =>
          update(
            'cargoText',
            filters.cargoText
              .split(',')
              .map((s) => s.trim())
              .filter((x) => x && x !== c)
              .join(', ')
          ),
      });
    });

  if (filters.minDriverExperienceYears) chips.push({ id: 'minExp', label: `${filters.minDriverExperienceYears}+ yrs driver experience`, onRemove: () => update('minDriverExperienceYears', '') });
  if (filters.minDriverAge) chips.push({ id: 'minAge', label: `Driver age ${filters.minDriverAge}+`, onRemove: () => update('minDriverAge', '') });
  if (filters.telematics !== 'unknown') chips.push({ id: 'telematics', label: `Telematics: ${filters.telematics === 'yes' ? 'Yes' : 'No'}`, onRemove: () => update('telematics', 'unknown') });
  if (filters.dashcams !== 'unknown') chips.push({ id: 'dashcams', label: `Dashcams: ${filters.dashcams === 'yes' ? 'Yes' : 'No'}`, onRemove: () => update('dashcams', 'unknown') });

  filters.coverageNeeded.forEach((c) => {
    chips.push({ id: `coverage-${c}`, label: c, onRemove: () => update('coverageNeeded', filters.coverageNeeded.filter((x) => x !== c)) });
  });

  return chips;
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-800)]/8 py-1 pl-3 pr-1.5 text-xs font-medium text-[var(--color-brand-800)]">
      {label}
      <button onClick={onRemove} className="rounded-full p-0.5 hover:bg-[var(--color-brand-800)]/15 cursor-pointer" aria-label={`Remove ${label}`}>
        <X size={11} />
      </button>
    </span>
  );
}

function NeutralMarketList({ records }: { records: AppetiteRecord[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-400)]">All Markets ({records.length})</p>
      <div className="divide-y divide-[var(--color-ink-100)] overflow-hidden rounded-lg border border-[var(--color-ink-100)] bg-white">
        {records.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--color-ink-800)]">{r.marketName}</p>
              {r.parentCompany !== r.marketName && <p className="truncate text-xs text-[var(--color-ink-400)]">{r.parentCompany}</p>}
            </div>
            <Badge tone="neutral">{r.marketType === 'direct' ? 'Direct' : 'MGA'}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MarketFinderPage() {
  const effectiveAppetiteRecords = useAccountsStore((s) => s.effectiveAppetiteRecords);
  const loadEffectiveAppetiteRecords = useAccountsStore((s) => s.loadEffectiveAppetiteRecords);
  useEffect(() => {
    loadEffectiveAppetiteRecords();
  }, [loadEffectiveAppetiteRecords]);

  const [filters, setFilters] = useState<MarketFinderFilters>(EMPTY_MARKET_FINDER_FILTERS);
  const [selected, setSelected] = useState<MatchResult | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function update<K extends keyof MarketFinderFilters>(key: K, value: MarketFinderFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const filtersActive = hasAnyFilter(filters);

  // Live: every filter change re-runs the SAME matchAllMarkets engine used by account-specific
  // Carrier Appetite — no staging/"apply" step, no second matching implementation.
  const visibleResults = useMemo(() => {
    if (!filtersActive) return [];
    const profile = buildProfileFromFilters(filters);
    let results = matchAllMarkets(effectiveAppetiteRecords, profile);

    if (filters.coverageNeeded.length > 0) {
      const wanted = filters.coverageNeeded.map((c) => c.toLowerCase());
      results = results.filter((r) => {
        const record = effectiveAppetiteRecords.find((rec) => rec.id === r.appetiteRecordId);
        const lines = record?.linesOffered;
        if (!lines || lines.value === null) return true; // unconfirmed lines never excluded — don't guess
        return lines.value.some((line) => wanted.includes(line.toLowerCase()));
      });
    }

    return [...results].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || b.verifiedMatchCount - a.verifiedMatchCount);
  }, [filters, filtersActive, effectiveAppetiteRecords]);

  const countsByVerdict = useMemo(() => {
    const counts: Record<Verdict, number> = { likely_match: 0, possible_match: 0, needs_more_information: 0, not_eligible: 0 };
    for (const r of visibleResults) counts[r.verdict]++;
    return counts;
  }, [visibleResults]);

  const chips = useMemo(() => buildFilterChips(filters, update), [filters]);
  const selectedRecord = selected ? effectiveAppetiteRecords.find((r) => r.id === selected.appetiteRecordId) ?? null : null;

  function handleClear() {
    setFilters(EMPTY_MARKET_FINDER_FILTERS);
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

          <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={handleClear} disabled={!filtersActive} className="mt-1">
            Clear Filters
          </Button>
        </div>

        <div className="min-w-0">
          {!filtersActive ? (
            <div className="flex flex-col gap-6">
              <EmptyState icon={<Compass size={28} strokeWidth={1.5} />} title="Start by selecting any risk characteristic." description="Pick a state, fleet size, or anything else you know — results appear immediately, no search button needed." />
              <NeutralMarketList records={effectiveAppetiteRecords} />
            </div>
          ) : (
            <>
              {chips.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <Chip key={c.id} label={c.label} onRemove={c.onRemove} />
                  ))}
                </div>
              )}

              <div className="mb-4">
                {visibleResults.length === 0 ? (
                  <p className="text-sm text-[var(--color-ink-500)]">0 markets match these filters</p>
                ) : (
                  <p className="text-sm text-[var(--color-ink-600)]">
                    {VERDICT_ORDER.filter((v) => countsByVerdict[v] > 0)
                      .map((v) => `${countsByVerdict[v]} ${VERDICT_LABELS[v]}`)
                      .join(' · ')}
                  </p>
                )}
              </div>

              {visibleResults.length === 0 ? (
                <EmptyState icon={<Search size={22} strokeWidth={1.5} />} title="No markets to show" description="Try removing a filter." />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <AnimatePresence mode="popLayout">
                    {visibleResults.map((result) => (
                      <motion.div
                        key={result.appetiteRecordId}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <MarketCard
                          result={result}
                          onClick={() => {
                            setSelected(result);
                            setDrawerOpen(true);
                          }}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
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
