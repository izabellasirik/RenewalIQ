import { useState } from 'react';
import { CircleCheck, CircleX, TriangleAlert, CircleHelp, NotebookPen, ExternalLink, ChevronDown } from 'lucide-react';
import type { AppetiteCriterion, AppetiteRecord, MatchReason, MatchResult, ReasonGroup, RuleType } from '../../types';
import { Drawer, VerdictBadge, Badge } from '../ui';
import { AvailableThroughTag } from './AvailableThroughTag';
import { FreshnessWarning } from './FreshnessWarning';
import { formatDate } from '../../utils/dates';
import { cn } from '../../utils/cn';

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  HARD_RULE: 'Hard Rule',
  TARGET: 'Target',
  PREFERENCE: 'Preference',
  TYPICAL_RANGE: 'Typical Range',
  UNKNOWN: 'Unknown',
};

const REASON_GROUP_META: Record<ReasonGroup, { label: string; Icon: typeof CircleCheck; color: string }> = {
  matched: { label: 'Matched', Icon: CircleCheck, color: 'text-[var(--color-success-600)]' },
  failed: { label: 'Failed', Icon: CircleX, color: 'text-[var(--color-danger-600)]' },
  needs_verification: { label: 'Needs Verification', Icon: CircleHelp, color: 'text-[var(--color-ink-400)]' },
  preference: { label: 'Preferences', Icon: TriangleAlert, color: 'text-[var(--color-warning-600)]' },
};

const GROUP_ORDER: ReasonGroup[] = ['failed', 'matched', 'needs_verification', 'preference'];

/** Maps a MatchReason's criterion label back to the underlying sourced criterion, so "why this match" rows can show their source. */
function criterionForReason(record: AppetiteRecord, label: string): AppetiteCriterion<unknown> | null {
  switch (label) {
    case 'Eligible States':
      return record.states;
    case 'Fleet Size':
      return record.fleetSize;
    case 'Years in Business':
      return record.yearsInBusinessMax.verificationStatus !== 'UNKNOWN' ? record.yearsInBusinessMax : record.yearsInBusinessMin;
    case 'Operating Radius':
      return record.operationTypes.verificationStatus !== 'UNKNOWN' ? record.operationTypes : record.maxRadius;
    case 'Commodities':
      return record.commodities;
    case 'Driver Requirements':
      return record.minDriverExperienceYears.verificationStatus !== 'UNKNOWN' ? record.minDriverExperienceYears : record.minDriverAge;
    case 'DOT Number':
      return record.dotNumberRequired;
    case 'Loss History':
      return record.maxClaimsPast3Years.verificationStatus !== 'UNKNOWN' ? record.maxClaimsPast3Years : record.maxIncurredPerUnit;
    case 'Telematics':
      return record.telematicsRequired;
    case 'Dashcams':
      return record.dashcamRequired;
    case 'Major Exclusions':
      return record.majorExclusions;
    default:
      return null;
  }
}

