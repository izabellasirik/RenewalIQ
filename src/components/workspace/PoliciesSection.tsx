import { useMemo, useState, type FormEvent } from 'react';
import { FileCheck2, FilePlus2, FileWarning, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { MarketQuote, PolicyBusinessType, PolicyEntryKind, PolicyRecord } from '../../types';
import { Badge, Button, ConfirmDialog, Modal, OverflowMenu } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountRenewals } from '../../hooks/useAccountRenewals';
import { useAgentCommission, type CommissionView } from '../../hooks/useAgentCommission';
import { useCarrierRates } from '../../hooks/useCarrierRates';
import { formatShortDate } from '../../services/workflow/dates';
import { DEFAULT_CARRIER_RATE, activeEndorsements, activePolicies, centsInput, checkPolicy, formatCents, parseMoneyCents, policiesFeatureEnabled, policyRows, policyTotalCents, type PolicyInput } from '../../services/workflow/policies';
import { policyNumberTaken } from '../../services/supabase/commissionRepo';
import { inputClass, labelClass } from './formStyles';

const KIND = {
  policy: { one: 'policy', title: 'Policies', add: 'Add policy', date: 'Bound date', dated: 'Bound' },
  endorsement: { one: 'endorsement', title: 'Endorsements', add: 'Add endorsement', date: 'Endorsed date', dated: 'Endorsed' },
} as const;

/**
 * The policies written from one market, and its endorsements. Policies show on a bound market,
 * endorsements on an endorsed one — or wherever some were recorded before the market moved off that
 * status, flagged, so nothing silently disappears. Each one carries its documents (binder, policy,
 * endorsement page), each with a description; until it has one, it's marked "Missing Documents". The agent's commission shows only
 * to that agent and the agency's admins, worked out from the net amount (never stored here).
 */
export function PoliciesSection({ accountId, quote }: { accountId: string; quote: MarketQuote }) {
  const commission = useAgentCommission(accountId);
  if (!policiesFeatureEnabled()) return null;
  const bound = quote.status === 'bound';
  return (
    <>
      <EntryList accountId={accountId} quote={quote} kind="policy" entries={activePolicies(quote)} active={bound} commission={commission} />
      <EntryList accountId={accountId} quote={quote} kind="endorsement" entries={activeEndorsements(quote)} active={bound && !!quote.endorsed} commission={commission} />
    </>
  );
}

