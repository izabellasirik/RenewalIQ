import type { AccountStage } from '../../types';
import { ACCOUNT_STAGE_LABELS, MANUAL_ACCOUNT_STAGES } from '../../types';
import { NO_REFERRAL, OTHER_REFERRAL, type OtherReferral, type ReferralSourceName } from '../../services/supabase/partnersRepo';
import type { NewAccountDetails } from '../../state/useAccountsStore';
import { cn } from '../../utils/cn';
import { ReferralPicker } from '../referrals/ReferralPicker';

export interface NewAccountDetailsValue {
  referralSource: string;
  /** referralSource 'other': the partner typed for this client. */
  other?: OtherReferral;
  note: string;
  stage: AccountStage | '';
}
export const EMPTY_ACCOUNT_DETAILS: NewAccountDetailsValue = { referralSource: '', note: '', stage: '' };

/** The details, once every required one is filled in (otherwise null). */
export function readAccountDetails(v: NewAccountDetailsValue, sources: ReferralSourceName[]): NewAccountDetails | null {
  if (!v.referralSource || !v.stage || !v.note.trim()) return null;
  if (v.referralSource === OTHER_REFERRAL) return v.other ? { referralSource: OTHER_REFERRAL, referralLabel: `Other: ${v.other.name}`, other: v.other, note: v.note.trim(), stage: v.stage } : null;
  const label = v.referralSource === NO_REFERRAL ? 'No referral' : sources.find((s) => s.id === v.referralSource)?.name;
  if (!label) return null;
  return { referralSource: v.referralSource, referralLabel: label, note: v.note.trim(), stage: v.stage };
}

const field = 'w-full rounded-lg border px-3 py-2.5 text-sm text-[var(--color-ink-900)] outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';
const label = 'mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]';
const Req = () => <span className="text-[var(--color-danger-600)]">*</span>;

/** New Submission (by hand, from documents, or an intake import): where the client came from, status and a first note — all required. */
export function NewAccountDetailsFields({ value, onChange, showErrors }: { value: NewAccountDetailsValue; onChange: (v: NewAccountDetailsValue) => void; showErrors?: boolean }) {
  const err = (bad: boolean) => (showErrors && bad ? 'border-[var(--color-danger-500)]' : 'border-[var(--color-ink-200)]');
  return (
    <div className="flex flex-col gap-3" data-testid="account-details">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="new-referral">
            Referral source <Req />
          </label>
          <ReferralPicker
            id="new-referral"
            value={value.referralSource}
            other={value.other ?? null}
            onChange={(v, _label, other) => onChange({ ...value, referralSource: v, other })}
            placeholder="Where did the client come from?"
            className={cn(field, err(!value.referralSource))}
          />
        </div>
        <div>
          <label className={label} htmlFor="new-stage">
            Status <Req />
          </label>
          <select id="new-stage" value={value.stage} onChange={(e) => onChange({ ...value, stage: e.target.value as AccountStage | '' })} className={cn(field, err(!value.stage))}>
            <option value="">Choose a status</option>
            {MANUAL_ACCOUNT_STAGES.map((s) => (
              <option key={s} value={s}>
                {ACCOUNT_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={label} htmlFor="new-note">
          Notes <Req />
        </label>
        <textarea id="new-note" rows={3} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} placeholder="e.g. 12 power units, wants quotes by Friday, currently with Progressive" className={cn(field, err(!value.note.trim()))} />
      </div>
      {showErrors && (!value.referralSource || !value.stage || !value.note.trim()) && (
        <p className="text-xs text-[var(--color-danger-600)]" role="alert">Choose the referral source and status, and add a note.</p>
      )}
    </div>
  );
}
