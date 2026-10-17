import { useMemo, useState, type FormEvent } from 'react';
import { FileCheck2, Pencil, Plus, Trash2 } from 'lucide-react';
import { COVERAGE_LABELS, type CoverageType, type MarketQuote, type PolicyBusinessType, type PolicyRecord } from '../../types';
import { Badge, Button, ConfirmDialog, Modal, OverflowMenu } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { useAccountRenewals } from '../../hooks/useAccountRenewals';
import { formatShortDate, todayKey } from '../../services/workflow/dates';
import { activePolicies, centsInput, checkPolicy, formatCents, oneYearAfter, parseMoneyCents, policiesFeatureEnabled, policyRows, policyTotalCents, type PolicyInput } from '../../services/workflow/policies';
import { inputClass, labelClass } from './formStyles';

/**
 * The policies written from one market (Carrier 103 Phase 1). Shown on a bound market — or on a
 * market that has policies but was later moved off "Bound", so nothing silently disappears. No
 * commission here: only policy number, carrier, dates and net premium / taxes / fees.
 */
export function PoliciesSection({ accountId, quote }: { accountId: string; quote: MarketQuote }) {
  const removePolicy = useAccountsStore((s) => s.removePolicy);
  const [editing, setEditing] = useState<PolicyRecord | 'new' | null>(null);
  const [removing, setRemoving] = useState<PolicyRecord | null>(null);
  const policies = activePolicies(quote);
  if (!policiesFeatureEnabled() || (quote.status !== 'bound' && policies.length === 0)) return null;

  return (
    <div className="mt-4 rounded-lg border border-[var(--color-success-600)]/20 bg-[var(--color-success-100)]/30 px-3 py-3" data-testid={`policies-${quote.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
          Policies{policies.length ? ` (${policies.length})` : ''}
        </p>
        <Button size="sm" variant={policies.length ? 'secondary' : 'primary'} icon={<Plus size={13} />} onClick={() => setEditing('new')}>
          Add policy
        </Button>
      </div>
      {quote.status !== 'bound' && (
        <p className="mt-1.5 text-xs text-[var(--color-warning-600)]">This market is no longer marked Bound. Its policies are kept — remove any that weren’t written.</p>
      )}
      {policies.length === 0 ? (
        <p className="mt-1.5 text-sm text-[var(--color-ink-600)]">Bound — add each policy written: policy number, dates, and net premium, taxes and fees.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {policies.map((p) => (
            <li key={p.id} className="rounded-lg border border-[var(--color-ink-100)] bg-white px-3 py-2.5" data-policy={p.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <FileCheck2 size={15} className="shrink-0 text-[var(--color-success-600)]" aria-hidden />
                    <span className="font-semibold text-[var(--color-ink-900)]" data-field="number">{p.policyNumber ?? 'Number to come'}</span>
                    {!p.policyNumber && <Badge tone="warning">Add number</Badge>}
                    <Badge tone="neutral">{p.businessType === 'renewal' ? 'Renewal' : 'New business'}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
                    {[p.coverage ? COVERAGE_LABELS[p.coverage] : null, p.carrier !== quote.marketName ? `${p.carrier} via ${quote.marketName}` : p.carrier].filter(Boolean).join(' · ')}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-ink-600)]" data-field="dates">
                    Bound {formatShortDate(p.boundDate)}
                    {p.effectiveDate || p.expirationDate ? ` · Term ${formatShortDate(p.effectiveDate)} – ${formatShortDate(p.expirationDate)}` : ''}
                  </p>
                </div>
                <OverflowMenu
                  items={[
                    { key: 'edit', label: 'Edit policy', icon: <Pencil size={14} />, onSelect: () => setEditing(p) },
                    { key: 'remove', label: 'Remove policy', icon: <Trash2 size={14} />, tone: 'danger', onSelect: () => setRemoving(p) },
                  ]}
                />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4" data-field="amounts">
                <Amount label="Net premium" cents={p.netPremiumCents} />
                <Amount label="Taxes" cents={p.taxesCents} />
                <Amount label="Fees" cents={p.feesCents} />
                <Amount label="Total" cents={policyTotalCents(p)} strong />
              </dl>
            </li>
          ))}
        </ul>
      )}

      <PolicyDialog accountId={accountId} quote={quote} editing={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) removePolicy(accountId, quote.id, removing.id);
          setRemoving(null);
        }}
        title="Remove this policy?"
        description={`${removing?.policyNumber ?? 'The policy'} with ${removing?.carrier ?? ''} is removed from this account. The market stays Bound and its quotes are kept; the removal is recorded in History.`}
        confirmLabel="Remove policy"
      />
    </div>
  );
}

function Amount({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[var(--color-ink-400)]">{label}</dt>
      <dd className={strong ? 'font-semibold text-[var(--color-ink-900)] tabular-nums' : 'text-[var(--color-ink-700)] tabular-nums'}>{formatCents(cents)}</dd>
    </div>
  );
}

const COVERAGE_OPTIONS = Object.entries(COVERAGE_LABELS) as [CoverageType, string][];

function PolicyDialog({ accountId, quote, editing, onClose }: { accountId: string; quote: MarketQuote; editing: PolicyRecord | 'new' | null; onClose: () => void }) {
  return editing ? <PolicyForm key={editing === 'new' ? 'new' : editing.id} accountId={accountId} quote={quote} editing={editing} onClose={onClose} /> : null;
}

function PolicyForm({ accountId, quote, editing, onClose }: { accountId: string; quote: MarketQuote; editing: PolicyRecord | 'new'; onClose: () => void }) {
  const addPolicy = useAccountsStore((s) => s.addPolicy);
  const updatePolicy = useAccountsStore((s) => s.updatePolicy);
  const accounts = useAccountsStore((s) => s.accounts);
  const allQuotes = useAccountsStore((s) => s.quotes);
  const { effectiveDate } = useAccountWorkflow(accountId);
  // Bound for a tracked renewal: the policy is that renewal's term (the account's date may already be next year's).
  const { renewals } = useAccountRenewals(accountId);
  const boundFor = quote.renewalId ? renewals.find((r) => r.id === quote.renewalId) : undefined;
  const options = quote.options ?? [];
  const existing = useMemo(() => policyRows(accounts, allQuotes, { includeArchived: true }), [accounts, allQuotes]);

  const [f, setF] = useState<PolicyInput>(() => {
    if (editing !== 'new') {
      return {
        quoteOptionId: editing.quoteOptionId ?? '',
        policyNumber: editing.policyNumber ?? '',
        carrier: editing.carrier,
        coverage: editing.coverage ?? '',
        businessType: editing.businessType,
        boundDate: editing.boundDate,
        effectiveDate: editing.effectiveDate ?? '',
        expirationDate: editing.expirationDate ?? '',
        netPremium: centsInput(editing.netPremiumCents),
        taxes: centsInput(editing.taxesCents),
        fees: centsInput(editing.feesCents),
      };
    }
    // A new policy starts from the chosen quote and the account's effective date.
    const chosen = options.find((o) => o.id === quote.selectedOptionId) ?? options.at(-1);
    const premium = chosen?.premium ?? quote.premium;
    const eff = boundFor?.renewalDate ?? effectiveDate ?? '';
    return {
      quoteOptionId: chosen?.id ?? '',
      policyNumber: '',
      carrier: quote.marketName,
      coverage: '',
      businessType: boundFor ? 'renewal' : 'new',
      boundDate: todayKey(),
      effectiveDate: eff,
      expirationDate: eff ? oneYearAfter(eff) : '',
      netPremium: premium ? centsInput(Math.round(premium * 100)) : '',
      taxes: '',
      fees: '',
    };
  });
  const [errors, setErrors] = useState<string[]>([]);
  const check = checkPolicy(f, { existing, editingId: editing === 'new' ? undefined : editing.id });
  const live = (v: string) => {
    const c = parseMoneyCents(v);
    return c === null || Number.isNaN(c) ? 0 : c;
  };
  const total = live(f.netPremium) + live(f.taxes) + live(f.fees);

  const set = <K extends keyof PolicyInput>(key: K, value: PolicyInput[K]) =>
    setF((cur) => {
      const next = { ...cur, [key]: value };
      // Moving the effective date moves a one-year expiration with it (unless it was set to something else).
      if (key === 'effectiveDate' && (!cur.expirationDate || cur.expirationDate === oneYearAfter(cur.effectiveDate))) next.expirationDate = value ? oneYearAfter(value as string) : '';
      // Picking a quote fills the net premium if it's still blank or still that of the previous quote.
      if (key === 'quoteOptionId') {
        const prev = options.find((o) => o.id === cur.quoteOptionId)?.premium;
        const nextPremium = options.find((o) => o.id === value)?.premium;
        if (nextPremium && (!cur.netPremium || (prev && parseMoneyCents(cur.netPremium) === Math.round(prev * 100)))) next.netPremium = centsInput(Math.round(nextPremium * 100));
      }
      return next;
    });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    if (editing === 'new') addPolicy(accountId, quote.id, check.fields);
    else updatePolicy(accountId, quote.id, editing.id, check.fields);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={editing === 'new' ? `Add policy — ${quote.marketName}` : `Edit policy ${editing.policyNumber ?? ''}`.trim()}
      subtitle="Policy details only — commission isn’t calculated here yet."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="policy-form">{editing === 'new' ? 'Add policy' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="policy-form" onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="policy-form">
        {errors.length > 0 && !check.ok && (
          <ul className="rounded-lg border border-[var(--color-danger-600)]/25 bg-[var(--color-danger-100)] px-3 py-2 text-sm text-[var(--color-danger-600)]" role="alert">
            {check.errors.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="policy-number">Policy number</label>
            <input id="policy-number" className={inputClass} value={f.policyNumber} onChange={(e) => set('policyNumber', e.target.value)} placeholder="Leave blank until issued" autoFocus />
          </div>
          <div>
            <label className={labelClass} htmlFor="policy-carrier">Carrier (writing company)</label>
            <input id="policy-carrier" className={inputClass} value={f.carrier} onChange={(e) => set('carrier', e.target.value)} list="market-name-options" />
          </div>
          <div>
            <label className={labelClass} htmlFor="policy-coverage">Coverage</label>
            <select id="policy-coverage" className={inputClass} value={f.coverage} onChange={(e) => set('coverage', e.target.value)}>
              <option value="">—</option>
              {COVERAGE_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="policy-type">New or renewal</label>
            <select id="policy-type" className={inputClass} value={f.businessType} onChange={(e) => set('businessType', e.target.value as PolicyBusinessType)}>
              <option value="new">New business</option>
              <option value="renewal">Renewal</option>
            </select>
          </div>
          {options.length > 0 && (
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="policy-quote">Bound from quote</label>
              <select id="policy-quote" className={inputClass} value={f.quoteOptionId} onChange={(e) => set('quoteOptionId', e.target.value)}>
                <option value="">— Not linked to a quote</option>
                {options.map((o, i) => (
                  <option key={o.id} value={o.id}>
                    {o.label || `Quote ${i + 1}`}
                    {o.premium ? ` — $${o.premium.toLocaleString('en-US')}` : ''}
                    {o.id === quote.selectedOptionId ? ' (chosen)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Dates</legend>
          <div>
            <label className={labelClass} htmlFor="policy-bound">Bound date</label>
            <input id="policy-bound" type="date" className={inputClass} value={f.boundDate} onChange={(e) => set('boundDate', e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="policy-effective">Effective</label>
            <input id="policy-effective" type="date" className={inputClass} value={f.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="policy-expiration">Expiration</label>
            <input id="policy-expiration" type="date" className={inputClass} value={f.expirationDate} onChange={(e) => set('expirationDate', e.target.value)} />
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Premium</legend>
          <div>
            <label className={labelClass} htmlFor="policy-net">Net premium ($)</label>
            <input id="policy-net" inputMode="decimal" className={inputClass} value={f.netPremium} onChange={(e) => set('netPremium', e.target.value)} placeholder="18,750.00" />
          </div>
          <div>
            <label className={labelClass} htmlFor="policy-taxes">Taxes ($)</label>
            <input id="policy-taxes" inputMode="decimal" className={inputClass} value={f.taxes} onChange={(e) => set('taxes', e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className={labelClass} htmlFor="policy-fees">Fees ($)</label>
            <input id="policy-fees" inputMode="decimal" className={inputClass} value={f.fees} onChange={(e) => set('fees', e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <p className={labelClass}>Total</p>
            <p className="px-0.5 py-2 text-sm font-semibold text-[var(--color-ink-900)] tabular-nums" data-testid="policy-total">{formatCents(total)}</p>
          </div>
        </fieldset>
        {check.warnings.length > 0 && (
          <ul className="text-xs text-[var(--color-ink-500)]">
            {check.warnings.map((w) => <li key={w}>• {w}</li>)}
          </ul>
        )}
      </form>
    </Modal>
  );
}
