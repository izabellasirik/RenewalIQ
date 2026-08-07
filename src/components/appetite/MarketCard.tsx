import { CircleCheck, CircleX, TriangleAlert, ChevronRight, Clock } from 'lucide-react';
import type { MatchResult } from '../../types';
import { Card, CardBody, Badge, VerdictBadge } from '../ui';
import { AvailableThroughTag } from './AvailableThroughTag';
import { formatDate } from '../../utils/dates';

export function MarketCard({ result, onClick }: { result: MatchResult; onClick: () => void }) {
  const passCount = result.reasons.filter((r) => r.status === 'pass').length;
  const warnCount = result.reasons.filter((r) => r.status === 'warning').length;
  const failCount = result.reasons.filter((r) => r.status === 'fail').length;

  return (
    <Card className="group cursor-pointer transition-shadow hover:[box-shadow:var(--shadow-card-hover)]" onClick={onClick}>
      <CardBody className="pt-5">
        <p className="font-semibold leading-snug text-[var(--color-ink-900)]">{result.marketName}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{result.marketType === 'direct' ? 'Direct' : 'MGA'}</Badge>
          <VerdictBadge verdict={result.verdict} />
        </div>
        {result.availableThrough && <div className="mt-2"><AvailableThroughTag carrierName={result.availableThrough} /></div>}

        <div className="mt-4 flex items-center gap-3 text-xs text-[var(--color-ink-500)]">
          <span className="flex items-center gap-1 text-[var(--color-success-600)]">
            <CircleCheck size={13} /> {passCount}
          </span>
          {warnCount > 0 && (
            <span className="flex items-center gap-1 text-[var(--color-warning-600)]">
              <TriangleAlert size={13} /> {warnCount}
            </span>
          )}
          {failCount > 0 && (
            <span className="flex items-center gap-1 text-[var(--color-danger-600)]">
              <CircleX size={13} /> {failCount}
            </span>
          )}
        </div>

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
