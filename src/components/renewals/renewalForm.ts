import type { AccountBusinessType } from '../../types';
import type { NewAccountSetup } from '../../state/useAccountsStore';
import { addDays } from '../../services/workflow/dates';
import { DEFAULT_LEAD_DAYS, checkRenewalInput, leadDaysFor, type ResolvedRenewal } from '../../services/workflow/renewals';

/** Form values and helpers shared by the renewal forms (New Submission, the Renewal card, after binding). */

export interface RenewalDates {
  renewalDate: string;
  /** Empty = the default, 45 days before the renewal date. */
  startDate: string;
}

export const EMPTY_RENEWAL_DATES: RenewalDates = { renewalDate: '', startDate: '' };

/** The renewal date and lead days a form's values stand for, or what's wrong with them. */
export function readRenewalDates(v: RenewalDates): { ok: true; renewalDate: string; leadDays: number } | { ok: false; errors: string[] } {
  const errors = checkRenewalInput(v);
  if (errors.length) return { ok: false, errors };
  const leadDays = v.startDate ? leadDaysFor(v.renewalDate, v.startDate) : DEFAULT_LEAD_DAYS;
  return leadDays === null ? { ok: false, errors: ['Start working on or before the renewal date.'] } : { ok: true, renewalDate: v.renewalDate, leadDays };
}

/** Form values for a renewal already being tracked. */
export function renewalDatesFrom(renewalDate: string | null, leadDays: number): RenewalDates {
  return { renewalDate: renewalDate ?? '', startDate: renewalDate && leadDays !== DEFAULT_LEAD_DAYS ? addDays(renewalDate, -leadDays) : '' };
}

export interface NewAccountTypeValue extends RenewalDates {
  businessType: AccountBusinessType | '';
}

export const EMPTY_ACCOUNT_TYPE: NewAccountTypeValue = { businessType: '', renewalDate: '', startDate: '' };

/** The setup to create the account with, or null while something required is missing. */
export function readAccountType(v: NewAccountTypeValue): NewAccountSetup | null {
  if (v.businessType === 'new_venture') return { businessType: 'new_venture' };
  if (v.businessType !== 'renewal') return null;
  const dates = readRenewalDates(v);
  return dates.ok ? { businessType: 'renewal', renewalDate: dates.renewalDate, leadDays: dates.leadDays } : null;
}

/** Whether binding a market on this account should ask about renewals (anything renewal-related on it). */
export function bindAsksAboutRenewal(renewals: ResolvedRenewal[], businessType?: string): boolean {
  return renewals.length > 0 || !!businessType;
}

