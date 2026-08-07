import { CircleCheck, CircleX, TriangleAlert, Mail } from 'lucide-react';
import type { AppetiteRecord, MatchResult } from '../../types';
import { Drawer, Badge, VerdictBadge, ConfidenceBadge } from '../ui';
import { AvailableThroughTag } from './AvailableThroughTag';
import { FreshnessWarning } from './FreshnessWarning';
import { formatDate } from '../../utils/dates';

const REASON_ICON = {
  pass: CircleCheck,
  warning: TriangleAlert,
  fail: CircleX,
};

const REASON_COLOR = {
  pass: 'text-[var(--color-success-600)]',
  warning: 'text-[var(--color-warning-600)]',
  fail: 'text-[var(--color-danger-600)]',
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-[var(--color-ink-500)]">{label}</p>
      <p className="mt-0.5 text-sm text-[var(--color-ink-900)]">{value}</p>
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
      subtitle={record.marketType === 'direct' ? 'Direct Carrier' : `MGA${record.availableThrough ? ` · available through ${record.availableThrough}` : ''}`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <VerdictBadge verdict={result.verdict} className="text-sm" />
          {record.availableThrough && <AvailableThroughTag carrierName={record.availableThrough} />}
        </div>

        {result.staleWarning && <FreshnessWarning message={result.staleWarning} />}

        <div>
          <h4 className="mb-2 text-sm font-semibold text-[var(--color-ink-900)]">Why this market {result.verdict === 'not_eligible' ? 'did not' : ''} match{result.verdict !== 'not_eligible' ? 'ed' : ''}</h4>
          <ul className="flex flex-col gap-2.5">
            {result.reasons.map((reason) => {
              const Icon = REASON_ICON[reason.status];
              return (
                <li key={reason.criterion} className="flex items-start gap-2.5 rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
                  <Icon size={16} className={`mt-0.5 shrink-0 ${REASON_COLOR[reason.status]}`} />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink-800)]">{reason.criterion}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{reason.explanation}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-semibold text-[var(--color-ink-900)]">Appetite Record</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] p-4">
            <Field label="Eligible States" value={record.eligibleStates.join(', ')} />
            <Field label="Fleet Size" value={`${record.fleetSizeMin ?? 0}–${record.fleetSizeMax ?? '∞'} units`} />
            <Field label="Years in Business" value={record.yearsInBusinessMin ? `${record.yearsInBusinessMin}+ years` : 'No minimum'} />
            <Field label="Operation Type" value={record.operationTypes.join(', ')} />
            <Field label="Max Radius" value={record.maxRadius ?? 'Unrestricted'} />
            <Field label="Commodities / Cargo" value={record.commodities.join(', ')} />
            <Field label="Driver Requirements" value={record.driverRequirements} />
            <Field label="Telematics Required" value={record.telematicsRequired ? 'Yes' : 'No'} />
            <Field label="Dashcam Required" value={record.dashcamRequired ? 'Yes' : 'No'} />
            <div className="col-span-2">
              <Field label="Major Exclusions" value={record.majorExclusions.join(', ') || 'None listed'} />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-ink-100)] p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--color-ink-800)]">Data Freshness</p>
            <Badge tone={result.isStale ? 'warning' : 'success'}>{result.isStale ? 'Needs Verification' : 'Recently Verified'}</Badge>
          </div>
          <p className="text-xs text-[var(--color-ink-500)]">Last verified {formatDate(record.lastVerifiedDate)}</p>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-ink-500)]">Record confidence:</span>
            <ConfidenceBadge confidence={record.confidence} />
          </div>
          <div className="flex items-start gap-2 border-t border-[var(--color-ink-100)] pt-3 text-xs text-[var(--color-ink-600)]">
            <Mail size={13} className="mt-0.5 shrink-0 text-[var(--color-ink-400)]" />
            {record.sourceContact}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
