import { useState } from 'react';
import { CalendarSync, Pencil, Plus } from 'lucide-react';
import { BUSINESS_TYPE_LABELS } from '../../types';
import { Badge, Button, Card, CardBody, type BadgeTone } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountRenewals } from '../../hooks/useAccountRenewals';
import { formatShortDate, todayKey } from '../../services/workflow/dates';
import { renewalPhase, type ResolvedRenewal } from '../../services/workflow/renewals';
import { RenewalDateFields } from './RenewalDateFields';
import { readRenewalDates, renewalDatesFrom, EMPTY_RENEWAL_DATES, type RenewalDates } from './renewalForm';
import { inputClass, labelClass, linkButtonClass } from '../workspace/formStyles';

type Editing = { kind: 'track-main' } | { kind: 'add-other' } | { kind: 'edit'; id: string } | null;

/**
 * The account's renewals: new venture or renewal, each renewal's date, when work on it starts, and
 * where it stands. The assigned broker (or an admin) changes them; anyone else on the account sees them.
 */
export function RenewalsCard({ accountId }: { accountId: string }) {
  const { account, quotes, renewals, effectiveDate, canManage } = useAccountRenewals(accountId);
  const setBusinessType = useAccountsStore((s) => s.setBusinessType);
  const trackRenewal = useAccountsStore((s) => s.trackRenewal);
  const editRenewal = useAccountsStore((s) => s.editRenewal);
  const setNotRenewing = useAccountsStore((s) => s.setRenewalNotRenewing);
  const removeRenewal = useAccountsStore((s) => s.removeRenewal);
  const [editing, setEditing] = useState<Editing>(null);
  const [dates, setDates] = useState<RenewalDates>(EMPTY_RENEWAL_DATES);
  const [label, setLabel] = useState('');
  const [tried, setTried] = useState(false);
  if (!account) return null;

  const today = todayKey();
  const open = renewals.filter((r) => r.status === 'open');
  const closed = renewals.filter((r) => r.status !== 'open');
  const legacy = renewals.find((r) => r.legacy);
  const marketName = (id?: string) => quotes.find((q) => q.id === id)?.marketName;

  function start(next: Editing, r?: ResolvedRenewal) {
    setEditing(next);
    setTried(false);
    setLabel(r?.label ?? '');
    setDates(r ? renewalDatesFrom(r.renewalDate, r.leadDays) : next?.kind === 'track-main' ? { renewalDate: effectiveDate ?? '', startDate: '' } : EMPTY_RENEWAL_DATES);
  }

  function save() {
    setTried(true);
    const read = readRenewalDates(dates);
    if (!read.ok || !editing) return;
    if (editing.kind === 'track-main') trackRenewal(accountId, { main: true, renewalDate: read.renewalDate, leadDays: read.leadDays });
    if (editing.kind === 'add-other') {
      if (!label.trim()) return;
      trackRenewal(accountId, { renewalDate: read.renewalDate, leadDays: read.leadDays, label });
    }
    if (editing.kind === 'edit') editRenewal(accountId, editing.id, { renewalDate: read.renewalDate, leadDays: read.leadDays, ...(renewals.find((r) => r.id === editing.id)?.main ? {} : { label }) });
    setEditing(null);
  }

  const form = editing && (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-dashed border-[var(--color-ink-200)] p-3" data-testid="renewal-form">
      {(editing.kind === 'add-other' || (editing.kind === 'edit' && !renewals.find((r) => r.id === editing.id)?.main)) && (
        <div>
          <label className={labelClass} htmlFor="renewal-label">
            Which policy? <span className="text-[var(--color-danger-600)]">*</span>
          </label>
          <input id="renewal-label" value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} placeholder="e.g. Cargo — Summit Casualty" />
          {tried && !label.trim() && <p className="mt-1 text-xs text-[var(--color-danger-600)]">Say which policy this renewal is for.</p>}
        </div>
      )}
      {(editing.kind === 'track-main' || (editing.kind === 'edit' && renewals.find((r) => r.id === editing.id)?.main)) && (
        <p className="text-xs text-[var(--color-ink-500)]">This is the account’s Renewal / effective date — changing it here changes it everywhere.</p>
      )}
      <RenewalDateFields idPrefix="renewal-edit" value={dates} onChange={setDates} showErrors={tried} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          Cancel
        </Button>
        <Button size="sm" onClick={save}>
          {editing.kind === 'edit' ? 'Save' : 'Track renewal'}
        </Button>
      </div>
    </div>
  );

  return (
    <Card data-testid="renewals-card">
      <CardBody className="pt-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
            <CalendarSync size={16} className="text-[var(--color-ink-500)]" />
            Renewal
          </h3>
          {account.businessType ? (
            <Badge tone={account.businessType === 'renewal' ? 'info' : 'brand'} data-testid="business-type">
              {BUSINESS_TYPE_LABELS[account.businessType]}
            </Badge>
          ) : (
            canManage && (
              <span className="flex gap-1">
                <button className={linkButtonClass} onClick={() => setBusinessType(accountId, 'new_venture')}>
                  New venture
                </button>
                <button className={linkButtonClass} onClick={() => start({ kind: 'track-main' })}>
                  Renewal
                </button>
              </span>
            )
          )}
        </div>

        {legacy && (
          <div className="mt-3 text-sm" data-testid="renewal-legacy">
            <p className="font-medium text-[var(--color-ink-900)]">Renewal effective {formatShortDate(legacy.renewalDate)}</p>
            <p className="text-xs text-[var(--color-ink-500)]">
              {legacy.status === 'bound' ? 'A market is bound.' : `Reminder ${legacy.leadDays} days before (the standard reminder).`}
              {canManage && legacy.status === 'open' && ' Track it to choose when work starts.'}
            </p>
            {canManage && legacy.status === 'open' && !editing && (
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => start({ kind: 'track-main' })}>
                Track this renewal
              </Button>
            )}
          </div>
        )}

        {!legacy && renewals.length === 0 && (
          <p className="mt-3 text-sm text-[var(--color-ink-500)]" data-testid="renewal-empty">
            {account.businessType === 'new_venture'
              ? 'New venture — once a market is bound, you’ll be offered next year’s renewal.'
              : 'No renewal date yet.'}
          </p>
        )}

        {!legacy && renewals.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2" data-testid="renewal-list">
            {[...open, ...closed.slice(-2)].map((r) => (
              <li key={r.id} className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2" data-renewal={r.id} data-status={r.status}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-ink-900)]">
                      {r.label ? `${r.label} · ` : ''}
                      {r.renewalDate ? `Renews ${formatShortDate(r.renewalDate)}` : 'Renewal date not set'}
                    </p>
                    <p className="text-xs text-[var(--color-ink-500)]">
                      {r.status === 'open' && r.workStart ? `Start working ${formatShortDate(r.workStart)} · ${r.leadDays} days before` : null}
                      {r.status === 'bound' ? `Bound${marketName(r.boundQuoteId) ? ` with ${marketName(r.boundQuoteId)}` : ''}` : null}
                      {r.status === 'not_renewing' ? 'Not renewing' : null}
                    </p>
                  </div>
                  <PhaseBadge r={r} today={today} />
                </div>
                {canManage && !editing && (
                  <div className="mt-1 flex flex-wrap gap-x-1">
                    {r.status === 'open' && (
                      <button className={linkButtonClass} onClick={() => start({ kind: 'edit', id: r.id }, r)}>
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                    {r.status === 'open' && (
                      <button className={linkButtonClass} onClick={() => setNotRenewing(accountId, r.id, true)}>
                        Not renewing
                      </button>
                    )}
                    {r.status === 'not_renewing' && (
                      <button className={linkButtonClass} onClick={() => setNotRenewing(accountId, r.id, false)}>
                        Track again
                      </button>
                    )}
                    {r.status === 'open' && !r.main && (
                      <button className={linkButtonClass} onClick={() => removeRenewal(accountId, r.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {form}

        {canManage && !editing && !legacy && (
          <div className="mt-2 flex flex-wrap gap-x-1">
            {renewals.length === 0 && account.businessType && (
              <button className={linkButtonClass} onClick={() => start({ kind: 'track-main' })}>
                <Plus size={12} /> {account.businessType === 'renewal' ? 'Set the renewal date' : 'Track a renewal'}
              </button>
            )}
            {renewals.length > 0 && (
              <button className={linkButtonClass} onClick={() => start({ kind: 'add-other' })} data-testid="add-other-renewal">
                <Plus size={12} /> Another policy renewing on another date
              </button>
            )}
          </div>
        )}
        {!canManage && (
          <p className="mt-3 text-xs text-[var(--color-ink-400)]" data-testid="renewal-read-only">
            The assigned agent or an admin sets up renewals.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

const PHASE: Record<string, { label: (r: ResolvedRenewal) => string; tone: BadgeTone }> = {
  no_date: { label: () => 'No date', tone: 'neutral' },
  not_started: { label: (r) => `Starts ${formatShortDate(r.workStart)}`, tone: 'neutral' },
  working: { label: () => 'Working on it', tone: 'info' },
  overdue: { label: () => 'Past renewal date', tone: 'danger' },
};

function PhaseBadge({ r, today }: { r: ResolvedRenewal; today: string }) {
  if (r.status === 'bound') return <Badge tone="success">Renewed</Badge>;
  if (r.status === 'not_renewing') return <Badge tone="neutral">Not renewing</Badge>;
  const p = PHASE[renewalPhase(r, today)];
  return (
    <Badge tone={p.tone} className="shrink-0" data-testid="renewal-phase">
      {p.label(r)}
    </Badge>
  );
}
