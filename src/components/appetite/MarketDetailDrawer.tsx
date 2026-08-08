import { CircleCheck, CircleX, TriangleAlert, CircleHelp, NotebookPen, ExternalLink, ShieldQuestion } from 'lucide-react';
import type { AppetiteCriterion, AppetiteRecord, MatchReason, MatchResult } from '../../types';
import { Drawer, VerdictBadge, ScoreRing } from '../ui';
import { AvailableThroughTag } from './AvailableThroughTag';
import { FreshnessWarning } from './FreshnessWarning';
import { formatDate } from '../../utils/dates';

function reasonIcon(reason: MatchReason) {
  if (reason.status === 'pass') return { Icon: CircleCheck, color: 'text-[var(--color-success-600)]' };
  if (reason.status === 'fail') return { Icon: CircleX, color: 'text-[var(--color-danger-600)]' };
  return reason.isDataGap
    ? { Icon: CircleHelp, color: 'text-[var(--color-ink-400)]' }
    : { Icon: TriangleAlert, color: 'text-[var(--color-warning-600)]' };
}

function showsScore(result: MatchResult): boolean {
  return result.verdict !== 'not_eligible' && result.verdict !== 'needs_more_information';
}

function formatStates(record: AppetiteRecord): string {
  const c = record.states;
  if (c.status === 'UNKNOWN' || !c.value) return 'Not verified';
  const parts: string[] = [];
  if (c.value.admitted?.length) parts.push(`Admitted: ${c.value.admitted.join(', ')}`);
  if (c.value.excluded?.length) parts.push(`Excluded: ${c.value.excluded.join(', ')}`);
  return parts.join(' · ') || 'Not verified';
}

function formatFleetSize(record: AppetiteRecord): string {
  const c = record.fleetSize;
  if (c.status === 'UNKNOWN' || !c.value) return 'Not verified';
  const { min, max } = c.value;
  if (min === undefined && max === undefined) return 'Not verified';
  return `${min ?? 0}–${max !== undefined ? max : '∞'} units`;
}

function formatCriterion<T>(c: AppetiteCriterion<T>, formatter: (v: T) => string): string {
  if (c.status === 'UNKNOWN' || c.value === null) return 'Not verified';
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
    { label: 'Years in Business', criterion: record.yearsInBusinessMin, display: formatCriterion(record.yearsInBusinessMin, (v) => `${v}+ years`) },
    { label: 'Operation Type', criterion: record.operationTypes, display: formatCriterion(record.operationTypes, (v) => v.join(', ')) },
    { label: 'Max Radius', criterion: record.maxRadius, display: formatCriterion(record.maxRadius, (v) => v) },
    { label: 'Commodities / Operations', criterion: record.commodities, display: formatCriterion(record.commodities, (v) => v.join(', ')) },
    { label: 'Min. Driver Age', criterion: record.minDriverAge, display: formatCriterion(record.minDriverAge, (v) => `${v}`) },
    { label: 'Min. Driver Experience', criterion: record.minDriverExperienceYears, display: formatCriterion(record.minDriverExperienceYears, (v) => `${v} years`) },
    { label: 'Telematics Required', criterion: record.telematicsRequired, display: formatCriterion(record.telematicsRequired, (v) => (v ? 'Yes' : 'No')) },
    { label: 'Dashcam Required', criterion: record.dashcamRequired, display: formatCriterion(record.dashcamRequired, (v) => (v ? 'Yes' : 'No')) },
    { label: 'Major Exclusions', criterion: record.majorExclusions, display: formatCriterion(record.majorExclusions, (v) => (v.length ? v.join(', ') : 'None listed')) },
    { label: 'Loss Tolerance — Claims (3yr)', criterion: record.maxClaimsPast3Years, display: formatCriterion(record.maxClaimsPast3Years, (v) => `${v} max`) },
    { label: 'Loss Tolerance — Incurred/Unit', criterion: record.maxIncurredPerUnit, display: formatCriterion(record.maxIncurredPerUnit, (v) => `$${v.toLocaleString('en-US')} max`) },
    { label: 'Lines Offered', criterion: record.linesOffered, display: formatCriterion(record.linesOffered, (v) => v.join(', ')) },
  ];
}

function CriterionCard({ row }: { row: CriterionRow }) {
  const isVerified = row.criterion.status === 'VERIFIED';
  return (
    <div className={`rounded-lg border p-3 ${isVerified ? 'border-[var(--color-ink-100)] bg-white' : 'border-dashed border-[var(--color-ink-200)] bg-[var(--color-ink-50)]'}`}>
      <div className="flex items-center gap-1.5">
        {isVerified ? <CircleCheck size={13} className="text-[var(--color-success-600)]" /> : <ShieldQuestion size={13} className="text-[var(--color-ink-400)]" />}
        <p className="text-xs font-medium text-[var(--color-ink-500)]">{row.label}</p>
      </div>
      <p className={`mt-1 text-sm ${isVerified ? 'font-medium text-[var(--color-ink-900)]' : 'italic text-[var(--color-ink-400)]'}`}>{row.display}</p>
      {row.criterion.notes && <p className="mt-1 text-xs text-[var(--color-ink-500)]">{row.criterion.notes}</p>}
      {isVerified ? (
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
        <div className="flex items-center gap-4 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] p-4">
          {showsScore(result) ? (
            <ScoreRing score={result.matchScore} size={72} />
          ) : (
            <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-white text-[var(--color-ink-400)]">
              {result.verdict === 'not_eligible' ? <CircleX size={28} /> : <ShieldQuestion size={28} />}
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-[var(--color-ink-500)]">{showsScore(result) ? 'Match Score' : result.verdict === 'not_eligible' ? 'Not Eligible' : 'Needs More Information'}</p>
            <p className="text-sm text-[var(--color-ink-600)]">
              {result.verdict === 'not_eligible'
                ? 'A verified hard-stop criterion rules this market out — no numeric score applies.'
                : result.verdict === 'needs_more_information'
                  ? 'Not enough verified appetite data on either side to make a confident recommendation yet.'
                  : "Reflects fit strength among verified criteria. Doesn't count unknown market data against the account."}
            </p>
          </div>
        </div>

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
          <ul className="flex flex-col gap-2.5">
            {result.reasons.map((reason) => {
              const { Icon, color } = reasonIcon(reason);
              return (
                <li key={reason.criterion} className="flex items-start gap-2.5 rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
                  <Icon size={16} className={`mt-0.5 shrink-0 ${color}`} />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink-800)]">
                      {reason.criterion}
                      {reason.status === 'warning' && reason.isDataGap && <span className="ml-1.5 text-xs font-normal text-[var(--color-ink-400)]">Not verified</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{reason.explanation}</p>
                  </div>
                </li>
              );
            })}
          </ul>
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
