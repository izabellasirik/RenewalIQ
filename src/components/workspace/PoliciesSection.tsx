import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Ban, Undo2, FileCheck2, FilePlus2, FileWarning, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { MarketQuote, PolicyEntryKind, PolicyRecord } from '../../types';
import { Badge, Button, ConfirmDialog, Modal, OverflowMenu } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountRenewals } from '../../hooks/useAccountRenewals';
import { useAgentCommission, type CommissionView } from '../../hooks/useAgentCommission';
import { useBrokerFeeShare, type BrokerFeeShareView } from '../../hooks/useBrokerFeeShare';
import { referralLabel, useReferralSources } from '../../hooks/useReferralSources';
import { ReferralPicker } from '../referrals/ReferralPicker';
import { reloadOtherReferrals, useOtherReferrals } from '../../hooks/useOtherReferrals';
import { OTHER_REFERRAL, setOtherReferral, type OtherReferral } from '../../services/supabase/partnersRepo';
import { formatDateWithYear, formatShortDate } from '../../services/workflow/dates';
import { cancellationState, reloadPolicyCancellations, usePolicyCancellations } from '../../hooks/usePolicyCancellations';
import { declineCancellationUndo, rejectCancellation, undoCancellation, type PolicyCancellation } from '../../services/supabase/ledgerRepo';
import { activeEndorsements, activePolicies, agentCommissionCents, centsInput, checkPolicy, formatCents, oneYearAfter, parseCarrierPercent, parseMoneyCents, policiesFeatureEnabled, policyRows, policyTotalCents, type PolicyInput } from '../../services/workflow/policies';
import { enterPolicyCarrierRate, fetchEnteredCarrierRates, policyNumberTaken } from '../../services/supabase/commissionRepo';
import { isSupabaseConfigured } from '../../services/supabase/client';
import { generateId } from '../../utils/id';
import { useAccountCommissionStatuses } from '../../hooks/useLedger';
import type { AccountCommissionStatus } from '../../services/supabase/ledgerRepo';
import { FLAG_LABELS, payoutWords } from '../../services/finance/ledger';
import { CancellationRequestDialog } from '../finance/CancellationRequestDialog';
import { UNDO_SECONDS, removalKey, scheduleRemoval, undoRemoval, usePendingRemovals, type PendingRemoval } from '../../state/pendingRemovals';
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
 * to that agent and the agency's admins: once the database has recorded it (0064), the amount frozen in
 * that record and its status (Missing Document → Pending Verification → Verified); before, worked out from
 * the net amount (never stored here). A recorded policy's agent can request its cancellation here.
 */
export function PoliciesSection({ accountId, quote }: { accountId: string; quote: MarketQuote }) {
  const commission = useAgentCommission(accountId);
  const records = useAccountCommissionStatuses(accountId);
  // Deleted, still in their Undo window: shown in their place as "Deleted · Undo".
  const pending = new Map(usePendingRemovals().map((r) => [r.key, r]));
  if (!policiesFeatureEnabled()) return null;
  const bound = quote.status === 'bound';
  const policies = activePolicies(quote);
  const endorsements = activeEndorsements(quote);
  const livePolicies = policies.filter((p) => !pending.has(removalKey(accountId, p.id)));
  return (
    <>
      <EntryList accountId={accountId} quote={quote} kind="policy" entries={policies} pending={pending} active={bound} commission={commission} records={records.byPolicy} onRecordsChanged={records.reload} canEndorse={bound && livePolicies.length > 0} />
      {/* Endorsements are part of a policy: added with "Add endorsement" next to "Add policy"; the market stays Bound. */}
      <EntryList accountId={accountId} quote={quote} kind="endorsement" entries={endorsements} pending={pending} active={bound && endorsements.length > 0} commission={commission} records={records.byPolicy} onRecordsChanged={records.reload} hideAdd />
    </>
  );
}

