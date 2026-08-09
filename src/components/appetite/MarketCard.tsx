import { CircleCheck, CircleHelp, ChevronRight, Clock, NotebookPen, CircleX, ShieldQuestion } from 'lucide-react';
import type { MatchReason, MatchResult } from '../../types';
import { Card, CardBody, Badge, VerdictBadge } from '../ui';
import { AvailableThroughTag } from './AvailableThroughTag';

const MAX_LISTED = 3;

function verdictIcon(verdict: MatchResult['verdict']) {
  if (verdict === 'not_eligible') return CircleX;
  if (verdict === 'needs_more_information') return ShieldQuestion;
  return CircleCheck;
}

export function MarketCard({ result, onClick }: { result: MatchResult; onClick: () => void }) {
  const failed = result.reasons.filter((r) => r.status === 'fail').slice(0, MAX_LISTED);
  const matched = result.reasons.filter((r) => r.status === 'pass').slice(0, MAX_LISTED);
  const needsVerification = result.reasons.filter((r): r is MatchReason => r.status === 'warning' && !!r.isDataGap).slice(0, MAX_LISTED);
  const VIcon = verdictIcon(result.verdict);

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
          <VIcon size={20} className="shrink-0 text-[var(--color-ink-300)]" />
        </div>

        {result.availableThrough && (
          <div className="mt-2.5">
            <AvailableThroughTag carrierName={result.availableThrough} />
          </div>
        )}

        <div className="mt-3.5 flex flex-1 flex-col gap-3">
          {failed.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-danger-600)]">Failed</p>
              <ul className="mt-1 flex flex-col gap-1">
                {failed.map((r) => (
                  <li key={r.criterion} className="flex items-start gap-1.5 text-xs text-[var(--color-ink-700)]">
                    <CircleX size={13} className="mt-0.5 shrink-0 text-[var(--color-danger-600)]" />
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
                {matched.map((r) => (
                  <li key={r.criterion} className="flex items-center gap-1.5 text-xs text-[var(--color-ink-700)]">
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
                {needsVerification.map((r) => (
                  <li key={r.criterion} className="flex items-center gap-1.5 text-xs text-[var(--color-ink-500)]">
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
