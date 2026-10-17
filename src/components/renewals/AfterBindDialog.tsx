import { useEffect, useState } from 'react';
import { Button, Modal } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountRenewals } from '../../hooks/useAccountRenewals';
import { formatShortDate, todayKey } from '../../services/workflow/dates';
import { addYears, isRenewalDue, type ResolvedRenewal } from '../../services/workflow/renewals';
import { activePolicies } from '../../services/workflow/policies';
import { RenewalDateFields } from './RenewalDateFields';
import { readRenewalDates, renewalDatesFrom, type RenewalDates } from './renewalForm';
import { cn } from '../../utils/cn';

const OTHER = '__other__';

/**
 * Right after a market is marked bound:
 *  1. Which renewal was it for? (only when renewals are tracked) — only that renewal is closed, so
 *     binding one policy never dismisses another renewal. Skipping leaves every renewal open.
 *  2. Prepare next year's renewal? — nothing is set up unless the broker confirms.
 */
export function AfterBindDialog({ accountId, quoteId, onClose }: { accountId: string; quoteId: string | null; onClose: () => void }) {
  const { account, quotes, renewals, effectiveDate, canManage } = useAccountRenewals(accountId);
  const linkBoundQuote = useAccountsStore((s) => s.linkBoundQuote);
  const prepareNextRenewal = useAccountsStore((s) => s.prepareNextRenewal);
  const quote = quotes.find((q) => q.id === quoteId);
  const tracked = renewals.filter((r) => !r.legacy);
  const openTracked = tracked.filter((r) => r.status === 'open');

  const [step, setStep] = useState<'link' | 'next' | null>(null);
  const [choice, setChoice] = useState('');
  const [from, setFrom] = useState<ResolvedRenewal | null>(null);
  const [dates, setDates] = useState<RenewalDates>({ renewalDate: '', startDate: '' });
  const [tried, setTried] = useState(false);
  const [message, setMessage] = useState('');

  // Decide the first step once per bound market.
  useEffect(() => {
    if (!quoteId) return setStep(null);
    setTried(false);
    setMessage('');
    if (openTracked.length > 0) {
      // Preselect the only renewal, or the only one being worked on now (next year's further out isn't it).
      const due = openTracked.filter((r) => isRenewalDue(r, todayKey()));
      setChoice(quote?.renewalId ?? (openTracked.length === 1 ? openTracked[0].id : due.length === 1 ? due[0].id : ''));
      setStep('link');
    } else if (tracked.length === 0 && canManage) {
      // Not tracking renewals yet: offer next year's from the term just bound.
      offerNext(null);
    } else onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  function offerNext(r: ResolvedRenewal | null) {
    if (r && tracked.some((x) => x.record?.previousRenewalId === r.id)) return onClose();
    const base = r?.renewalDate ?? effectiveDate ?? todayKey();
    // Policies already recorded on the market: next year's renewal is when the first of them expires.
    const expires = quote ? activePolicies(quote).map((p) => p.expirationDate).filter((d): d is string => !!d).sort()[0] : undefined;
    setFrom(r);
    setDates(renewalDatesFrom(expires ?? addYears(base, 1), r?.leadDays ?? 45));
    setStep('next');
  }

  function confirmLink() {
    if (!quoteId || !choice) return;
    if (choice === OTHER) {
      linkBoundQuote(accountId, quoteId, null);
      return onClose();
    }
    linkBoundQuote(accountId, quoteId, choice);
    const r = openTracked.find((x) => x.id === choice) ?? null;
    if (canManage && r) offerNext(r);
    else onClose();
  }

  function confirmNext() {
    setTried(true);
    const read = readRenewalDates(dates);
    if (!read.ok || !quoteId) return;
    const res = prepareNextRenewal(accountId, { fromRenewalId: from?.id, quoteId, renewalDate: read.renewalDate, leadDays: read.leadDays });
    if (!res.ok) return setMessage(res.message ?? 'Could not set up next year’s renewal.');
    onClose();
  }

  if (!account || !quote || !step) return null;
  const mainNext = !from || from.main;

  if (step === 'link') {
    return (
      <Modal
        open
        onClose={onClose}
        title={`${quote.marketName} is bound`}
        subtitle="Which renewal was this for? Only that renewal is marked renewed — the others keep their reminders."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Decide later
            </Button>
            <Button onClick={confirmLink} disabled={!choice}>
              Confirm
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Which renewal" data-testid="bind-renewal-choice">
          {openTracked.map((r) => (
            <Choice key={r.id} on={choice === r.id} onClick={() => setChoice(r.id)} title={`${r.label ? `${r.label} — ` : ''}Renewal effective ${formatShortDate(r.renewalDate)}`} hint={r.main ? 'The account’s renewal' : undefined} />
          ))}
          <Choice on={choice === OTHER} onClick={() => setChoice(OTHER)} title="Another policy — not one of these renewals" hint="New coverage; every renewal above stays open" />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Prepare next year’s renewal?"
      subtitle={`${quote.marketName} is bound${from?.renewalDate ? ` for the renewal effective ${formatShortDate(from.renewalDate)}` : ''}. Nothing is set up unless you confirm.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button onClick={confirmNext}>Prepare renewal</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3" data-testid="next-renewal">
        <RenewalDateFields idPrefix="next-renewal" value={dates} onChange={setDates} showErrors={tried} />
        <p className="text-xs text-[var(--color-ink-500)]">
          {mainNext
            ? 'This sets the account’s Renewal / effective date to the new date. This year’s renewal stays in the account’s history.'
            : `Tracks ${from?.label ?? 'this policy'}’s next renewal separately from the account’s other renewals.`}
        </p>
        {message && (
          <p className="text-xs text-[var(--color-danger-600)]" role="alert">
            {message}
          </p>
        )}
      </div>
    </Modal>
  );
}

function Choice({ on, onClick, title, hint }: { on: boolean; onClick: () => void; title: string; hint?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn('rounded-lg border px-3 py-2 text-left cursor-pointer', on ? 'border-[var(--color-brand-500)] ring-2 ring-[var(--color-brand-500)]/15' : 'border-[var(--color-ink-200)] hover:border-[var(--color-ink-300)]')}
    >
      <span className="block text-sm font-medium text-[var(--color-ink-900)]">{title}</span>
      {hint && <span className="block text-xs text-[var(--color-ink-500)]">{hint}</span>}
    </button>
  );
}
