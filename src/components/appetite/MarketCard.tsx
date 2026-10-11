import { CircleCheck, CircleHelp, ChevronRight, Clock, NotebookPen, CircleX, Pencil, ShieldQuestion, UserRoundSearch } from 'lucide-react';
import type { MatchReason, MatchResult } from '../../types';
import { COVERAGE_LABELS, VERDICT_LABELS } from '../../types';
import { AccessStatusBadge } from './MarketAccessParts';
import { Card, CardBody, Badge, VerdictBadge } from '../ui';
import { AvailableThroughTag } from './AvailableThroughTag';
import { getDistributionPartnerNamesByRecordId } from '../../services/appetite/distribution';

const MAX_LISTED = 3;

function verdictIcon(verdict: MatchResult['verdict']) {
  if (verdict === 'not_eligible') return CircleX;
  if (verdict === 'needs_more_information') return ShieldQuestion;
  return CircleCheck;
}

export function MarketCard({ result, onClick, onEdit }: { result: MatchResult; onClick: () => void; /** Agency admins: edit this market's appetite (only passed when the user may). */ onEdit?: () => void }) {
  const failed = result.reasons.filter((r) => r.status === 'fail').slice(0, MAX_LISTED);
  const matched = result.reasons.filter((r) => r.status === 'pass').slice(0, MAX_LISTED);
  const needsVerification = result.reasons.filter((r): r is MatchReason => r.status === 'warning' && !!r.isDataGap).slice(0, MAX_LISTED);
  const review = result.reasons.filter((r) => r.group === 'review').slice(0, MAX_LISTED);
  const coverages = (result.coverageResults ?? []).filter((c) => c.coverage);
  const VIcon = verdictIcon(result.verdict);
  const partnerNames = result.availableThrough ? [] : getDistributionPartnerNamesByRecordId(result.appetiteRecordId);

  return (
    <Card className="group flex cursor-pointer flex-col transition-shadow hover:[box-shadow:var(--shadow-card-hover)]" onClick={onClick}>
      <CardBody className="flex flex-1 flex-col pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold leading-snug text-[var(--color-ink-900)]">{result.marketName}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral">{result.marketType === 'direct' ? 'Direct' : 'MGA'}</Badge>
              <VerdictBadge verdict={result.verdict} />
              {result.access && <AccessStatusBadge status={result.access.status} />}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer"
                aria-label={`Edit ${result.marketName}`}
              >
                <Pencil size={12} /> Edit
              </button>
            )}
            <VIcon size={20} className="text-[var(--color-ink-300)]" />
          </div>
        </div>

        {result.availableThrough && (
          <div className="mt-2.5">
            <AvailableThroughTag carrierName={result.availableThrough} />
          </div>
        )}
        {partnerNames.length > 0 && (
          <div className="mt-2.5">
            <AvailableThroughTag carrierName={partnerNames.length > 1 ? `${partnerNames[0]} +${partnerNames.length - 1} more` : partnerNames[0]} />
          </div>
        )}

        {result.access && (result.access.mga || result.access.wholesaler) && (
          <p className="mt-2 text-xs text-[var(--color-ink-500)]">Through {[result.access.wholesaler, result.access.mga].filter(Boolean).join(' → ')}</p>
        )}
        {coverages.length > 1 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5" data-testid="coverage-verdicts">
            {coverages.map((c) => (
              <li key={c.coverage} className="rounded-md bg-[var(--color-ink-50)] px-2 py-0.5 text-[11px] text-[var(--color-ink-600)]">
                {COVERAGE_LABELS[c.coverage!]}: <span className="font-medium">{VERDICT_LABELS[c.verdict]}</span>
              </li>
            ))}
          </ul>
        )}
        {result.rulesMode && result.reasons.length === 0 && (
          <p className="mt-3 text-xs text-[var(--color-ink-500)]">No underwriting rules on file yet — appetite unknown. Confirm with the market.</p>
        )}

        <div className="mt-3.5 flex flex-1 flex-col gap-3">
          {failed.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-danger-600)]">Failed</p>
              <ul className="mt-1 flex flex-col gap-1">
                {failed.map((r, i) => (
                  <li key={`${r.criterion}-${i}`} className="flex items-start gap-1.5 text-xs text-[var(--color-ink-700)]">
                    <CircleX size={13} className="mt-0.5 shrink-0 text-[var(--color-danger-600)]" />
                    <span className="line-clamp-2">{r.explanation}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-warning-600)]">Underwriter review</p>
              <ul className="mt-1 flex flex-col gap-1">
                {review.map((r, i) => (
                  <li key={`${r.criterion}-${i}`} className="flex items-start gap-1.5 text-xs text-[var(--color-ink-700)]">
                    <UserRoundSearch size={13} className="mt-0.5 shrink-0 text-[var(--color-warning-600)]" />
                    <span className="line-clamp-2">{r.explanation}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {matched.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-success-600)]">Verified</p>
              <ul className="mt-1 flex flex-col gap-1">
                {matched.map((r, i) => (
                  <li key={`${r.criterion}-${i}`} className="flex items-center gap-1.5 text-xs text-[var(--color-ink-700)]">
                    <CircleCheck size={13} className="shrink-0 text-[var(--color-success-600)]" />
                    {r.criterion}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {needsVerification.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)]">Needs Verification</p>
              <ul className="mt-1 flex flex-col gap-1">
                {needsVerification.map((r, i) => (
                  <li key={`${r.criterion}-${i}`} className="flex items-center gap-1.5 text-xs text-[var(--color-ink-500)]">
                    <CircleHelp size={13} className="shrink-0 text-[var(--color-ink-400)]" />
                    {r.criterion}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {result.underwritingNotes && (
          <div className="mt-3 flex items-start gap-1.5 rounded-md bg-[var(--color-ink-50)] px-2.5 py-2 text-xs text-[var(--color-ink-500)]">
            <NotebookPen size={13} className="mt-0.5 shrink-0 text-[var(--color-ink-400)]" />
            <span className="line-clamp-2">{result.underwritingNotes}</span>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-[var(--color-ink-100)] pt-3 text-xs">
          <span className={`flex items-center gap-1 ${result.freshness === 'STALE' ? 'font-medium text-[var(--color-warning-600)]' : 'text-[var(--color-ink-400)]'}`}>
            <Clock size={12} />
            {result.freshness === 'UNKNOWN' ? 'Not yet verified' : result.freshness === 'STALE' ? 'Verification aging — recheck' : result.freshness === 'AGING' ? 'Verification aging' : 'Recently verified'}
          </span>
          <span className="flex items-center gap-1 font-medium text-[var(--color-brand-700)] group-hover:underline">
            Why this match? <ChevronRight size={13} />
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
