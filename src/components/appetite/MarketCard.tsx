import { CircleCheck, TriangleAlert, CircleX, ChevronRight, Clock, NotebookPen, ShieldQuestion } from 'lucide-react';
import type { MatchReason, MatchResult } from '../../types';
import { Card, CardBody, Badge, VerdictBadge, ScoreRing } from '../ui';
import { AvailableThroughTag } from './AvailableThroughTag';

const REASON_ICON = { pass: CircleCheck, warning: TriangleAlert, fail: CircleX };
const REASON_COLOR = {
  pass: 'text-[var(--color-success-600)]',
  warning: 'text-[var(--color-warning-600)]',
  fail: 'text-[var(--color-danger-600)]',
};
const STATUS_PRIORITY: Record<MatchReason['status'], number> = { fail: 0, warning: 1, pass: 2 };

function topReasons(reasons: MatchReason[], n: number): MatchReason[] {
  return [...reasons].sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]).slice(0, n);
}

/** Numeric scores only mean something for markets that remain eligible with enough verified signal — hide the ring rather than imply false precision otherwise. */
function showsScore(result: MatchResult): boolean {
  return result.verdict !== 'not_eligible' && result.verdict !== 'needs_more_information';
}

export function MarketCard({ result, onClick }: { result: MatchResult; onClick: () => void }) {
  return (
    <Card className="group flex cursor-pointer flex-col transition-shadow hover:[box-shadow:var(--shadow-card-hover)]" onClick={onClick}>
      <CardBody className="flex flex-1 flex-col pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold leading-snug text-[var(--color-ink-900)]">{result.marketName}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral">{result.marketType === 'direct' ? 'Direct' : 'MGA'}</Badge>
              <VerdictBadge verdict={result.verdict} />
            </div>
          </div>
          {showsScore(result) ? (
            <ScoreRing score={result.matchScore} />
          ) : (
            <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-[var(--color-ink-50)] text-[var(--color-ink-400)]">
              {result.verdict === 'not_eligible' ? <CircleX size={20} /> : <ShieldQuestion size={20} />}
            </div>
          )}
        </div>

        {result.availableThrough && (
          <div className="mt-2.5">
            <AvailableThroughTag carrierName={result.availableThrough} />
          </div>
        )}

        <p className="mt-3 text-xs text-[var(--color-ink-500)]">
          {result.verifiedMatchCount} verified criteri{result.verifiedMatchCount === 1 ? 'on' : 'a'} matched
          {result.needsVerificationCount > 0 && (
            <>
              {' · '}
              {result.needsVerificationCount} need{result.needsVerificationCount === 1 ? 's' : ''} verification
            </>
          )}
        </p>

        <ul className="mt-2.5 flex flex-1 flex-col gap-1.5">
          {topReasons(result.reasons, 2).map((reason) => {
            const Icon = REASON_ICON[reason.status];
            return (
              <li key={reason.criterion} className="flex items-start gap-1.5 text-xs text-[var(--color-ink-600)]">
                <Icon size={13} className={`mt-0.5 shrink-0 ${REASON_COLOR[reason.status]}`} />
                <span className="line-clamp-2">{reason.explanation}</span>
              </li>
            );
          })}
        </ul>

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
          <span className="flex items-center gap-1 font-medium text-[var(--color-brand-700)] opacity-0 transition-opacity group-hover:opacity-100">
            Details <ChevronRight size={13} />
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
