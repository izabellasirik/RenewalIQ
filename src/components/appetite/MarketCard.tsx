import { CircleCheck, TriangleAlert, CircleX, ChevronRight, Clock, NotebookPen } from 'lucide-react';
import type { MatchReason, MatchResult } from '../../types';
import { Card, CardBody, Badge, VerdictBadge, ScoreRing } from '../ui';
import { AvailableThroughTag } from './AvailableThroughTag';
import { formatDate } from '../../utils/dates';

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
          <ScoreRing score={result.matchScore} />
        </div>

        {result.availableThrough && (
          <div className="mt-2.5">
            <AvailableThroughTag carrierName={result.availableThrough} />
          </div>
        )}

        <ul className="mt-3.5 flex flex-1 flex-col gap-1.5">
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
          <span className={`flex items-center gap-1 ${result.isStale ? 'font-medium text-[var(--color-warning-600)]' : 'text-[var(--color-ink-400)]'}`}>
            <Clock size={12} />
            Verified {formatDate(result.lastVerifiedDate)}
            {result.isStale && ' · Verify'}
          </span>
          <span className="flex items-center gap-1 font-medium text-[var(--color-brand-700)] opacity-0 transition-opacity group-hover:opacity-100">
            Details <ChevronRight size={13} />
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