function EntryList({ accountId, quote, kind, entries, active, commission }: { accountId: string; quote: MarketQuote; kind: PolicyEntryKind; entries: PolicyRecord[]; active: boolean; commission: CommissionView }) {
  const removePolicy = useAccountsStore((s) => s.removePolicy);
  const [editing, setEditing] = useState<PolicyRecord | 'new' | null>(null);
  const [removing, setRemoving] = useState<PolicyRecord | null>(null);
  const k = KIND[kind];
  if (!active && entries.length === 0) return null;
  const tone = kind === 'policy' ? 'border-[var(--color-success-600)]/20 bg-[var(--color-success-100)]/30' : 'border-[var(--color-info-600)]/20 bg-[var(--color-info-100)]/30';

  return (
    <div className={`mt-4 rounded-lg border px-3 py-3 ${tone}`} data-testid={`${kind === 'policy' ? 'policies' : 'endorsements'}-${quote.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
          {k.title}
          {entries.length ? ` (${entries.length})` : ''}
        </p>
        {active && (
          <Button size="sm" variant={entries.length ? 'secondary' : 'primary'} icon={<Plus size={13} />} onClick={() => setEditing('new')}>
            {k.add}
          </Button>
        )}
      </div>
      {!active && (
        <p className="mt-1.5 text-xs text-[var(--color-warning-600)]">
          This market is no longer marked {kind === 'policy' ? 'Bound' : 'Endorsed'}. Its {k.title.toLowerCase()} are kept — remove any that weren’t written.
        </p>
      )}
      {entries.length === 0 ? (
        <p className="mt-1.5 text-sm text-[var(--color-ink-600)]">
          {kind === 'policy' ? 'Bound — add each policy written: policy number, dates, and net premium, taxes and fees.' : 'Endorsed — add each endorsement: date, policy number, and the change in net premium, taxes and fees.'}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {entries.map((p) => (
            <EntryItem key={p.id} accountId={accountId} quote={quote} entry={p} commission={commission} onEdit={() => setEditing(p)} onRemove={() => setRemoving(p)} />
          ))}
        </ul>
      )}

      {editing && <EntryForm key={editing === 'new' ? 'new' : editing.id} accountId={accountId} quote={quote} kind={kind} editing={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) removePolicy(accountId, quote.id, removing.id);
          setRemoving(null);
        }}
        title={`Remove this ${k.one}?`}
        description={`${removing?.policyNumber ?? `The ${k.one}`} with ${removing?.carrier ?? ''} is removed from this account. The market and its quotes are kept; the removal is recorded in History.`}
        confirmLabel={`Remove ${k.one}`}
      />
    </div>
  );
}

function EntryItem({ accountId, quote, entry: p, commission, onEdit, onRemove }: { accountId: string; quote: MarketQuote; entry: PolicyRecord; commission: CommissionView; onEdit: () => void; onRemove: () => void }) {
  const kind: PolicyEntryKind = p.kind === 'endorsement' ? 'endorsement' : 'policy';
  const k = KIND[kind];
  const files = p.attachments ?? [];
  const carrierRates = useCarrierRates();
  return (
    <li className="rounded-lg border border-[var(--color-ink-100)] bg-white px-3 py-2.5" data-policy={p.id} data-kind={kind}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <FileCheck2 size={15} className="shrink-0 text-[var(--color-success-600)]" aria-hidden />
            <span className="font-semibold text-[var(--color-ink-900)]" data-field="number">{p.policyNumber ?? 'Number to come'}</span>
            {!p.policyNumber && <Badge tone="warning">Add number</Badge>}
            {kind === 'policy' && <Badge tone="neutral">{p.businessType === 'renewal' ? 'Renewal' : 'New business'}</Badge>}
            {files.length === 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-100)] px-2 py-0.5 text-xs font-medium text-[var(--color-warning-600)]" data-testid="documents-missing">
                <FileWarning size={12} aria-hidden /> Missing Documents
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{p.carrier !== quote.marketName ? `${p.carrier} via ${quote.marketName}` : p.carrier}</p>
          <p className="mt-1 text-xs text-[var(--color-ink-600)]" data-field="dates">
            {k.dated} {formatShortDate(p.boundDate)}
            {p.effectiveDate || p.expirationDate ? ` · Term ${formatShortDate(p.effectiveDate)} – ${formatShortDate(p.expirationDate)}` : ''}
          </p>
        </div>
        <OverflowMenu
          items={[
            { key: 'edit', label: `Edit ${k.one}`, icon: <Pencil size={14} />, onSelect: onEdit },
            { key: 'remove', label: `Remove ${k.one}`, icon: <Trash2 size={14} />, tone: 'danger', onSelect: onRemove },
          ]}
        />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4" data-field="amounts">
        <Amount label="Net premium" cents={p.netPremiumCents} />
        <Amount label="Taxes" cents={p.taxesCents} />
        <Amount label="Fees" cents={p.feesCents} />
        <Amount label="Total" cents={policyTotalCents(p)} strong />
      </dl>
      <CommissionLine commission={commission} netCents={p.netPremiumCents} carrierRate={carrierRates.rateOf(accountId, p.id)} />
      {p.notes && <p className="mt-1.5 whitespace-pre-line text-xs text-[var(--color-ink-600)]" data-field="notes">{p.notes}</p>}
      <div className="mt-2 flex flex-col gap-1 text-xs" data-field="documents">
        {files.map((f) => (
          <span key={f.id} className="inline-flex items-center gap-1.5 text-[var(--color-ink-700)]" data-attachment={f.id}>
            <Paperclip size={12} className="shrink-0 text-[var(--color-ink-400)]" aria-hidden />
            <span className="font-medium">{f.name}</span>
            {f.description && <span className="text-[var(--color-ink-500)]">— {f.description}</span>}
          </span>
        ))}
        <button type="button" onClick={onEdit} className="inline-flex w-fit cursor-pointer items-center gap-1 font-medium text-[var(--color-brand-700)] hover:underline">
          <FilePlus2 size={12} aria-hidden /> Attach Document
        </button>
      </div>
    </li>
  );
}

/** "Agent commission (Roman Smith, 30% of the 10% carrier commission): $300.00" — only for the agent and the agency's admins. */
export function CommissionLine({ commission, netCents, carrierRate = DEFAULT_CARRIER_RATE }: { commission: CommissionView; netCents: number; carrierRate?: number }) {
  if (commission.kind === 'hidden') return null;
  const base = 'mt-1.5 text-xs';
  if (commission.kind === 'no_agent') return <p className={`${base} text-[var(--color-ink-500)]`} data-field="commission">Agent commission: No agent assigned</p>;
  if (commission.kind === 'no_rate') return <p className={`${base} text-[var(--color-ink-500)]`} data-field="commission">Agent commission: no commission % set for {commission.agentName} (an admin sets it on the Team page)</p>;
  if (commission.kind === 'unavailable') return <p className={`${base} text-[var(--color-ink-500)]`} data-field="commission">Agent commission: {commission.message}</p>;
  return (
    <p className={`${base} text-[var(--color-ink-700)]`} data-field="commission">
      Agent commission ({commission.agentName}, {formatRate(commission.rate)} of the {formatRate(carrierRate)} carrier commission): <strong className="tabular-nums text-[var(--color-ink-900)]">{formatCents(commission.cents(netCents, carrierRate))}</strong>
    </p>
  );
}

export function formatRate(rate: number): string {
  return `${(Math.round(rate * 1e6) / 1e4).toLocaleString('en-US', { maximumFractionDigits: 4 })}%`;
}

function Amount({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[var(--color-ink-400)]">{label}</dt>
      <dd className={strong ? 'font-semibold text-[var(--color-ink-900)] tabular-nums' : 'text-[var(--color-ink-700)] tabular-nums'}>{formatCents(cents)}</dd>
    </div>
  );
}

/**
 * The form for a policy or an endorsement. Also what choosing "Bound" or "Endorsed" opens (`onSaved`
 * then marks the market): it asks for the date, the amounts, an optional proof document and notes,
 * and shows the agent's commission as the net amount is typed.
 */
export function EntryForm({
  accountId,
  quote,
  kind,
  editing,
  onClose,
  onSaved,
  title,
}: {
  accountId: string;
  quote: MarketQuote;
  kind: PolicyEntryKind;
  editing: PolicyRecord | 'new';
  onClose: () => void;
  /** After a new entry is saved (with its date) — used when the form is how the market gets its status. */
  onSaved?: (entry: { id: string; date: string }) => void;
  title?: string;
}) {
  const addPolicy = useAccountsStore((s) => s.addPolicy);
  const updatePolicy = useAccountsStore((s) => s.updatePolicy);
  const attach = useAccountsStore((s) => s.attachPolicyFile);
  const accounts = useAccountsStore((s) => s.accounts);
  const allQuotes = useAccountsStore((s) => s.quotes);
  const commission = useAgentCommission(accountId);
  const carrierRates = useCarrierRates();
  // Bound for a tracked renewal: the policy is that renewal's term (the account's date may already be next year's).
  const { renewals } = useAccountRenewals(accountId);
  const boundFor = quote.renewalId ? renewals.find((r) => r.id === quote.renewalId) : undefined;
  const options = quote.options ?? [];
  const existing = useMemo(() => policyRows(accounts, allQuotes, { includeArchived: true }), [accounts, allQuotes]);
  const k = KIND[kind];

  const [f, setF] = useState<PolicyInput>(() => {
    if (editing !== 'new') {
      return {
        kind,
        notes: editing.notes ?? '',
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
    if (kind === 'endorsement') {
      // An endorsement changes a policy written here: start from that policy's number, carrier and term.
      const policy = activePolicies(quote).at(-1);
      return {
        kind,
        notes: '',
        quoteOptionId: '',
        policyNumber: policy?.policyNumber ?? '',
        carrier: policy?.carrier ?? quote.marketName,
        coverage: '',
        businessType: 'new',
        boundDate: '',
        effectiveDate: '',
        expirationDate: '',
        netPremium: '',
        taxes: '',
        fees: '',
      };
    }
    // A new policy starts from the chosen quote and the account's effective date.
    const chosen = options.find((o) => o.id === quote.selectedOptionId) ?? options.at(-1);
    const premium = chosen?.premium ?? quote.premium;
    return {
      kind,
      notes: '',
      quoteOptionId: chosen?.id ?? '',
      policyNumber: '',
      carrier: quote.marketName,
      coverage: '',
      businessType: boundFor ? 'renewal' : 'new',
      boundDate: '',
      effectiveDate: '',
      expirationDate: '',
      netPremium: premium ? centsInput(Math.round(premium * 100)) : '',
      taxes: '',
      fees: '',
    };
  });
  // New documents, each with a description; and the ones already attached (description edits, removals) — applied on save.
  const [files, setFiles] = useState<{ key: string; file: File; description: string }[]>([]);
  const [kept, setKept] = useState(() => (editing === 'new' ? [] : (editing.attachments ?? []).map((a) => ({ ...a, description: a.description ?? '' }))));
  const describe = useAccountsStore((s) => s.describePolicyAttachment);
  const detach = useAccountsStore((s) => s.removePolicyAttachment);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const check = checkPolicy(f, { existing, editingId: editing === 'new' ? undefined : editing.id });
  const live = (v: string) => {
    const c = parseMoneyCents(v);
    return c === null || Number.isNaN(c) ? 0 : c;
  };
  const total = live(f.netPremium) + live(f.taxes) + live(f.fees);

  const set = <K extends keyof PolicyInput>(key: K, value: PolicyInput[K]) =>
    setF((cur) => {
      const next = { ...cur, [key]: value };
      // Picking a quote fills the net premium if it's still blank or still that of the previous quote.
      if (key === 'quoteOptionId') {
        const prev = options.find((o) => o.id === cur.quoteOptionId)?.premium;
        const nextPremium = options.find((o) => o.id === value)?.premium;
        if (nextPremium && (!cur.netPremium || (prev && parseMoneyCents(cur.netPremium) === Math.round(prev * 100)))) next.netPremium = centsInput(Math.round(nextPremium * 100));
      }
      return next;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    // The same policy on a client this browser can't see (another agent's) — the agency-wide check.
    if (kind === 'policy' && check.fields.policyNumber && (editing === 'new' || editing.policyNumber !== check.fields.policyNumber || editing.carrier !== check.fields.carrier)) {
      setSaving(true);
      const taken = await policyNumberTaken(check.fields.carrier, check.fields.policyNumber, accountId);
      setSaving(false);
      if (taken) {
        setErrors([`Policy ${check.fields.policyNumber} with ${check.fields.carrier} is already recorded on another client in your agency.`]);
        return;
      }
    }
    if (editing === 'new') {
      const id = addPolicy(accountId, quote.id, check.fields);
      if (id) for (const nf of files) attach(accountId, quote.id, id, nf.file, nf.description);
      if (id) onSaved?.({ id, date: check.fields.boundDate });
    } else {
      updatePolicy(accountId, quote.id, editing.id, check.fields);
      for (const a of editing.attachments ?? []) {
        const now = kept.find((x) => x.id === a.id);
        if (!now) detach(accountId, quote.id, editing.id, a.id);
        else if ((a.description ?? '') !== now.description.trim()) describe(accountId, quote.id, editing.id, a.id, now.description);
      }
      for (const nf of files) attach(accountId, quote.id, editing.id, nf.file, nf.description);
    }
    onClose();
  }
  const shownErrors = errors.length > 0 ? (check.ok ? errors : check.errors) : [];

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={title ?? (editing === 'new' ? `${k.add} — ${quote.marketName}` : `Edit ${k.one} ${editing.policyNumber ?? ''}`.trim())}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="policy-form" disabled={saving}>{editing === 'new' ? (onSaved ? `Save and mark ${kind === 'policy' ? 'Bound' : 'Endorsed'}` : k.add) : 'Save changes'}</Button>
        </>
      }
    >
      <form id="policy-form" onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="policy-form">
        {shownErrors.length > 0 && (
          <ul className="rounded-lg border border-[var(--color-danger-600)]/25 bg-[var(--color-danger-100)] px-3 py-2 text-sm text-[var(--color-danger-600)]" role="alert">
            {shownErrors.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="policy-bound">
              {k.date} <Required />
            </label>
            <input id="policy-bound" type="date" className={inputClass} value={f.boundDate} onChange={(e) => set('boundDate', e.target.value)} autoFocus />
          </div>
          <div>
            <label className={labelClass} htmlFor="policy-number">
              Policy number <Required />
            </label>
            <input id="policy-number" className={inputClass} value={f.policyNumber} onChange={(e) => set('policyNumber', e.target.value)} required aria-required="true" />
          </div>
          <div>
            <label className={labelClass} htmlFor="policy-carrier">
              Carrier (writing company) <Required />
            </label>
            <input id="policy-carrier" className={inputClass} value={f.carrier} onChange={(e) => set('carrier', e.target.value)} list="market-name-options" />
          </div>
          {kind === 'policy' && (
            <div>
              <label className={labelClass} htmlFor="policy-type">New or renewal</label>
              <select id="policy-type" className={inputClass} value={f.businessType} onChange={(e) => set('businessType', e.target.value as PolicyBusinessType)}>
                <option value="new">New business</option>
                <option value="renewal">Renewal</option>
              </select>
            </div>
          )}
          {kind === 'policy' && options.length > 0 && (
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

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Term</legend>
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
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">{kind === 'policy' ? 'Premium' : 'Premium change'}</legend>
          <div>
            <label className={labelClass} htmlFor="policy-net">
              Net amount ($) <Required />
            </label>
            <input id="policy-net" inputMode="decimal" className={inputClass} value={f.netPremium} onChange={(e) => set('netPremium', e.target.value)} placeholder={kind === 'policy' ? '18,750.00' : '1,250.00 or -1,250.00'} />
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
          <div className="sm:col-span-4" data-testid="form-commission">
            <CommissionLine commission={commission} netCents={live(f.netPremium)} carrierRate={editing === 'new' ? DEFAULT_CARRIER_RATE : carrierRates.rateOf(accountId, editing.id)} />
          </div>
        </fieldset>

        <div>
          <p className={labelClass}>Documents</p>
          {(kept.length > 0 || files.length > 0) && (
            <ul className="mb-2 flex flex-col gap-2" data-testid="form-documents">
              {kept.map((a) => (
                <li key={a.id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--color-ink-700)]">
                    <Paperclip size={13} className="shrink-0 text-[var(--color-ink-400)]" aria-hidden />
                    <span className="truncate">{a.name}</span>
                  </span>
                  <input className={inputClass} value={a.description} placeholder="Description, e.g. Binder" aria-label={`Description for ${a.name}`} onChange={(e) => setKept((list) => list.map((x) => (x.id === a.id ? { ...x, description: e.target.value } : x)))} />
                  <button type="button" className="cursor-pointer justify-self-start p-1 text-[var(--color-ink-400)] hover:text-[var(--color-danger-600)]" aria-label={`Remove ${a.name}`} onClick={() => setKept((list) => list.filter((x) => x.id !== a.id))}>
                    <X size={15} />
                  </button>
                </li>
              ))}
              {files.map((nf) => (
                <li key={nf.key} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--color-ink-700)]">
                    <Paperclip size={13} className="shrink-0 text-[var(--color-ink-400)]" aria-hidden />
                    <span className="truncate">{nf.file.name}</span>
                  </span>
                  <input className={inputClass} value={nf.description} placeholder="Description, e.g. Binder" aria-label={`Description for ${nf.file.name}`} onChange={(e) => setFiles((list) => list.map((x) => (x.key === nf.key ? { ...x, description: e.target.value } : x)))} />
                  <button type="button" className="cursor-pointer justify-self-start p-1 text-[var(--color-ink-400)] hover:text-[var(--color-danger-600)]" aria-label={`Remove ${nf.file.name}`} onClick={() => setFiles((list) => list.filter((x) => x.key !== nf.key))}>
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor="policy-attach" className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--color-ink-800)] hover:bg-[var(--color-ink-50)]">
            <FilePlus2 size={14} aria-hidden /> Attach Document
          </label>
          <input
            id="policy-attach"
            type="file"
            multiple
            className="sr-only"
            accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx,.xls,.xlsx,.eml,.msg"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []).map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, description: '' }));
              setFiles((list) => [...list, ...picked]);
              e.target.value = '';
            }}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="policy-notes">Notes</label>
          <textarea id="policy-notes" rows={3} className={inputClass} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {check.warnings.length > 0 && (
          <ul className="text-xs text-[var(--color-ink-500)]">
            {check.warnings.map((w) => <li key={w}>• {w}</li>)}
          </ul>
        )}
      </form>
    </Modal>
  );
}

/** Marks a field the form won't save without. */
function Required() {
  return (
    <span className="text-[var(--color-danger-600)]" aria-hidden>
      *
    </span>
  );
}