function EntryList({ accountId, quote, kind, entries, pending, active, commission, records, onRecordsChanged, canEndorse = false, hideAdd = false }: { accountId: string; quote: MarketQuote; kind: PolicyEntryKind; entries: PolicyRecord[]; pending: Map<string, PendingRemoval>; active: boolean; commission: CommissionView; records: Map<string, AccountCommissionStatus>; onRecordsChanged: () => void; canEndorse?: boolean; hideAdd?: boolean }) {
  const removePolicy = useAccountsStore((s) => s.removePolicy);
  const [editing, setEditing] = useState<PolicyRecord | 'new' | null>(null);
  const [endorsing, setEndorsing] = useState(false);
  const cancellations = usePolicyCancellations(accountId);
  const [removing, setRemoving] = useState<PolicyRecord | null>(null);
  const [cancelling, setCancelling] = useState<{ entry: PolicyRecord; record: AccountCommissionStatus } | null>(null);
  const k = KIND[kind];
  const liveCount = entries.filter((p) => !pending.has(removalKey(accountId, p.id))).length;
  if (!active && entries.length === 0) return null;
  const tone = kind === 'policy' ? 'border-[var(--color-success-600)]/20 bg-[var(--color-success-100)]/30' : 'border-[var(--color-info-600)]/20 bg-[var(--color-info-100)]/30';

  return (
    <div className={`mt-4 rounded-lg border px-3 py-3 ${tone}`} data-testid={`${kind === 'policy' ? 'policies' : 'endorsements'}-${quote.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
          {k.title}
          {liveCount ? ` (${liveCount})` : ''}
        </p>
        {active && !hideAdd && (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant={liveCount ? 'secondary' : 'primary'} icon={<Plus size={13} />} onClick={() => setEditing('new')}>
              {k.add}
            </Button>
            {canEndorse && (
              <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setEndorsing(true)}>
                {KIND.endorsement.add}
              </Button>
            )}
          </span>
        )}
      </div>
      {!active && (
        <p className="mt-1.5 text-xs text-[var(--color-warning-600)]">
          This market is no longer marked Bound. Its {k.title.toLowerCase()} are kept — remove any that weren’t written.
        </p>
      )}
      {entries.length === 0 ? (
        <p className="mt-1.5 text-sm text-[var(--color-ink-600)]">
          {kind === 'policy' ? 'Bound — add each policy written: policy number, dates, and net premium, taxes and fees.' : 'Endorsed — add each endorsement: date, policy number, and the change in net premium, taxes and fees.'}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {/* Newest first. */}
          {[...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).map((p) => {
            const waiting = pending.get(removalKey(accountId, p.id));
            if (waiting) return <DeletedRow key={p.id} item={waiting} />;
            return (
            <EntryItem
              key={p.id}
              accountId={accountId}
              cancellations={cancellations}
              quote={quote}
              entry={p}
              commission={commission}
              record={records.get(p.id)}
              onEdit={() => setEditing(p)}
              onRemove={() => setRemoving(p)}
              onRequestCancellation={(record) => setCancelling({ entry: p, record })}
            />
            );
          })}
        </ul>
      )}

      {editing && <EntryForm key={editing === 'new' ? 'new' : editing.id} accountId={accountId} quote={quote} kind={kind} editing={editing} onClose={() => setEditing(null)} />}
      {endorsing && <EntryForm key="new-endorsement" accountId={accountId} quote={quote} kind="endorsement" editing="new" onClose={() => setEndorsing(false)} />}
      {cancelling && (
        <CancellationRequestDialog
          accountId={accountId}
          transactionId={cancelling.record.transactionId}
          policyLabel={cancelling.entry.policyNumber ?? cancelling.entry.carrier}
          onClose={() => setCancelling(null)}
          onSent={() => {
            onRecordsChanged();
            void reloadPolicyCancellations(accountId);
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          // Gone at once; saved (and out of Analytics) after the Undo window — see pendingRemovals.
          if (removing) {
            const entry = removing;
            scheduleRemoval(removalKey(accountId, entry.id), `${kind === 'policy' ? 'Policy' : 'Endorsement'} ${entry.policyNumber ?? `with ${entry.carrier}`} deleted`, () => removePolicy(accountId, quote.id, entry.id));
          }
          setRemoving(null);
        }}
        title={`Remove this ${k.one}?`}
        description={`${removing?.policyNumber ?? `The ${k.one}`} with ${removing?.carrier ?? ''} is removed from this account, and its premium and commission no longer count in Analytics. You can undo it for ${UNDO_SECONDS} seconds. The market and its quotes are kept; the removal is recorded in History.`}
        confirmLabel={`Remove ${k.one}`}
      />
    </div>
  );
}

/** Where a just-deleted policy / endorsement was: "Deleted · Undo" with the seconds left. */
function DeletedRow({ item }: { item: PendingRemoval }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((item.until - now) / 1000));
  return (
    <li className="flex items-center gap-3 rounded-lg border border-dashed border-[var(--color-ink-200)] bg-white/70 px-3 py-2.5 text-sm text-[var(--color-ink-600)]" data-testid="deleted-row" aria-live="polite">
      <Trash2 size={14} className="shrink-0 text-[var(--color-ink-400)]" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <Button size="sm" variant="secondary" icon={<Undo2 size={13} />} onClick={() => undoRemoval(item.key)}>
        Undo
      </Button>
      <span className="w-7 shrink-0 text-right text-xs tabular-nums text-[var(--color-ink-400)]">{left}s</span>
    </li>
  );
}

function EntryItem({ accountId, cancellations, quote, entry: p, commission, record, onEdit, onRemove, onRequestCancellation }: { accountId: string; cancellations: PolicyCancellation[]; quote: MarketQuote; entry: PolicyRecord; commission: CommissionView; record?: AccountCommissionStatus; onEdit: () => void; onRemove: () => void; onRequestCancellation: (record: AccountCommissionStatus) => void }) {
  const feeShareFor = useBrokerFeeShare(accountId);
  // Cancelled (fully or partly) — shown with its date; undone cancellations no longer count.
  const cancelled = cancellationState(cancellations, p.id);
  const latest = cancelled.all[0];
  const waiting = cancellations.find((c) => c.policyId === p.id && (c.status === 'requested' || c.status === 'awaiting_amount'));
  const [undoError, setUndoError] = useState('');
  const [undoing, setUndoing] = useState(false);
  const isAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  // Admins decide undo requests and older cancellation requests right here (there's no separate screen).
  async function act(fn: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setUndoing(true);
    setUndoError('');
    const r = await fn();
    setUndoing(false);
    if (!r.ok) return setUndoError(r.message);
    void reloadPolicyCancellations(accountId);
  }
  const undo = (c: PolicyCancellation) => act(() => undoCancellation(c.id));
  const kind: PolicyEntryKind = p.kind === 'endorsement' ? 'endorsement' : 'policy';
  const k = KIND[kind];
  const files = p.attachments ?? [];
  // A policy, or an endorsement that added premium (its refund is paid back with the monthly endorsement payouts).
  const canRequestCancellation = (kind === 'policy' || p.netPremiumCents > 0) && !!record && record.status !== 'void' && !cancelled.full && !waiting;
  const forPolicy = kind === 'endorsement' && p.forPolicyId ? (quote.policies ?? []).find((x) => x.id === p.forPolicyId) : undefined;
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
            {waiting && <Badge tone="warning">Cancellation requested</Badge>}
          </p>
          {kind === 'endorsement' && (
            <p className="mt-0.5 text-xs text-[var(--color-ink-600)]" data-field="for-policy">
              {p.forPolicyId ? `Changes policy ${forPolicy?.policyNumber ?? '(on another market)'}` : <span className="text-[var(--color-warning-600)]">Not linked to its policy — edit to choose it</span>}
            </p>
          )}
          {p.description && <p className="mt-0.5 text-sm text-[var(--color-ink-700)]" data-field="description">{p.description}</p>}
          <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{p.carrier !== quote.marketName ? `${p.carrier} via ${quote.marketName}` : p.carrier}</p>
          <p className="mt-1 text-xs text-[var(--color-ink-600)]" data-field="dates">
            {latest ? (
              <>
                {k.dated} {formatDateWithYear(p.boundDate)} ·{' '}
                <span className={cancelled.full ? 'font-medium text-[var(--color-danger-600)]' : 'font-medium text-[var(--color-warning-600)]'}>
                  {cancelled.full ? 'Cancelled' : 'Partially cancelled'} {formatDateWithYear(latest.effectiveDate)}
                  {!cancelled.full && latest.refundNetCents !== null ? ` (${formatCents(latest.refundNetCents)} refunded)` : ''}
                </span>
              </>
            ) : (
              <>
                {k.dated} {formatShortDate(p.boundDate)}
                {p.effectiveDate || p.expirationDate ? ` · Term ${formatShortDate(p.effectiveDate)} – ${formatShortDate(p.expirationDate)}` : ''}
              </>
            )}
          </p>
          {waiting && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs" data-field="cancellation-request">
              <span className="text-[var(--color-ink-600)]">
                {waiting.cancelledByName} asked to cancel it ({waiting.type === 'full' ? 'full' : 'partial'}, effective {formatDateWithYear(waiting.effectiveDate)}).
              </span>
              {isAdmin ? (
                <>
                  <button type="button" disabled={undoing} className="cursor-pointer font-medium text-[var(--color-brand-700)] hover:underline disabled:opacity-60"
                    onClick={() => void act(async () => {
                      const r = await rejectCancellation(waiting.id, 'Cancelled directly instead');
                      if (r.ok && record) onRequestCancellation(record);
                      return r;
                    })}>
                    Cancel it now
                  </button>
                  <button type="button" disabled={undoing} className="cursor-pointer font-medium text-[var(--color-ink-600)] hover:underline disabled:opacity-60" onClick={() => void act(() => rejectCancellation(waiting.id, 'Declined'))}>
                    Decline
                  </button>
                </>
              ) : (
                <span className="text-[var(--color-ink-500)]">Waiting for an admin.</span>
              )}
              {undoError && <span className="text-[var(--color-danger-600)]">{undoError}</span>}
            </p>
          )}
          {/* Undo is in the ⋮ menu; here only an undo that's waiting for an admin (and any error). */}
          {latest?.direct && (latest.undoRequestedAt || undoError) && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs" data-field="cancellation-undo">
              {latest.undoRequestedAt && isAdmin ? (
                <>
                  <span className="text-[var(--color-ink-600)]">{latest.cancelledByName} asked to undo this cancellation.</span>
                  <button type="button" disabled={undoing} onClick={() => void undo(latest)} className="cursor-pointer font-medium text-[var(--color-brand-700)] hover:underline disabled:opacity-60">Undo it</button>
                  <button type="button" disabled={undoing} onClick={() => void act(() => declineCancellationUndo(latest.id))} className="cursor-pointer font-medium text-[var(--color-ink-600)] hover:underline disabled:opacity-60">Keep cancelled</button>
                </>
              ) : latest.undoRequestedAt ? (
                <span className="text-[var(--color-ink-500)]">Undo requested — waiting for an admin.</span>
              ) : null}
              {undoError && <span className="text-[var(--color-danger-600)]">{undoError}</span>}
            </p>
          )}
        </div>
        <OverflowMenu
          items={[
            { key: 'edit', label: `Edit ${k.one}`, icon: <Pencil size={14} />, onSelect: onEdit },
            ...(canRequestCancellation ? [{ key: 'cancel', label: kind === 'policy' ? 'Cancel policy' : 'Cancel endorsement', icon: <Ban size={14} />, onSelect: () => onRequestCancellation(record!) }] : []),
            // Undo the latest cancellation: right away this week (or as an admin), else ask an admin.
            ...(latest?.direct && !latest.undoRequestedAt
              ? [{ key: 'undo', label: latest.canUndoNow ? 'Undo cancellation' : 'Ask an admin to undo', icon: <Undo2 size={14} />, onSelect: () => void undo(latest) }]
              : []),
            { key: 'remove', label: `Remove ${k.one}`, icon: <Trash2 size={14} />, tone: 'danger' as const, onSelect: onRemove },
          ]}
        />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4" data-field="amounts">
        <Amount label="Net premium" cents={p.netPremiumCents} />
        <Amount label="Taxes" cents={p.taxesCents} />
        <Amount label="Fees" cents={p.feesCents} />
        <Amount label="Total" cents={policyTotalCents(p)} strong />
        {kind === 'policy' && !!p.brokerFeeCents && <Amount label="Broker fee" cents={p.brokerFeeCents} />}
      </dl>
      <CommissionLine commission={commission} netCents={p.netPremiumCents} carrier={p.carrier} dateKey={p.boundDate} record={record} feeShare={kind === 'policy' ? feeShareFor(p.id, p.brokerFeeCents) : undefined} />
      {record && record.flags.length > 0 && (
        <p className="mt-0.5 text-[11px] text-[var(--color-warning-600)]" data-field="commission-flags">{record.flags.map((f) => FLAG_LABELS[f] ?? f).join(' · ')}</p>
      )}
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

/**
 * "Agent commission: $300.00" (the agent's split of the carrier commission: net × carrier % × split) — only
 * for the agent and the agency's admins. Once recorded (0064), the frozen amount and its expected payout;
 * before, worked out from the carrier's % and the current split.
 */
export function CommissionLine({ commission, netCents, carrier, dateKey, record, feeShare }: { commission: CommissionView; netCents: number; carrier: string; dateKey: string; record?: AccountCommissionStatus; feeShare?: BrokerFeeShareView }) {
  if (commission.kind === 'hidden' && !record) return null;
  const base = 'mt-1.5 text-xs';
  if (record && record.agentCents !== null) {
    const payout = record.expectedPayDate ? ` · ${payoutWords(record.expectedPayDate, record.status === 'verified')}` : '';
    return (
      <p className={`${base} text-[var(--color-ink-700)]`} data-field="commission">
        Agent commission: <CommissionAmount cents={record.agentCents} feeShare={feeShare} />
        <span className="text-[var(--color-ink-500)]"> as recorded{payout}</span>
      </p>
    );
  }
  if (commission.kind === 'hidden') return null;
  if (commission.kind === 'no_agent') return <p className={`${base} text-[var(--color-ink-500)]`} data-field="commission">Agent commission: No agent assigned</p>;
  if (commission.kind === 'no_rate') return <p className={`${base} text-[var(--color-ink-500)]`} data-field="commission">Agent commission: no commission % set for {commission.agentName} (an admin sets it on the Team page)</p>;
  if (commission.kind === 'unavailable') return <p className={`${base} text-[var(--color-ink-500)]`} data-field="commission">Agent commission: {commission.message}</p>;
  const cents = commission.cents(netCents, carrier, dateKey);
  if (cents === null) {
    return (
      <p className={`${base} text-[var(--color-ink-500)]`} data-field="commission">
        Agent commission: {commission.preview ? 'carrier % not set yet' : 'shown once it’s recorded'}
        {feeShare?.kind === 'amount' && <> · broker fee share <strong className="tabular-nums text-[var(--color-ink-900)]">{formatCents(feeShare.cents)}</strong></>}
        <BrokerFeeNote feeShare={feeShare} />
      </p>
    );
  }
  return (
    <p className={`${base} text-[var(--color-ink-700)]`} data-field="commission">
      Agent commission: <CommissionAmount cents={cents} feeShare={feeShare} />
    </p>
  );
}

/**
 * "$300.00", or with a broker fee share "$300.00 + $150.00 broker fee = $450.00 total". When the first broker fee
 * didn't cover the referral partner's agreed amount, the rest comes off ("− $20.00 to the referral partner"), with
 * a hint saying why; when the broker fee can't be added yet, why.
 */
function CommissionAmount({ cents, feeShare }: { cents: number; feeShare?: BrokerFeeShareView }) {
  const strong = 'tabular-nums text-[var(--color-ink-900)]';
  const share = feeShare?.kind === 'amount' ? feeShare.cents : 0;
  const shortfall = feeShare && (feeShare.kind === 'amount' || feeShare.kind === 'no_share') ? feeShare.shortfallCents : 0;
  if (!share && !shortfall) {
    return (
      <>
        <strong className={strong}>{formatCents(cents)}</strong>
        <BrokerFeeNote feeShare={feeShare} />
      </>
    );
  }
  return (
    <>
      <span data-field="commission-total">
        <span className="tabular-nums">{formatCents(cents)}</span>
        {share > 0 && (
          <>
            {' '}+ <span className="tabular-nums">{formatCents(share)}</span> broker fee
          </>
        )}
        {shortfall > 0 && (
          <>
            {' '}− <span className="tabular-nums">{formatCents(shortfall)}</span> to the referral partner
          </>
        )}{' '}
        = <strong className={strong}>{formatCents(cents + share - shortfall)}</strong> total
      </span>
      {shortfall > 0 && feeShare && feeShare.kind !== 'none' && (
        <span className="mt-0.5 block text-[var(--color-ink-500)]" data-field="partner-shortfall-note">
          The broker fee ({formatCents(feeShare.feeCents)}) didn’t cover the referral partner’s agreed amount, so the rest ({formatCents(shortfall)}) comes out of the agent commission.
        </span>
      )}
      <BrokerFeeNote feeShare={feeShare} />
    </>
  );
}

/** Why a policy's broker fee isn't in the agent commission yet (nothing when it is, or when there's none). */
function BrokerFeeNote({ feeShare }: { feeShare?: BrokerFeeShareView }) {
  const isAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  if (!feeShare || feeShare.kind !== 'no_share') return null;
  const fee = <span className="tabular-nums">{formatCents(feeShare.feeCents)}</span>;
  return (
    <span className="mt-0.5 block text-[var(--color-warning-600)]" data-field="broker-fee-note">
      Broker fee {fee} isn’t included yet:{' '}
      {isAdmin ? 'the agent’s broker fee share isn’t set yet. Set it on Team and Partners.' : 'your broker fee share isn’t set yet. Your admin sets it on Team and Partners.'}
    </span>
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
  // The carrier % (0073): typed by hand on every new or edited entry (never filled in), by the account's
  // assigned agent or an admin of its agency — the people who may set it. Required for them.
  const account = accounts.find((a) => a.id === accountId);
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const me = useAccountsStore((s) => s.currentUserId);
  const asksCarrierPct = isSupabaseConfigured && !!agencyAccess && !!account?.agencyId && (agencyAccess.role === 'admin' || (!!me && account.assignedUserId === me));
  const [carrierPct, setCarrierPct] = useState('');
  const carrierRate = parseCarrierPercent(carrierPct);
  // An endorsement starts from its policy's carrier % (0074) until the % is typed by hand.
  const [pctTouched, setPctTouched] = useState(false);
  const [policyRates, setPolicyRates] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!asksCarrierPct || kind !== 'endorsement') return;
    let current = true;
    void fetchEnteredCarrierRates(accountId).then((r) => {
      if (current && r.ok) setPolicyRates(new Map([...r.data].map(([key, v]) => [key.slice(accountId.length + 1), v.rate])));
    });
    return () => {
      current = false;
    };
  }, [accountId, asksCarrierPct, kind]);
  // Saving without any document asks first (see the confirmation below).
  const [confirmNoDocs, setConfirmNoDocs] = useState(false);
  const attachRef = useRef<HTMLInputElement>(null);
  // Bound for a tracked renewal: the policy is that renewal's term (the account's date may already be next year's).
  const { renewals } = useAccountRenewals(accountId);
  const boundFor = quote.renewalId ? renewals.find((r) => r.id === quote.renewalId) : undefined;
  const options = quote.options ?? [];
  const existing = useMemo(() => policyRows(accounts, allQuotes, { includeArchived: true }), [accounts, allQuotes]);
  // An endorsement changes one of this account's policies (any of its markets).
  const accountPolicies = useMemo(() => (allQuotes[accountId] ?? []).flatMap((q) => activePolicies(q).map((p) => ({ policy: p, marketName: q.marketName }))), [allQuotes, accountId]);
  const k = KIND[kind];

  const [f, setF] = useState<PolicyInput>(() => {
    if (editing !== 'new') {
      return {
        kind,
        notes: editing.notes ?? '',
        description: editing.description ?? '',
        forPolicyId: editing.forPolicyId ?? '',
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
        brokerFee: centsInput(editing.brokerFeeCents),
      };
    }
    if (kind === 'endorsement') {
      // An endorsement changes a policy written here: start from that policy's number, carrier and term.
      const policy = activePolicies(quote).at(-1);
      return {
        kind,
        notes: '',
        forPolicyId: policy?.id ?? '',
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
  const fromPolicyRate = kind === 'endorsement' && f.forPolicyId ? policyRates.get(f.forPolicyId) : undefined;
  useEffect(() => {
    if (!pctTouched && fromPolicyRate !== undefined) setCarrierPct(String(Math.round(fromPolicyRate * 1e4) / 100));
  }, [fromPolicyRate, pctTouched]);
  // New documents, each with a description; and the ones already attached (description edits, removals) — applied on save.
  const [files, setFiles] = useState<{ key: string; file: File; description: string }[]>([]);
  const [kept, setKept] = useState(() => (editing === 'new' ? [] : (editing.attachments ?? []).map((a) => ({ ...a, description: a.description ?? '' }))));
  const describe = useAccountsStore((s) => s.describePolicyAttachment);
  const detach = useAccountsStore((s) => s.removePolicyAttachment);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const check = checkPolicy(f, { existing, editingId: editing === 'new' ? undefined : editing.id, accountPolicyIds: accountPolicies.map((x) => x.policy.id), requirePolicyLink: kind === 'endorsement' && (editing === 'new' || !!editing.forPolicyId) });
  const feeShareFor = useBrokerFeeShare(accountId);
  // The client's referral partner, asked here when the account doesn't have one yet (accounts from before referral
  // partners): it decides who shares the broker fee, so it's required once a broker fee is entered.
  const referralSources = useReferralSources();
  const setAccountReferral = useAccountsStore((s) => s.setAccountReferral);
  const [referralChoice, setReferralChoice] = useState('');
  const [referralOther, setReferralOther] = useState<OtherReferral | null>(null);
  const others = useOtherReferrals();
  const asksReferral = kind === 'policy' && !account?.referralSource;
  const formFeeShare = kind === 'policy' ? feeShareFor(editing === 'new' ? null : editing.id, parseMoneyCents(f.brokerFee ?? '') ?? undefined) : undefined;
  const live = (v: string) => {
    const c = parseMoneyCents(v);
    return c === null || Number.isNaN(c) ? 0 : c;
  };
  const total = live(f.netPremium) + live(f.taxes) + live(f.fees);

  const set = <K extends keyof PolicyInput>(key: K, value: PolicyInput[K]) => {
    // Once a policy is chosen, the "choose the policy" message no longer applies.
    if (key === 'forPolicyId' && value) setErrors((errs) => errs.filter((m) => !m.startsWith('Choose the policy this endorsement changes')));
    if (key === 'effectiveDate' && value) setErrors((errs) => errs.filter((m) => m !== 'Enter the effective date.'));
    setF((cur) => {
      const next = { ...cur, [key]: value };
      // Picking the endorsed policy fills its number and carrier, unless they were changed by hand.
      if (key === 'forPolicyId') {
        const pick = accountPolicies.find((x) => x.policy.id === value)?.policy;
        const fromAPolicy = (v: string, field: 'policyNumber' | 'carrier') => !v || v === quote.marketName || accountPolicies.some((x) => (x.policy[field] ?? '') === v);
        if (pick && (kind === 'endorsement' || fromAPolicy(cur.policyNumber, 'policyNumber'))) next.policyNumber = pick.policyNumber ?? '';
        if (pick && fromAPolicy(cur.carrier, 'carrier')) next.carrier = pick.carrier;
      }
      // A policy's expiration follows its effective date (one year later) until it's changed by hand.
      if (key === 'effectiveDate' && kind === 'policy' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const wasFollowing = !cur.expirationDate || (/^\d{4}-\d{2}-\d{2}$/.test(cur.effectiveDate) && cur.expirationDate === oneYearAfter(cur.effectiveDate));
        if (wasFollowing) next.expirationDate = oneYearAfter(value);
      }
      // Picking a quote fills the net premium if it's still blank or still that of the previous quote.
      if (key === 'quoteOptionId') {
        const prev = options.find((o) => o.id === cur.quoteOptionId)?.premium;
        const nextPremium = options.find((o) => o.id === value)?.premium;
        if (nextPremium && (!cur.netPremium || (prev && parseMoneyCents(cur.netPremium) === Math.round(prev * 100)))) next.netPremium = centsInput(Math.round(nextPremium * 100));
      }
      return next;
    });
  };

  async function submit(e?: FormEvent, withoutDocuments = false) {
    e?.preventDefault();
    const pctError = asksCarrierPct && carrierRate === null ? ['Enter the carrier commission % (more than 0, at most 50, e.g. 12).'] : [];
    const referralError = asksReferral && !referralChoice && (parseMoneyCents(f.brokerFee ?? '') ?? 0) > 0 ? ['Choose the client’s referral partner (it decides who shares the broker fee), or No referral.'] : [];
    if (!check.ok || pctError.length || referralError.length) {
      setErrors([...(check.ok ? [] : check.errors), ...pctError, ...referralError]);
      return;
    }
    if (!withoutDocuments && kept.length === 0 && files.length === 0) {
      setConfirmNoDocs(true);
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
    // The carrier % is saved first: if it can't be, nothing is saved.
    const entryId = editing === 'new' ? generateId('policy') : editing.id;
    if (asksCarrierPct && carrierRate !== null) {
      setSaving(true);
      const r = await enterPolicyCarrierRate(accountId, entryId, carrierRate);
      setSaving(false);
      if (!r.ok) {
        setErrors([`The carrier % couldn’t be saved, so nothing was saved: ${r.message}`]);
        return;
      }
    }
    if (asksReferral && referralChoice === OTHER_REFERRAL && referralOther) {
      // "Other": the partner typed for this client (an agent's goes to Admin Review).
      setSaving(true);
      const r = await setOtherReferral(accountId, referralOther);
      setSaving(false);
      if (!r.ok) return setErrors([`The referral partner couldn’t be saved, so nothing was saved: ${r.message}`]);
      void reloadOtherReferrals();
    }
    if (asksReferral && referralChoice) setAccountReferral(accountId, referralChoice, referralLabel(referralChoice, referralSources, referralOther));
    if (editing === 'new') {
      const id = addPolicy(accountId, quote.id, check.fields, entryId);
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
  const shownErrors = errors.length > 0 ? (check.ok ? errors : [...check.errors, ...errors.filter((m) => m.startsWith('Enter the carrier'))]) : [];

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
          {kind === 'endorsement' ? (
            // An endorsement changes a policy on this account: its number is picked from them (which also links it).
            <div>
              <label className={labelClass} htmlFor="policy-for">
                Policy number {editing === 'new' && <Required />}
              </label>
              <select id="policy-for" className={inputClass} value={f.forPolicyId ?? ''} onChange={(e) => set('forPolicyId', e.target.value)}>
                <option value="">{accountPolicies.length ? '— Choose the policy' : '— No policy recorded on this account yet'}</option>
                {accountPolicies.map(({ policy: p, marketName }) => (
                  <option key={p.id} value={p.id}>
                    {p.policyNumber ?? 'Number to come'} — {p.carrier}
                    {p.carrier !== marketName ? ` via ${marketName}` : ''}
                  </option>
                ))}
              </select>
              {editing !== 'new' && !editing.forPolicyId && <p className="mt-1 text-xs text-[var(--color-warning-600)]">Recorded before endorsements were linked — choose its policy so the commission can be verified.</p>}
              {f.forPolicyId && !accountPolicies.find((x) => x.policy.id === f.forPolicyId)?.policy.policyNumber && (
                <input id="policy-number" className={`${inputClass} mt-2`} value={f.policyNumber} onChange={(e) => set('policyNumber', e.target.value)} placeholder="That policy has no number yet — enter it" aria-label="Policy number" />
              )}
            </div>
          ) : (
            <div>
              <label className={labelClass} htmlFor="policy-number">
                Policy number <Required />
              </label>
              <input id="policy-number" className={inputClass} value={f.policyNumber} onChange={(e) => set('policyNumber', e.target.value)} required aria-required="true" />
            </div>
          )}
          <div>
            <label className={labelClass} htmlFor="policy-carrier">
              Carrier (writing company) <Required />
            </label>
            <input id="policy-carrier" className={inputClass} value={f.carrier} onChange={(e) => set('carrier', e.target.value)} list="market-name-options" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="policy-description">Description</label>
            <input
              id="policy-description"
              className={inputClass}
              value={f.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
              maxLength={300}
              placeholder={kind === 'policy' ? 'e.g. Auto liability and cargo, 6 power units' : 'e.g. Added 2023 Freightliner Cascadia'}
            />
          </div>
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
            <label className={labelClass} htmlFor="policy-effective">
              Effective <Required />
            </label>
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
          {kind === 'policy' && (
            <div>
              <label className={labelClass} htmlFor="policy-broker-fee">Broker fee ($)</label>
              <input id="policy-broker-fee" inputMode="decimal" className={inputClass} value={f.brokerFee ?? ''} onChange={(e) => set('brokerFee', e.target.value)} placeholder="0.00" />
            </div>
          )}
          {kind === 'policy' && (
            <div data-testid="policy-referral">
              <label className={labelClass} htmlFor="policy-referral">
                Referral partner {asksReferral && (parseMoneyCents(f.brokerFee ?? '') ?? 0) > 0 && <Required />}
              </label>
              {asksReferral ? (
                <ReferralPicker
                  id="policy-referral"
                  value={referralChoice}
                  other={referralOther}
                  onChange={(v, _label, o) => {
                    setReferralChoice(v);
                    setReferralOther(o ?? null);
                  }}
                  placeholder="Not set"
                  className={inputClass}
                />
              ) : (
                <p className="px-0.5 py-2 text-sm text-[var(--color-ink-800)]">
                  {referralLabel(account?.referralSource, referralSources, others[accountId])}
                  {account?.referralSource === OTHER_REFERRAL && others[accountId] && <span className="text-[var(--color-ink-500)]"> ({formatCents(others[accountId].partnerFeeCents)})</span>}
                </p>
              )}
              {!asksReferral && <p className="mt-1 text-[11px] text-[var(--color-ink-500)]">For the whole client; change it at the top of the account.</p>}
            </div>
          )}
          {asksCarrierPct && (
            <div>
              <label className={labelClass} htmlFor="policy-carrier-pct">
                Carrier commission (%) <Required />
              </label>
              <input
                id="policy-carrier-pct"
                inputMode="decimal"
                className={inputClass}
                value={carrierPct}
                onChange={(e) => {
                  setPctTouched(true);
                  setCarrierPct(e.target.value);
                }}
                placeholder="e.g. 12"
                aria-required="true"
                data-testid="carrier-pct"
              />
            </div>
          )}
          <div className="sm:col-span-4" data-testid="form-commission">
            {asksCarrierPct ? (
              <CarrierPctLine commission={commission} netCents={live(f.netPremium)} rate={carrierRate} feeShare={formFeeShare} />
            ) : (
              <CommissionLine commission={commission} netCents={live(f.netPremium)} carrier={f.carrier} dateKey={f.boundDate} feeShare={formFeeShare} />
            )}
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
            ref={attachRef}
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
      <ConfirmDialog
        open={confirmNoDocs}
        variant="default"
        title="Save without a document?"
        description={`No binder or ${kind === 'policy' ? 'policy' : 'endorsement'} document is attached. You can add it later. Until then this ${kind === 'policy' ? 'policy' : 'endorsement'} shows Missing Documents and its commission can't be verified.`}
        cancelLabel="Attach document"
        confirmLabel="Save without document"
        onCancel={() => {
          setConfirmNoDocs(false);
          attachRef.current?.click();
        }}
        onConfirm={() => {
          setConfirmNoDocs(false);
          void submit(undefined, true);
        }}
      />
    </Modal>
  );
}

/** While the carrier % is typed: just the agent's commission in dollars, e.g. "Agent commission: $300.00". */
function CarrierPctLine({ commission, netCents, rate, feeShare }: { commission: CommissionView; netCents: number; rate: number | null; feeShare?: BrokerFeeShareView }) {
  const muted = 'text-xs text-[var(--color-ink-500)]';
  if (rate === null) return <p className={muted} data-field="commission">Enter the carrier’s commission % to see the agent commission.</p>;
  if (commission.kind === 'amount')
    return (
      <p className="text-xs text-[var(--color-ink-700)]" data-field="commission">
        Agent commission: <CommissionAmount cents={agentCommissionCents(netCents, rate, commission.rate) ?? 0} feeShare={feeShare} />
      </p>
    );
  return (
    <p className={muted} data-field="commission">
      Agent commission: {commission.kind === 'no_rate' ? `${commission.agentName}’s commission % isn’t set yet` : commission.kind === 'no_agent' ? 'no agent assigned to this account' : 'shown once recorded'}
    </p>
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