function SourcePanel({ criterion }: { criterion: AppetiteCriterion<unknown> }) {
  const isUsable = criterion.verificationStatus === 'VERIFIED' || criterion.verificationStatus === 'PARTIALLY_VERIFIED';
  if (!isUsable) {
    return <p className="mt-1.5 text-[11px] text-[var(--color-ink-400)]">Renewal IQ has no verified source for this criterion.</p>;
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--color-ink-500)]">
      <Badge tone="neutral" className="px-1.5 py-0.5 text-[10px]">
        {RULE_TYPE_LABELS[criterion.ruleType]}
      </Badge>
      {criterion.source.sourceName && <span>{criterion.source.sourceName}</span>}
      {criterion.source.sourceType && criterion.source.sourceType !== 'UNKNOWN' && <span>· {criterion.source.sourceType}</span>}
      {criterion.source.verifiedAt && <span>· Verified {formatDate(criterion.source.verifiedAt)}</span>}
      {criterion.source.sourceUrl && (
        <a
          href={criterion.source.sourceUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 font-medium text-[var(--color-brand-700)] hover:underline"
        >
          Open Source <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

function ReasonRow({ reason, record }: { reason: MatchReason; record: AppetiteRecord }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const meta = REASON_GROUP_META[reason.group];
  const criterion = criterionForReason(record, reason.criterion);

  return (
    <li className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <meta.Icon size={16} className={`mt-0.5 shrink-0 ${meta.color}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-[var(--color-ink-800)]">{reason.criterion}</p>
            {reason.ruleType !== 'UNKNOWN' && (
              <span className="rounded-full bg-[var(--color-ink-100)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-ink-500)]">{RULE_TYPE_LABELS[reason.ruleType]}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{reason.explanation}</p>
          {criterion && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSourceOpen((o) => !o);
              }}
              className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer"
            >
              View Source <ChevronDown size={11} className={cn('transition-transform', sourceOpen && 'rotate-180')} />
            </button>
          )}
          {criterion && sourceOpen && <SourcePanel criterion={criterion} />}
        </div>
      </div>
    </li>
  );
}

function formatStates(record: AppetiteRecord): string {
  const c = record.states;
  if (!c.value) return 'Not verified';
  const parts: string[] = [];
  if (c.value.admitted?.length) parts.push(`Admitted: ${c.value.admitted.join(', ')}`);
  if (c.value.excluded?.length) parts.push(`Excluded: ${c.value.excluded.join(', ')}`);
  return parts.join(' · ') || 'Not verified';
}

function formatFleetSize(record: AppetiteRecord): string {
  const c = record.fleetSize;
  if (!c.value) return 'Not verified';
  const { min, max } = c.value;
  if (min === undefined && max === undefined) return 'Not verified';
  return `${min ?? 0}–${max !== undefined ? max : '∞'} units`;
}

function formatCriterion<T>(c: AppetiteCriterion<T>, formatter: (v: T) => string): string {
  if (c.value === null) return 'Not verified';
  return formatter(c.value);
}

interface CriterionRow {
  label: string;
  criterion: AppetiteCriterion<unknown>;
  display: string;
}

function buildCriterionRows(record: AppetiteRecord): CriterionRow[] {
  return [
    { label: 'Eligible States', criterion: record.states, display: formatStates(record) },
    { label: 'Fleet Size', criterion: record.fleetSize, display: formatFleetSize(record) },
    { label: 'Years in Business (min)', criterion: record.yearsInBusinessMin, display: formatCriterion(record.yearsInBusinessMin, (v) => `${v}+ years`) },
    { label: 'Years in Business (max)', criterion: record.yearsInBusinessMax, display: formatCriterion(record.yearsInBusinessMax, (v) => `under ${v} years`) },
    { label: 'Operation Type', criterion: record.operationTypes, display: formatCriterion(record.operationTypes, (v) => v.join(', ')) },
    { label: 'Max Radius', criterion: record.maxRadius, display: formatCriterion(record.maxRadius, (v) => v) },
    { label: 'Commodities / Operations', criterion: record.commodities, display: formatCriterion(record.commodities, (v) => v.join(', ')) },
    { label: 'Min. Driver Age', criterion: record.minDriverAge, display: formatCriterion(record.minDriverAge, (v) => `${v}`) },
    { label: 'Min. Driver Experience', criterion: record.minDriverExperienceYears, display: formatCriterion(record.minDriverExperienceYears, (v) => `${v} years`) },
    { label: 'Telematics Required', criterion: record.telematicsRequired, display: formatCriterion(record.telematicsRequired, (v) => (v ? 'Yes' : 'No')) },
    { label: 'Dashcam Required', criterion: record.dashcamRequired, display: formatCriterion(record.dashcamRequired, (v) => (v ? 'Yes' : 'No')) },
    { label: 'DOT Number Required', criterion: record.dotNumberRequired, display: formatCriterion(record.dotNumberRequired, (v) => (v ? 'Yes' : 'No')) },
    { label: 'Major Exclusions', criterion: record.majorExclusions, display: formatCriterion(record.majorExclusions, (v) => (v.length ? v.join(', ') : 'None listed')) },
    { label: 'Loss Tolerance — Claims (3yr)', criterion: record.maxClaimsPast3Years, display: formatCriterion(record.maxClaimsPast3Years, (v) => `${v} max`) },
    { label: 'Loss Tolerance — Incurred/Unit', criterion: record.maxIncurredPerUnit, display: formatCriterion(record.maxIncurredPerUnit, (v) => `$${v.toLocaleString('en-US')} max`) },
    { label: 'Lines Offered', criterion: record.linesOffered, display: formatCriterion(record.linesOffered, (v) => v.join(', ')) },
  ];
}

function CriterionCard({ row }: { row: CriterionRow }) {
  const isUsable = row.criterion.verificationStatus === 'VERIFIED' || row.criterion.verificationStatus === 'PARTIALLY_VERIFIED';
  return (
    <div className={`rounded-lg border p-3 ${isUsable ? 'border-[var(--color-ink-100)] bg-white' : 'border-dashed border-[var(--color-ink-200)] bg-[var(--color-ink-50)]'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {isUsable ? <CircleCheck size={13} className="text-[var(--color-success-600)]" /> : <CircleHelp size={13} className="text-[var(--color-ink-400)]" />}
          <p className="text-xs font-medium text-[var(--color-ink-500)]">{row.label}</p>
        </div>
        {isUsable && <span className="shrink-0 rounded-full bg-[var(--color-ink-100)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-ink-500)]">{RULE_TYPE_LABELS[row.criterion.ruleType]}</span>}
      </div>
      <p className={`mt-1 text-sm ${isUsable ? 'font-medium text-[var(--color-ink-900)]' : 'italic text-[var(--color-ink-400)]'}`}>{row.display}</p>
      {row.criterion.notes && <p className="mt-1 text-xs text-[var(--color-ink-500)]">{row.criterion.notes}</p>}
      {isUsable ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-ink-400)]">
          {row.criterion.source.sourceName && <span>{row.criterion.source.sourceName}</span>}
          {row.criterion.source.verifiedAt && <span>· Verified {formatDate(row.criterion.source.verifiedAt)}</span>}
          {row.criterion.source.sourceUrl && (
            <a
              href={row.criterion.source.sourceUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 font-medium text-[var(--color-brand-700)] hover:underline"
            >
              Open Source <ExternalLink size={10} />
            </a>
          )}
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-[var(--color-ink-400)]">Renewal IQ has no verified source for this criterion.</p>
      )}
    </div>
  );
}

export function MarketDetailDrawer({
  open,
  onClose,
  record,
  result,
}: {
  open: boolean;
  onClose: () => void;
  record: AppetiteRecord | null;
  result: MatchResult | null;
}) {
  if (!record || !result) return null;

  const groups = GROUP_ORDER.map((group) => ({ group, reasons: result.reasons.filter((r) => r.group === group) })).filter((g) => g.reasons.length > 0);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={record.marketName}
      subtitle={`${record.marketType === 'direct' ? 'Direct Carrier' : 'MGA'}${record.availableThrough ? ` · available through ${record.availableThrough}` : ''}${
        record.programName ? ` · ${record.programName} program` : ''
      }`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <VerdictBadge verdict={result.verdict} className="text-sm" />
          {record.availableThrough && <AvailableThroughTag carrierName={record.availableThrough} />}
        </div>

        <p className="text-xs text-[var(--color-ink-500)]">
          {result.verifiedMatchCount} verified criteri{result.verifiedMatchCount === 1 ? 'on' : 'a'} matched · {result.needsVerificationCount} need
          {result.needsVerificationCount === 1 ? 's' : ''} verification
        </p>

        {result.freshnessMessage && <FreshnessWarning message={result.freshnessMessage} />}

        {record.underwritingNotes && (
          <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-ink-100)] bg-white p-4">
            <NotebookPen size={16} className="mt-0.5 shrink-0 text-[var(--color-ink-400)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--color-ink-900)]">Underwriting Notes</p>
              <p className="mt-1 text-sm text-[var(--color-ink-600)]">{record.underwritingNotes}</p>
            </div>
          </div>
        )}

        <div>
          <h4 className="mb-2 text-sm font-semibold text-[var(--color-ink-900)]">Why this match?</h4>
          <div className="flex flex-col gap-4">
            {groups.map(({ group, reasons }) => {
              const meta = REASON_GROUP_META[group];
              return (
                <div key={group}>
                  <p className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${meta.color}`}>
                    <meta.Icon size={13} />
                    {meta.label}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {reasons.map((reason) => (
                      <ReasonRow key={reason.criterion} reason={reason} record={record} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-semibold text-[var(--color-ink-900)]">Appetite Record</h4>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {buildCriterionRows(record).map((row) => (
              <CriterionCard key={row.label} row={row} />
            ))}
          </div>
        </div>

        <p className="flex items-start gap-1.5 border-t border-[var(--color-ink-100)] pt-3 text-xs text-[var(--color-ink-400)]">
          Carrier appetite changes frequently. Confirm current eligibility with the market before quoting or binding.
        </p>
      </div>
    </Drawer>
  );
}
