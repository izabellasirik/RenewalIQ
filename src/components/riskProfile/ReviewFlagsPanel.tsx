import { useMemo, useState } from 'react';
import { Check, TriangleAlert, Trash2 } from 'lucide-react';
import type { CoverageField, FieldValue, ReviewFlag, RiskProfile } from '../../types';
import { COVERAGE_LABELS } from '../../types';
import { Button } from '../ui';
import { useAccountsStore, type ReviewFlagTarget } from '../../state/useAccountsStore';

interface FlaggedEntry {
  key: string;
  label: string;
  value?: string;
  flag: ReviewFlag;
  target: ReviewFlagTarget;
}

const humanize = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const show = (v: unknown) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? '' : String(v));

/** Everything on the account kept for review after a document it came from was removed. */
export function collectReviewFlags(profile: RiskProfile, lossRuns: { id: string; carrier: string; reviewFlag?: ReviewFlag }[] = []): FlaggedEntry[] {
  const out: FlaggedEntry[] = [];
  for (const section of ['business', 'transportation'] as const) {
    const bucket = profile[section] as unknown as Record<string, FieldValue<unknown>>;
    for (const [key, f] of Object.entries(bucket)) {
      if (f?.reviewFlag) out.push({ key: `${section}.${key}`, label: humanize(key), value: show(f.value), flag: f.reviewFlag, target: { kind: 'field', section, key } });
    }
  }
  for (const line of profile.coverage) {
    for (const field of ['currentLimit', 'requestedLimit', 'deductible'] as CoverageField[]) {
      const f = line[field];
      if (f?.reviewFlag) out.push({ key: `cov.${line.type}.${field}`, label: `${COVERAGE_LABELS[line.type]} ${humanize(field).toLowerCase()}`, value: show(f.value), flag: f.reviewFlag, target: { kind: 'coverage', type: line.type, field } });
    }
  }
  for (const d of profile.drivers) if (d.reviewFlag) out.push({ key: d.id, label: `Driver ${d.name ?? '(no name)'}`, flag: d.reviewFlag, target: { kind: 'driver', id: d.id } });
  for (const v of profile.vehicles)
    if (v.reviewFlag) out.push({ key: v.id, label: `Vehicle ${[v.year, v.make, v.model].filter(Boolean).join(' ') || v.vin || ''}`.trim(), value: v.vin, flag: v.reviewFlag, target: { kind: 'vehicle', id: v.id } });
  for (const l of profile.lossHistory)
    if (l.reviewFlag) out.push({ key: l.id, label: `Claim ${l.lossDate ?? ''} ${l.claimType ?? ''}`.trim(), flag: l.reviewFlag, target: { kind: 'loss', id: l.id } });
  for (const r of lossRuns) if (r.reviewFlag) out.push({ key: r.id, label: `Loss run — ${r.carrier}`, flag: r.reviewFlag, target: { kind: 'lossRun', id: r.id } });
  return out;
}

/**
 * Data kept — not deleted — when a document it came from was removed, because the broker had
 * edited, confirmed or annotated it. The broker keeps it (clears the flag) or removes it.
 */
export function ReviewFlagsPanel({ accountId }: { accountId: string }) {
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const lossRuns = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId)?.lossRuns);
  const clearReviewFlag = useAccountsStore((s) => s.clearReviewFlag);
  const updateField = useAccountsStore((s) => s.updateField);
  const updateCoverage = useAccountsStore((s) => s.updateCoverage);
  const deleteDriver = useAccountsStore((s) => s.deleteDriver);
  const deleteVehicle = useAccountsStore((s) => s.deleteVehicle);
  const deleteLoss = useAccountsStore((s) => s.deleteLoss);
  const deleteLossRun = useAccountsStore((s) => s.deleteLossRun);
  const [confirming, setConfirming] = useState<string | null>(null);
  const flagged = useMemo(() => (profile ? collectReviewFlags(profile, lossRuns) : []), [profile, lossRuns]);
  if (flagged.length === 0) return null;

  function remove(e: FlaggedEntry) {
    const t = e.target;
    if (t.kind === 'field') updateField(accountId, t.section, t.key, null);
    else if (t.kind === 'coverage') updateCoverage(accountId, t.type, t.field, '');
    else if (t.kind === 'driver') deleteDriver(accountId, t.id);
    else if (t.kind === 'vehicle') deleteVehicle(accountId, t.id);
    else if (t.kind === 'loss') deleteLoss(accountId, t.id);
    else deleteLossRun(accountId, t.id);
    // A cleared field keeps its (now empty) entry — drop the flag too.
    if (t.kind === 'field' || t.kind === 'coverage') clearReviewFlag(accountId, t);
    setConfirming(null);
  }

  return (
    <div className="rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/40 px-4 py-3" data-testid="review-flags">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-warning-600)]">
        <TriangleAlert size={16} />
        Check {flagged.length} item{flagged.length === 1 ? '' : 's'} from a removed document
      </p>
      <p className="mt-0.5 text-xs text-[var(--color-ink-600)]">These came from a document that was removed, but you had edited or confirmed them, so they weren’t deleted. Keep each one, or remove it.</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {flagged.map((e) => (
          <li key={e.key} className="flex flex-wrap items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-sm" data-testid="review-flag">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-[var(--color-ink-800)]">
                {e.label}
                {e.value ? <span className="font-normal text-[var(--color-ink-600)]"> — {e.value}</span> : null}
              </p>
              <p className="text-xs text-[var(--color-ink-500)]">
                {e.flag.reason} ({e.flag.documentName || 'removed document'})
              </p>
            </div>
            {confirming === e.key ? (
              <>
                <span className="text-xs text-[var(--color-ink-600)]">Remove it?</span>
                <Button size="sm" variant="danger" onClick={() => remove(e)}>
                  Remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" icon={<Check size={13} />} onClick={() => clearReviewFlag(accountId, e.target)}>
                  Keep
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirming(e.key)}>
                  Remove
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
