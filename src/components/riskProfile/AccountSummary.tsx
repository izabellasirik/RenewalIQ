import type { Account, RiskProfile } from '../../types';

interface SnapshotChip {
  label: string;
}

function formatRevenue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString('en-US')}`;
}

function buildChips(profile: RiskProfile): SnapshotChip[] {
  const chips: SnapshotChip[] = [];
  const { transportation, business } = profile;

  if (!transportation.fleetSize.isMissing && transportation.fleetSize.value !== null) {
    chips.push({ label: `${transportation.fleetSize.value} Power Unit${transportation.fleetSize.value === 1 ? '' : 's'}` });
  }
  if (!transportation.driverCount.isMissing && transportation.driverCount.value !== null) {
    chips.push({ label: `${transportation.driverCount.value} Driver${transportation.driverCount.value === 1 ? '' : 's'}` });
  }
  if (!business.annualRevenue.isMissing && business.annualRevenue.value !== null) {
    chips.push({ label: `${formatRevenue(business.annualRevenue.value)} Revenue` });
  }
  if (!transportation.operatingRadius.isMissing && transportation.operatingRadius.value) {
    const num = transportation.operatingRadius.value.match(/\d+/)?.[0];
    chips.push({ label: num ? `${num}-mile Radius` : transportation.operatingRadius.value });
  }
  if (!business.yearsInBusiness.isMissing && business.yearsInBusiness.value !== null) {
    chips.push({ label: `${business.yearsInBusiness.value} Year${business.yearsInBusiness.value === 1 ? '' : 's'} in Business` });
  }

  return chips;
}

/** Composed only from fields that are actually present (isMissing === false) — never fills a gap with a guess. */
function buildSummarySentence(profile: RiskProfile, namedInsured: string): string | null {
  const { transportation, business } = profile;

  const yearsClause = !business.yearsInBusiness.isMissing && business.yearsInBusiness.value !== null ? ` ${business.yearsInBusiness.value}-year` : '';
  const commodities = !transportation.commoditiesHauled.isMissing ? transportation.commoditiesHauled.value : null;
  const haulingClause = commodities && commodities.length > 0 ? ` hauling ${commodities.join(', ').toLowerCase()}` : '';
  const radius = !transportation.operatingRadius.isMissing ? transportation.operatingRadius.value : null;
  const radiusClause = radius ? ` within a ${radius} radius` : '';

  const sentence1 = `${namedInsured} is a${yearsClause} transportation operation${haulingClause}${radiusClause}.`;

  const equipmentClauses: string[] = [];
  if (!transportation.fleetSize.isMissing && transportation.fleetSize.value !== null) {
    equipmentClauses.push(`${transportation.fleetSize.value} power unit${transportation.fleetSize.value === 1 ? '' : 's'}`);
  }
  if (!transportation.telematics.isMissing && transportation.telematics.value === true) equipmentClauses.push('telematics');
  if (!transportation.dashcams.isMissing && transportation.dashcams.value === true) equipmentClauses.push('dashcams');

  const sentence2 = equipmentClauses.length > 0 ? ` The account reports ${equipmentClauses.join(', ')}.` : '';

  return sentence1 + sentence2;
}

export function AccountSummary({ account, profile }: { account: Account; profile: RiskProfile }) {
  const namedInsured = !profile.business.namedInsured.isMissing && profile.business.namedInsured.value ? profile.business.namedInsured.value : account.namedInsured;
  const subtitle = !profile.transportation.commoditiesHauled.isMissing && profile.transportation.commoditiesHauled.value ? profile.transportation.commoditiesHauled.value.join(', ') : null;

  const chips = buildChips(profile);
  const summary = buildSummarySentence(profile, namedInsured);

  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] bg-white px-5 py-4">
      <h2 className="text-lg font-semibold text-[var(--color-ink-900)]">{namedInsured}</h2>
      {subtitle && <p className="text-sm text-[var(--color-ink-500)]">{subtitle}</p>}

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c.label} className="rounded-full bg-[var(--color-brand-800)]/8 px-3 py-1 text-xs font-medium text-[var(--color-brand-800)]">
              {c.label}
            </span>
          ))}
        </div>
      )}

      {summary && <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-600)]">{summary}</p>}
    </div>
  );
}
