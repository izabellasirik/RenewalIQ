import type { AccountStage } from '../../types';
import { ACCOUNT_STAGE_LABELS, MANUAL_ACCOUNT_STAGES } from '../../types';
import { useReferralSources } from '../../hooks/useReferralSources';
import { NO_REFERRAL, type ReferralSourceName } from '../../services/supabase/partnersRepo';
import type { NewAccountDetails } from '../../state/useAccountsStore';
import { cn } from '../../utils/cn';

export interface NewAccountDetailsValue {
  referralSource: string;
  note: string;
  stage: AccountStage | '';
}
export const EMPTY_ACCOUNT_DETAILS: NewAccountDetailsValue = { referralSource: '', note: '', stage: '' };

/** The details, once every required one is filled in (otherwise null). */
export function readAccountDetails(v: NewAccountDetailsValue, sources: ReferralSourceName[]): NewAccountDetails | null {
  if (!v.referralSource || !v.stage || !v.note.trim()) return null;
  const label = v.referralSource === NO_REFERRAL ? 'No referral' : sources.find((s) => s.id === v.referralSource)?.name;
  if (!label) return null;
  return { referralSource: v.referralSource, referralLabel: label, note: v.note.trim(), stage: v.stage };
}

const field = 'w-full rounded-lg border px-3 py-2.5 text-sm text-[var(--color-ink-900)] outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';
const label = 'mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]';
const Req = () => <span className="text-[var(--color-danger-600)]">*</span>;

/** New Submission (by hand, from documents, or an intake import): where the client came from, status and a first note — all required. */
export function NewAccountDetailsFields({ value, onChange, showErrors }: { value: NewAccountDetailsValue; onChange: (v: NewAccountDetailsValue) => void; showErrors?: boolean }) {
  const sources = useReferralSources().filter((s) => s.active || s.id === value.referralSource);
  const err = (bad: boolean) => (showErrors && bad ? 'border-[var(--color-danger-500)]' : 'border-[var(--color-ink-200)]');
  return (
    <div className="flex flex-col gap-3" data-testid="account-details">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="new-referral">
            Referral source <Req />
          </label>
          <select id="new-referral" value={value.referralSource} onChange={(e) => onChange({ ...value, referralSource: e.target.value })} className={cn(field, err(!value.referralSource))}>
            <option value="">Where did the client come from?</option>
            <option value={NO_REFERRAL}>No referral</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
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
