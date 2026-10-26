import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardBody, ConfirmDialog, Modal, OverflowMenu, Tabs } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { formatRate } from '../workspace/PoliciesSection';
import { DownloadButtons } from '../analytics/DownloadButtons';
import { CommissionStatusBadge } from './CommissionStatusBadge';
import { CarrierRateDialog } from './CarrierRateDialog';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useLedger } from '../../hooks/useLedger';
import { reloadCarrierRates, useCarrierRates } from '../../hooks/useCarrierRates';
import { fetchAgentCommissionRates, retireCarrierCommissionRate } from '../../services/supabase/commissionRepo';
import * as repo from '../../services/supabase/ledgerRepo';
import {
  FLAG_LABELS,
  KIND_LABELS,
  STATUS_LABELS,
  WEEKDAYS,
  blockingFlags,
  carrierReceived,
  describeSchedule,
  ledgerStatus,
  payoutDate,
  payoutWords,
  payoutReadiness,
  remainingNetCents,
  verificationBlockers,
  type LedgerCancellation,
  type LedgerStatus,
  type LedgerTransaction,
  type PayoutSchedule,
} from '../../services/finance/ledger';
import { agentCommissionCents, carrierCommissionCents, formatCents, parseMoneyCents } from '../../services/workflow/policies';
import { formatShortDate, toLocalDateKey } from '../../services/workflow/dates';
import type { Report } from '../../services/reports/report';

const th = 'whitespace-nowrap border-b border-[var(--color-ink-100)] px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]';
const td = 'border-b border-[var(--color-ink-50)] px-3 py-2 align-top text-sm text-[var(--color-ink-800)]';
const num = 'whitespace-nowrap text-right tabular-nums';
type Section = 'review' | 'records' | 'cancellations' | 'rates' | 'schedule';

/**
 * The agency's commission records (0064), for admins: the review queue (historical records, records that
 * need attention, Missing Document, Pending Verification), every record with its corrections and
 * cancellations, cancellation requests, carrier rates by date, and the payout schedule. Every action is
 * one of the database's functions — it checks who may do it, keeps the history and writes the audit.
 * Payouts themselves are on the Payouts tab (0065); here each record shows its expected payout date.
 */
export function CommissionsPanel() {
  const ledger = useLedger();
  const [section, setSection] = useState<Section>('review');
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const data = ledger.data;
  const current = useMemo(() => (data ? data.transactions.filter((t) => !t.replacedBy) : []), [data]);
  const queue = useMemo(() => current.filter((t) => t.verificationStatus === 'unverified' && t.settlement === 'open'), [current]);
  const openCancellations = useMemo(() => (data ? data.cancellations.filter((c) => c.status === 'requested' || c.status === 'awaiting_amount') : []), [data]);

  /** Runs an action, then reloads the records and says how it went. */
  const run = async (action: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string): Promise<boolean> => {
    const res = await action();
    if (!res.ok) {
      setNotice({ tone: 'bad', text: res.message });
      return false;
    }
    setNotice({ tone: 'good', text: done });
    await ledger.reload();
    return true;
  };

  return (
    <div className="flex flex-col gap-4" data-testid="commissions-panel">
      <Tabs
        items={[
          { key: 'review', label: 'Review', count: data ? queue.length : undefined },
          { key: 'records', label: 'Records' },
          { key: 'cancellations', label: 'Cancellations', count: data ? openCancellations.length : undefined },
          { key: 'rates', label: 'Carrier rates' },
          { key: 'schedule', label: 'Payout schedule' },
        ]}
        active={section}
        onChange={(k) => {
          setSection(k as Section);
          setNotice(null);
        }}
      />
      {notice && (
        <p
          className={notice.tone === 'good' ? 'rounded-lg border border-[var(--color-success-600)]/25 bg-[var(--color-success-100)] px-3 py-2 text-sm text-[var(--color-success-600)]' : 'rounded-lg border border-[var(--color-danger-600)]/25 bg-[var(--color-danger-100)] px-3 py-2 text-sm text-[var(--color-danger-600)]'}
          role={notice.tone === 'good' ? 'status' : 'alert'}
          data-testid="commission-notice"
        >
          {notice.text}
        </p>
      )}
      {section === 'rates' ? (
        <CarrierRatesSection />
      ) : ledger.status === 'loading' || ledger.status === 'idle' ? (
        <Card><CardBody className="pt-5 text-sm text-[var(--color-ink-500)]">Loading commission records…</CardBody></Card>
      ) : !data ? (
        <Card>
          <CardBody className="pt-5 text-sm text-[var(--color-ink-600)]" data-testid="ledger-unavailable">
            {ledger.message ?? 'Commission records aren’t available right now.'} Until then, Analytics works the amounts out from the policies.
          </CardBody>
        </Card>
      ) : section === 'review' ? (
        <ReviewSection queue={queue} all={current} historicalWaiting={data.historicalWaiting} schedule={data.schedule} run={run} />
      ) : section === 'records' ? (
        <RecordsSection all={current} receipts={data.receipts} schedule={data.schedule} run={run} />
      ) : section === 'cancellations' ? (
        <CancellationsSection cancellations={data.cancellations} all={current} run={run} />
      ) : (
        <ScheduleSection schedule={data.schedule} historicalWaiting={data.historicalWaiting} run={run} />
      )}
    </div>
  );
}

type Run = (action: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) => Promise<boolean>;

function useAgentName() {
  const members = useAccountsStore((s) => s.agencyMembers);
  return (t: Pick<LedgerTransaction, 'agentUserId' | 'agentName'>) => (t.agentUserId ? (members.find((m) => m.userId === t.agentUserId)?.name ?? t.agentName ?? 'Agent') : 'No agent');
}

const policyLabel = (t: Pick<LedgerTransaction, 'policyNumber' | 'carrierName'>) => t.policyNumber ?? `(no number) ${t.carrierName}`;

/** One record: client, policy, kind, dates and the frozen amounts. */
function RecordSummary({ t, schedule, extra }: { t: LedgerTransaction; schedule: PayoutSchedule; extra?: ReactNode }) {
  const agentName = useAgentName();
  const status = ledgerStatus(t);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Link to={`/accounts/${t.submissionId}?tab=quotes`} className="font-medium text-[var(--color-brand-800)] hover:underline">{t.clientName || 'Account'}</Link>
        <span className="font-medium text-[var(--color-ink-800)]">{policyLabel(t)}</span>
        <Badge tone={t.kind === 'cancellation' ? 'danger' : t.kind === 'correction' ? 'brand' : t.kind === 'endorsement' ? 'info' : 'neutral'}>{KIND_LABELS[t.kind]}</Badge>
        <CommissionStatusBadge status={status} />
        {t.verifiedWithoutProof && <Badge tone="warning">Verified without document</Badge>}
      </p>
      <p className="text-xs text-[var(--color-ink-600)]">
        {t.kind === 'endorsement' ? 'Endorsed' : t.kind === 'cancellation' ? 'Cancelled from' : t.kind === 'correction' ? 'Corrected' : 'Bound'} {formatShortDate(t.eventDate)} · {t.carrierName} · net {formatCents(t.netCents)}
      </p>
      <p className="text-xs text-[var(--color-ink-700)]" data-field="frozen">
        Agent: <strong>{agentName(t)}</strong>
        {t.agentRate !== null ? ` at ${formatRate(t.agentRate)}` : ''} → <strong className="tabular-nums">{t.agentCents === null ? '—' : formatCents(t.agentCents)}</strong>
        {' · '}Carrier {t.carrierRateSource === 'actual' ? 'actual' : formatRate(t.carrierRate)} → <strong className="tabular-nums">{formatCents(t.carrierCents)}</strong>
        {t.reviewFlags.includes('no_carrier_rate') ? ' (not set)' : t.carrierRateSource === 'default' ? ' (10% default)' : t.carrierRateSource === 'historical' ? ' (not confirmed)' : ''}
        {status !== 'void' && status !== 'settled_outside' && <> · {t.stream === 'weekly' ? 'weekly' : 'monthly'} {payoutWords(payoutDate(schedule, t.stream, t.payableFrom), status === 'verified')}</>}
      </p>
      {t.reviewFlags.length > 0 && <p className="text-[11px] text-[var(--color-warning-600)]" data-field="flags">{t.reviewFlags.map((f) => FLAG_LABELS[f] ?? f).join(' · ')}</p>}
      {t.voidReason && <p className="text-[11px] text-[var(--color-ink-500)]">Voided: {t.voidReason}</p>}
      {t.settledReason && <p className="text-[11px] text-[var(--color-ink-500)]">Settled outside RenewalIQ: {t.settledReason}</p>}
      {t.verificationReason && <p className="text-[11px] text-[var(--color-ink-500)]">{t.verifiedWithoutProof ? 'Reason (no document)' : 'Note'}: {t.verificationReason}</p>}
      {extra}
    </div>
  );
}

// ─────────────────────────────── review ───────────────────────────────

type Dialog =
  | { kind: 'reason'; title: string; label: string; confirm: string; onConfirm: (reason: string) => Promise<boolean>; description?: string }
  | { kind: 'confirm-historical'; t: LedgerTransaction }
  | { kind: 'resolve-agent'; t: LedgerTransaction }
  | { kind: 'link'; t: LedgerTransaction }
  | { kind: 'correct'; t: LedgerTransaction }
  | { kind: 'receipt'; t: LedgerTransaction }
  | { kind: 'settle'; ids: string[] };

function ReviewSection({ queue, all, historicalWaiting, schedule, run }: { queue: LedgerTransaction[]; all: LedgerTransaction[]; historicalWaiting: number; schedule: PayoutSchedule; run: Run }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [verifying, setVerifying] = useState<LedgerTransaction | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const historical = queue.filter((t) => t.origin === 'historical' && !t.rateConfirmedAt);
  const attention = queue.filter((t) => !historical.includes(t) && blockingFlags(t).length > 0);
  const missingProof = queue.filter((t) => !historical.includes(t) && !attention.includes(t) && t.proofStatus === 'missing_proof');
  const pending = queue.filter((t) => !historical.includes(t) && !attention.includes(t) && t.proofStatus === 'has_proof');

  const reason = (title: string, label: string, confirm: string, onConfirm: (r: string) => Promise<boolean>, description?: string) => setDialog({ kind: 'reason', title, label, confirm, onConfirm, description });
  const actionsFor = (t: LedgerTransaction) => {
    const items: { key: string; label: string; onSelect: () => void; tone?: 'danger' }[] = [];
    const flags = t.reviewFlags;
    if (t.origin === 'historical' && !t.rateConfirmedAt) items.push({ key: 'confirm', label: 'Review agent, split and rate…', onSelect: () => setDialog({ kind: 'confirm-historical', t }) });
    if (flags.includes('unlinked_endorsement')) items.push({ key: 'link', label: 'Link to its policy…', onSelect: () => setDialog({ kind: 'link', t }) });
    if (flags.includes('changed_since_recorded')) {
      items.push({ key: 'rerecord', label: 'Accept the changes (record again, same agent and split)…', onSelect: () => reason('Record again from the account', 'Why', 'Record again', (r) => run(() => repo.rerecordCommission(t.id, r), 'Recorded again from the account, with the same agent and split.'), 'The amounts are taken from the account as it is now. The agent and split stay as first recorded; this record is kept, voided.') });
      items.push({ key: 'ack', label: 'Keep as recorded…', onSelect: () => reason('Keep the record as it is', 'Note', 'Keep as recorded', (r) => run(() => repo.acknowledgeCommissionChanges(t.id, r), 'Kept as recorded; the account’s current details are accepted.')) });
    }
    if (flags.includes('removed')) items.push({ key: 'ack-removed', label: 'Keep (it was removed on purpose)…', onSelect: () => reason('Keep this record', 'Note', 'Keep', (r) => run(() => repo.acknowledgeCommissionChanges(t.id, r), 'Kept.')) });
    if (flags.includes('no_agent') || flags.includes('no_agent_rate')) items.push({ key: 'resolve-agent', label: t.agentUserId ? 'Add the agent’s split…' : 'Add the agent and split…', onSelect: () => setDialog({ kind: 'resolve-agent', t }) });
    items.push({ key: 'void', label: 'Void…', tone: 'danger', onSelect: () => reason('Void this commission', 'Why (it stays in the history)', 'Void', (r) => run(() => repo.voidCommission(t.id, r), 'Voided. The record is kept with the reason.')) });
    return items;
  };

  const row = (t: LedgerTransaction, primary?: ReactNode, selectable = false) => (
    <li key={t.id} className="flex items-start justify-between gap-3 border-b border-[var(--color-ink-50)] py-3 last:border-b-0" data-record={t.id} data-policy={t.policyId ?? ''}>
      <div className="flex min-w-0 items-start gap-2">
        {selectable && <input type="checkbox" className="mt-1" aria-label={`Select ${policyLabel(t)}`} checked={picked.includes(t.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)))} />}
        <RecordSummary t={t} schedule={schedule} extra={verificationBlockers(t).length > 0 ? <p className="text-[11px] font-medium text-[var(--color-ink-700)]">To verify: {verificationBlockers(t).join('; ')}</p> : undefined} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {primary}
        <OverflowMenu items={actionsFor(t)} />
      </div>
    </li>
  );

  const group = (title: string, hint: string, list: LedgerTransaction[], render: (t: LedgerTransaction) => ReactNode, testId: string, head?: ReactNode) =>
    list.length > 0 && (
      <Card data-testid={testId}>
        <CardBody className="pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">{title} <span className="text-[var(--color-ink-400)]">({list.length})</span></h3>
              <p className="text-xs text-[var(--color-ink-500)]">{hint}</p>
            </div>
            {head}
          </div>
          <ul className="mt-2">{list.map(render)}</ul>
        </CardBody>
      </Card>
    );

  return (
    <>
      {historicalWaiting > 0 && (
        <p className="rounded-lg border border-[var(--color-warning-600)]/30 bg-[var(--color-warning-100)] px-3 py-2 text-sm text-[var(--color-ink-700)]" data-testid="historical-waiting">
          {historicalWaiting} {historicalWaiting === 1 ? 'policy or endorsement' : 'policies and endorsements'} from before commission tracking {historicalWaiting === 1 ? 'isn’t' : 'aren’t'} recorded yet. Record them for review in Payout schedule → Historical records.
        </p>
      )}
      {queue.length === 0 && <Card><CardBody className="pt-5 text-sm text-[var(--color-ink-600)]" data-testid="review-empty">Nothing waiting for review. Every recorded commission is verified, settled or void.</CardBody></Card>}
      {group(
        'Historical – needs review',
        'Recorded before commission tracking. Never verified with today’s rates and never paid until you confirm the agent, split and carrier rate — or mark them settled outside RenewalIQ.',
        historical,
        (t) => row(t, <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'confirm-historical', t })}>Review</Button>, true),
        'review-historical',
        <Button size="sm" variant="secondary" disabled={!picked.some((id) => historical.some((t) => t.id === id))} onClick={() => setDialog({ kind: 'settle', ids: picked.filter((id) => historical.some((t) => t.id === id)) })}>
          Settled outside RenewalIQ…
        </Button>
      )}
      {group('Needs attention', 'Something changed or is missing; deal with it before verifying.', attention, (t) => row(t), 'review-attention')}
      {group(
        'Missing Document',
        'Recorded without a document. Attach the binder or endorsement page on the account — or verify without a document, as an exception with a reason.',
        missingProof,
        (t) => row(t, <Button size="sm" variant="secondary" onClick={() => reason('Verify without document', 'Reason (kept in the audit)', 'Verify without document', (r) => run(() => repo.verifyCommission(t.id, r), `Verified without document: ${policyLabel(t)}.`), 'An exception: say why the amounts can be trusted without the document.')}>Verify without document</Button>),
        'review-missing-proof'
      )}
      {group('Pending Verification', 'Check the amounts against the document, then verify. Only verified commissions are eligible for payout.', pending, (t) => row(t, <Button size="sm" onClick={() => setVerifying(t)}>Verify</Button>), 'review-pending')}

      <ConfirmDialog
        open={!!verifying}
        onCancel={() => setVerifying(null)}
        onConfirm={() => {
          const t = verifying!;
          setVerifying(null);
          void run(() => repo.verifyCommission(t.id), `Verified: ${policyLabel(t)}.`);
        }}
        title="Verify this commission?"
        description={verifying ? `${policyLabel(verifying)} — net ${formatCents(verifying.netCents)}, agent commission ${verifying.agentCents === null ? '—' : formatCents(verifying.agentCents)}, carrier commission ${formatCents(verifying.carrierCents)}. A verified commission can't be changed; a correction or cancellation is added instead.` : ''}
        confirmLabel="Verify"
        variant="default"
      />
      <Dialogs dialog={dialog} all={all} run={run} onClose={() => setDialog(null)} onDone={() => setPicked([])} />
    </>
  );
}

function Dialogs({ dialog, all, run, onClose, onDone }: { dialog: Dialog | null; all: LedgerTransaction[]; run: Run; onClose: () => void; onDone?: () => void }) {
  if (!dialog) return null;
  if (dialog.kind === 'reason') return <ReasonDialog {...dialog} onClose={onClose} />;
  if (dialog.kind === 'confirm-historical') return <ConfirmHistoricalDialog t={dialog.t} run={run} onClose={onClose} />;
  if (dialog.kind === 'resolve-agent') return <ResolveAgentDialog t={dialog.t} run={run} onClose={onClose} />;
  if (dialog.kind === 'link') return <LinkDialog t={dialog.t} all={all} run={run} onClose={onClose} />;
  if (dialog.kind === 'correct') return <CorrectDialog t={dialog.t} all={all} run={run} onClose={onClose} />;
  if (dialog.kind === 'receipt') return <ReceiptDialog t={dialog.t} run={run} onClose={onClose} />;
  return <SettleDialog ids={dialog.ids} all={all} run={run} onClose={onClose} onDone={onDone} />;
}

export function DialogError({ text }: { text: string }) {
  return text ? <p className="rounded-lg border border-[var(--color-danger-600)]/25 bg-[var(--color-danger-100)] px-3 py-2 text-sm text-[var(--color-danger-600)]" role="alert">{text}</p> : null;
}

export function ReasonDialog({ title, label, confirm, description, onConfirm, onClose }: { title: string; label: string; confirm: string; description?: string; onConfirm: (reason: string) => Promise<boolean>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!text.trim()) return setError(`Enter the ${label.toLowerCase().replace(/ \(.*\)$/, '')}.`);
              setBusy(true);
              const ok = await onConfirm(text.trim());
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" data-testid="reason-dialog">
        <DialogError text={error} />
        <label className={labelClass} htmlFor="reason-text">{label}</label>
        <textarea id="reason-text" rows={3} className={inputClass} value={text} onChange={(e) => (setText(e.target.value), setError(''))} maxLength={1000} autoFocus />
      </div>
    </Modal>
  );
}

const pctToRate = (v: string): number | null => {
  const n = Number(v.trim().replace('%', ''));
  return v.trim() && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 1e4) / 1e6 : null;
};
const rateToPct = (r: number | null) => (r === null ? '' : String(Math.round(r * 1e6) / 1e4));

function ConfirmHistoricalDialog({ t, run, onClose }: { t: LedgerTransaction; run: Run; onClose: () => void }) {
  const members = useAccountsStore((s) => s.agencyMembers);
  const [agent, setAgent] = useState(t.agentUserId ?? '');
  const [split, setSplit] = useState(rateToPct(t.agentRate));
  const [carrier, setCarrier] = useState(rateToPct(t.carrierRate));
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const agentRate = pctToRate(split);
  const carrierRate = pctToRate(carrier);
  useEffect(() => setError(''), [agent, split, carrier, evidence]);
  async function save() {
    if (!agent) return setError('Choose the agent who wrote it.');
    if (agentRate === null) return setError('Enter the agent’s split (0–100%).');
    if (carrierRate === null) return setError('Enter the carrier’s commission % (0–100%).');
    if (!evidence.trim()) return setError('Say what the rates are based on (the evidence).');
    setBusy(true);
    const ok = await run(() => repo.confirmHistoricalCommission(t.id, agent, agentRate, carrierRate, evidence.trim()), `Rates confirmed for ${policyLabel(t)} — it can be verified now.`);
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Review historical record — ${policyLabel(t)}`}
      subtitle="Confirm who wrote it and the rates that applied then. Nothing is assumed from today’s rates."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>Confirm rates</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="confirm-historical-form">
        <DialogError text={error} />
        <p className="text-sm text-[var(--color-ink-700)]">{t.clientName} · {t.kind === 'endorsement' ? 'endorsed' : 'bound'} {formatShortDate(t.eventDate)} · {t.carrierName} · net {formatCents(t.netCents)}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="hist-agent">Agent</label>
            <select id="hist-agent" className={inputClass} value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">— Choose</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="hist-split">Agent split (%)</label>
            <input id="hist-split" inputMode="decimal" className={inputClass} value={split} onChange={(e) => setSplit(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="hist-carrier">Carrier commission (%)</label>
            <input id="hist-carrier" inputMode="decimal" className={inputClass} value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="hist-evidence">Rate evidence</label>
          <input id="hist-evidence" className={inputClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={1000} placeholder="e.g. 2025 agreement, schedule A; agent split per offer letter" />
        </div>
        <p className="text-xs text-[var(--color-ink-600)]" data-testid="hist-preview">
          Agent commission: <strong>{agentRate === null ? '—' : formatCents(agentCommissionCents(t.netCents, carrierRate, agentRate) ?? 0)}</strong> (split of the carrier commission) · Carrier commission: <strong>{carrierRate === null ? '—' : formatCents(carrierCommissionCents(t.netCents, carrierRate) ?? 0)}</strong>
        </p>
      </div>
    </Modal>
  );
}

/**
 * A record saved without an agent or without the agent's split: fill in only what's missing, on the record
 * itself (the policy isn't recorded again). An agent already recorded stays; the reason goes in the audit.
 */
function ResolveAgentDialog({ t, run, onClose }: { t: LedgerTransaction; run: Run; onClose: () => void }) {
  const members = useAccountsStore((s) => s.agencyMembers);
  const [agent, setAgent] = useState(t.agentUserId ?? '');
  const [split, setSplit] = useState('');
  const [why, setWhy] = useState('');
  const [rates, setRates] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const agentRate = pctToRate(split);
  useEffect(() => {
    void fetchAgentCommissionRates().then((res) => res.ok && setRates(res.data));
  }, []);
  useEffect(() => {
    if (agent && rates[agent] !== undefined && !split) setSplit(rateToPct(rates[agent]));
  }, [agent, rates]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setError(''), [agent, split, why]);
  async function save() {
    if (!agent) return setError('Choose the agent who wrote it.');
    if (agentRate === null) return setError('Enter the agent’s split (0–100%).');
    if (!why.trim()) return setError('Say how the agent and split were decided.');
    setBusy(true);
    const ok = await run(() => repo.resolveCommissionAgent(t.id, agent, agentRate, why.trim()), `Agent and split added to ${policyLabel(t)} — it can be verified now.`);
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`${t.agentUserId ? 'Add the agent’s split' : 'Add the agent and split'} — ${policyLabel(t)}`}
      subtitle="Fills in only what's missing on this record. The policy and its amounts stay as recorded, and the change is kept in the audit."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="resolve-agent-form">
        <DialogError text={error} />
        <p className="text-sm text-[var(--color-ink-700)]">{t.clientName} · {t.kind === 'endorsement' ? 'endorsed' : 'bound'} {formatShortDate(t.eventDate)} · net {formatCents(t.netCents)}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="resolve-agent">Agent</label>
            <select id="resolve-agent" className={inputClass} value={agent} onChange={(e) => setAgent(e.target.value)} disabled={!!t.agentUserId}>
              <option value="">— Choose</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </select>
            {t.agentUserId && <p className="mt-1 text-[11px] text-[var(--color-ink-500)]">The agent recorded on it stays.</p>}
          </div>
          <div>
            <label className={labelClass} htmlFor="resolve-split">Agent split (%)</label>
            <input id="resolve-split" inputMode="decimal" className={inputClass} value={split} onChange={(e) => setSplit(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="resolve-why">Reason (kept in the audit)</label>
          <input id="resolve-why" className={inputClass} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={1000} placeholder="e.g. Agent confirmed from the binder email" />
        </div>
        <p className="text-xs text-[var(--color-ink-600)]" data-testid="resolve-preview">
          Agent commission: <strong>{agentRate === null || t.reviewFlags.includes('no_carrier_rate') ? '—' : formatCents(agentCommissionCents(t.netCents, t.carrierRate, agentRate) ?? 0)}</strong> (split of the carrier commission)
        </p>
      </div>
    </Modal>
  );
}

function LinkDialog({ t, all, run, onClose }: { t: LedgerTransaction; all: LedgerTransaction[]; run: Run; onClose: () => void }) {
  const policies = all.filter((x) => x.submissionId === t.submissionId && x.kind === 'policy' && x.verificationStatus !== 'void');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Link endorsement — ${policyLabel(t)}`}
      subtitle="Choose the policy this endorsement changes. It's never assigned automatically."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!pick || busy} onClick={async () => { setBusy(true); const ok = await run(() => repo.linkCommissionEndorsement(t.id, pick), 'Endorsement linked to its policy.'); setBusy(false); if (ok) onClose(); }}>Link</Button>
        </>
      }
    >
      {policies.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-600)]">No recorded policy on this account yet. Record the policy first (or run the historical backfill).</p>
      ) : (
        <div data-testid="link-form">
          <label className={labelClass} htmlFor="link-policy">Policy</label>
          <select id="link-policy" className={inputClass} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— Choose</option>
            {policies.map((p) => <option key={p.id} value={p.id}>{policyLabel(p)} — {p.carrierName}, bound {formatShortDate(p.eventDate)}, net {formatCents(p.netCents)}</option>)}
          </select>
        </div>
      )}
    </Modal>
  );
}

function CorrectDialog({ t, all, run, onClose }: { t: LedgerTransaction; all: LedgerTransaction[]; run: Run; onClose: () => void }) {
  const corrected = all.filter((x) => x.kind === 'correction' && x.originalTransactionId === t.id && x.verificationStatus !== 'void').reduce((s, x) => s + x.netCents, t.netCents);
  const [net, setNet] = useState('');
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = parseMoneyCents(net);
  const valid = cents !== null && !Number.isNaN(cents);
  useEffect(() => setError(''), [net, why]);
  const delta = valid ? (cents as number) - corrected : 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Correct — ${policyLabel(t)}`}
      subtitle="Adds a separate correction record for the difference, with the original agent, split and carrier rate. The original stays as it is."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!valid) return setError('Enter the corrected net premium.');
              if (!why.trim()) return setError('Say why it’s corrected.');
              setBusy(true);
              const ok = await run(() => repo.correctCommission(t.id, cents as number, why.trim()), `Correction added: net ${formatCents(delta)}.`);
              setBusy(false);
              if (ok) onClose();
            }}
          >
            Add correction
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="correct-form">
        <DialogError text={error} />
        <p className="text-sm text-[var(--color-ink-700)]">Net premium recorded so far: <strong>{formatCents(corrected)}</strong></p>
        <div>
          <label className={labelClass} htmlFor="correct-net">Corrected net premium ($)</label>
          <input id="correct-net" inputMode="decimal" className={inputClass} value={net} onChange={(e) => setNet(e.target.value)} autoFocus />
        </div>
        <div>
          <label className={labelClass} htmlFor="correct-why">Why</label>
          <input id="correct-why" className={inputClass} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={1000} placeholder="e.g. Carrier invoice shows a different premium" />
        </div>
        {valid && delta !== 0 && (
          <p className="text-xs text-[var(--color-ink-600)]" data-testid="correct-preview">
            Correction: net {formatCents(delta)} · agent {t.agentRate === null ? '—' : formatCents((agentCommissionCents(cents as number, t.carrierRate, t.agentRate) ?? 0) - (agentCommissionCents(corrected, t.carrierRate, t.agentRate) ?? 0))} · carrier {formatCents((carrierCommissionCents(cents as number, t.carrierRate) ?? 0) - (carrierCommissionCents(corrected, t.carrierRate) ?? 0))}
          </p>
        )}
      </div>
    </Modal>
  );
}

function ReceiptDialog({ t, run, onClose }: { t: LedgerTransaction; run: Run; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toLocalDateKey(new Date()));
  const [ref, setRef] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(''), [amount, date, ref]);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Carrier payment received — ${policyLabel(t)}`}
      subtitle={`Tracking only: it never changes the agent's commission or payout. Carrier commission expected: ${formatCents(t.carrierCents)}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              const c = parseMoneyCents(amount);
              if (c === null || Number.isNaN(c) || c === 0) return setError('Enter the amount received.');
              if (!date) return setError('Enter the date it was received.');
              setBusy(true);
              const ok = await run(() => repo.recordCarrierReceipt(t.id, c, date, ref), `Carrier payment of ${formatCents(c)} recorded.`);
              setBusy(false);
              if (ok) onClose();
            }}
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="receipt-form">
        <div className="sm:col-span-3"><DialogError text={error} /></div>
        <div>
          <label className={labelClass} htmlFor="receipt-amount">Amount ($)</label>
          <input id="receipt-amount" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <div>
          <label className={labelClass} htmlFor="receipt-date">Received</label>
          <input id="receipt-date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="receipt-ref">Reference</label>
          <input id="receipt-ref" className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Statement no." />
        </div>
      </div>
    </Modal>
  );
}

function SettleDialog({ ids, all, run, onClose, onDone }: { ids: string[]; all: LedgerTransaction[]; run: Run; onClose: () => void; onDone?: () => void }) {
  const list = all.filter((t) => ids.includes(t.id));
  const [why, setWhy] = useState('');
  const [count, setCount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const agentTotal = list.reduce((s, t) => s + (t.agentCents ?? 0), 0);
  useEffect(() => setError(''), [why, count]);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Mark settled outside RenewalIQ"
      subtitle="Only for historical commissions you know were already paid. They stay for history and are never paid again. This can't be undone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (!why.trim()) return setError('Say how they were settled.');
              if (Number(count) !== list.length) return setError(`Type ${list.length} to confirm the number of records.`);
              setBusy(true);
              const ok = await run(() => repo.settleCommissionsOutside(ids, why.trim(), Number(count)), `${list.length} historical ${list.length === 1 ? 'record' : 'records'} marked settled outside RenewalIQ.`);
              setBusy(false);
              if (ok) {
                onDone?.();
                onClose();
              }
            }}
          >
            Mark {list.length} settled
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="settle-form">
        <DialogError text={error} />
        <ul className="max-h-48 overflow-y-auto text-sm">
          {list.map((t) => <li key={t.id}>{t.clientName} — {policyLabel(t)} · {formatShortDate(t.eventDate)} · net {formatCents(t.netCents)}</li>)}
        </ul>
        <p className="text-xs text-[var(--color-ink-600)]">Agent commission on these (as recorded, unconfirmed): {formatCents(agentTotal)}</p>
        <div>
          <label className={labelClass} htmlFor="settle-why">How were they settled?</label>
          <input id="settle-why" className={inputClass} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={1000} placeholder="e.g. Paid through the previous system, statements 2025-01 to 2025-09" />
        </div>
        <div>
          <label className={labelClass} htmlFor="settle-count">Type the number of records to confirm ({list.length})</label>
          <input id="settle-count" inputMode="numeric" className={inputClass} value={count} onChange={(e) => setCount(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────── records ───────────────────────────────

type StatusFilter = 'all' | LedgerStatus;

function RecordsSection({ all, receipts, schedule, run }: { all: LedgerTransaction[]; receipts: import('../../services/finance/ledger').CarrierReceipt[]; schedule: PayoutSchedule; run: Run }) {
  const agentName = useAgentName();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [kind, setKind] = useState<'all' | LedgerTransaction['kind']>('all');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const rows = all.filter(
    (t) =>
      (status === 'all' || ledgerStatus(t) === status) &&
      (kind === 'all' || t.kind === kind) &&
      (!search.trim() || [t.clientName, t.policyNumber, t.carrierName, agentName(t)].some((v) => (v ?? '').toLowerCase().includes(search.trim().toLowerCase())))
  );
  const totals = rows.reduce((s, t) => (t.verificationStatus === 'void' ? s : { net: s.net + t.netCents, agent: s.agent + (t.agentCents ?? 0), carrier: s.carrier + t.carrierCents }), { net: 0, agent: 0, carrier: 0 });
  const report = (): Report => ({
    title: 'Commission records',
    subtitle: [`${rows.length} records`, status !== 'all' ? `Status: ${STATUS_LABELS[status]}` : '', kind !== 'all' ? `Kind: ${KIND_LABELS[kind]}` : '', search ? `Search: “${search}”` : ''].filter(Boolean),
    columns: [
      { header: 'Client' }, { header: 'Policy' }, { header: 'Kind' }, { header: 'Date', kind: 'date' }, { header: 'Carrier' }, { header: 'Net', kind: 'money' },
      { header: 'Agent' }, { header: 'Agent split' }, { header: 'Agent commission', kind: 'money' }, { header: 'Carrier %' }, { header: 'Carrier commission', kind: 'money' },
      { header: 'Status' }, { header: 'Expected payout', kind: 'date' }, { header: 'Carrier received', kind: 'money' },
    ],
    rows: rows.map((t) => [
      t.clientName, t.policyNumber ?? '', KIND_LABELS[t.kind], t.eventDate, t.carrierName, t.netCents, agentName(t), t.agentRate === null ? '' : formatRate(t.agentRate), t.agentCents,
      t.carrierRateSource === 'actual' ? 'actual' : formatRate(t.carrierRate), t.carrierCents, STATUS_LABELS[ledgerStatus(t)], payoutDate(schedule, t.stream, t.payableFrom), carrierReceived(t, receipts).receivedCents,
    ]),
    totals: ['Total (not void)', '', '', '', '', totals.net, '', '', totals.agent, '', totals.carrier, '', '', null],
    fileBase: `commission-records-${toLocalDateKey(new Date())}`,
  });
  const actions = (t: LedgerTransaction) => {
    const items: { key: string; label: string; onSelect: () => void }[] = [];
    if ((t.kind === 'policy' || t.kind === 'endorsement') && (t.verificationStatus === 'verified' || t.settlement === 'settled_outside')) items.push({ key: 'correct', label: 'Correct the net premium…', onSelect: () => setDialog({ kind: 'correct', t }) });
    if (t.verificationStatus !== 'void') items.push({ key: 'receipt', label: 'Carrier payment received…', onSelect: () => setDialog({ kind: 'receipt', t }) });
    for (const r of receipts.filter((x) => x.transactionId === t.id && !x.voidedAt))
      items.push({
        key: `void-${r.id}`,
        label: `Void carrier payment ${formatCents(r.amountCents)} (${formatShortDate(r.receivedDate)})…`,
        onSelect: () => setDialog({ kind: 'reason', title: 'Void carrier payment', label: 'Why', confirm: 'Void payment', onConfirm: (why) => run(() => repo.voidCarrierReceipt(r.id, why), 'Carrier payment voided (kept in the history).') }),
      });
    return items;
  };
  return (
    <Card>
      <CardBody className="pt-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="rec-status">Status</label>
            <select id="rec-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="all">All</option>
              {(Object.keys(STATUS_LABELS) as LedgerStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="rec-kind">Kind</label>
            <select id="rec-kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">All</option>
              {(Object.keys(KIND_LABELS) as LedgerTransaction['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="rec-search">Search</label>
            <input id="rec-search" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Client, policy, carrier or agent" />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <DownloadButtons report={report} disabled={rows.length === 0} testId="records-download" />
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full border-collapse" data-testid="records-table">
            <thead>
              <tr>
                <th className={th}>Record</th>
                <th className={`${th} ${num}`}>Net</th>
                <th className={`${th} ${num}`}>Agent commission</th>
                <th className={`${th} ${num}`}>Carrier commission</th>
                <th className={th}>Payout</th>
                <th className={th}>Carrier paid</th>
                <th className={th} />
              </tr>
              <tr className="tabular-nums" data-testid="records-totals">
                <td className={`${td} font-semibold`}>Totals ({rows.length}, void left out)</td>
                <td className={`${td} ${num} font-semibold`} data-total="net">{formatCents(totals.net)}</td>
                <td className={`${td} ${num} font-semibold`} data-total="agent">{formatCents(totals.agent)}</td>
                <td className={`${td} ${num} font-semibold`} data-total="carrier">{formatCents(totals.carrier)}</td>
                <td className={td} />
                <td className={td} />
                <td className={td} />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const ready = payoutReadiness(t);
                const rec = carrierReceived(t, receipts);
                return (
                  <tr key={t.id} data-record={t.id} data-kind={t.kind}>
                    <td className={`${td} min-w-[320px]`}><RecordSummary t={t} schedule={schedule} /></td>
                    <td className={`${td} ${num}`}>{formatCents(t.netCents)}</td>
                    <td className={`${td} ${num}`} data-field="agent-cents">{t.agentCents === null ? '—' : formatCents(t.agentCents)}</td>
                    <td className={`${td} ${num}`} data-field="carrier-cents">{formatCents(t.carrierCents)}</td>
                    <td className={`${td} text-xs`} data-field="payout">
                      {ledgerStatus(t) === 'void' || ledgerStatus(t) === 'settled_outside' ? '—' : formatShortDate(payoutDate(schedule, t.stream, t.payableFrom))}
                      <span className={`block ${ready.payable ? 'text-[var(--color-success-600)]' : 'text-[var(--color-ink-500)]'}`}>{ready.note}</span>
                    </td>
                    <td className={`${td} text-xs`} data-field="carrier-paid">{rec.state === 'none' ? 'Not recorded' : `${formatCents(rec.receivedCents)}${rec.state === 'partial' ? ' (part)' : rec.state === 'over' ? ' (more than expected)' : ''}`}</td>
                    <td className={td}>{actions(t).length > 0 && <OverflowMenu items={actions(t)} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-6 text-center text-sm text-[var(--color-ink-500)]">No records match.</p>}
        </div>
        <Dialogs dialog={dialog} all={all} run={run} onClose={() => setDialog(null)} />
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────── cancellations ───────────────────────────────

function CancellationsSection({ cancellations, all, run }: { cancellations: LedgerCancellation[]; all: LedgerTransaction[]; run: Run }) {
  const members = useAccountsStore((s) => s.agencyMembers);
  const [approving, setApproving] = useState<LedgerCancellation | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const byId = new Map(all.map((t) => [t.id, t]));
  const open = cancellations.filter((c) => c.status === 'requested' || c.status === 'awaiting_amount');
  const done = cancellations.filter((c) => !open.includes(c));
  const requester = (id: string) => members.find((m) => m.userId === id)?.name ?? 'Agent';
  const card = (c: LedgerCancellation) => {
    const t = byId.get(c.transactionId);
    const result = c.resultTransactionId ? byId.get(c.resultTransactionId) : undefined;
    return (
      <li key={c.id} className="flex items-start justify-between gap-3 border-b border-[var(--color-ink-50)] py-3 last:border-b-0" data-cancellation={c.id}>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--color-ink-900)]">{t?.clientName ?? 'Account'}</span>
            <span>{t ? policyLabel(t) : ''}</span>
            <Badge tone={c.cancelType === 'full' ? 'danger' : 'warning'}>{c.cancelType === 'full' ? 'Full cancellation' : 'Partial cancellation'}</Badge>
            <Badge tone={c.status === 'approved' ? 'success' : c.status === 'awaiting_amount' ? 'info' : c.status === 'requested' ? 'warning' : 'neutral'}>
              {{ requested: 'Requested', awaiting_amount: 'Waiting for the carrier’s amount', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn' }[c.status]}
            </Badge>
          </p>
          <p className="text-xs text-[var(--color-ink-600)]">
            Effective {formatShortDate(c.effectiveDate)} · requested by {requester(c.requestedBy)} {formatShortDate(c.requestedAt.slice(0, 10))}
            {c.expectedRefundCents !== null ? ` · expected refund ${formatCents(c.expectedRefundCents)}` : ''} · {c.documentIds.length ? `${c.documentIds.length} document${c.documentIds.length === 1 ? '' : 's'}` : 'no notice attached'}
          </p>
          <p className="text-xs text-[var(--color-ink-700)]">“{c.reason}”</p>
          {c.decisionNote && <p className="text-xs text-[var(--color-ink-500)]">Note: {c.decisionNote}</p>}
          {result && (
            <p className="text-xs text-[var(--color-ink-700)]" data-field="cancellation-result">
              Returned net {formatCents(-result.netCents)} · agent adjustment <strong>{result.agentCents === null ? '—' : formatCents(result.agentCents)}</strong> · carrier commission returned {formatCents(-result.carrierCents)}
            </p>
          )}
        </div>
        {open.includes(c) && (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" onClick={() => setApproving(c)} disabled={!t}>Approve…</Button>
            <OverflowMenu
              items={[
                ...(c.status === 'requested' ? [{ key: 'await', label: 'Waiting for the carrier’s amount', onSelect: () => void run(() => repo.markCancellationAwaiting(c.id), 'Marked as waiting for the carrier’s amount.') }] : []),
                { key: 'reject', label: 'Reject…', tone: 'danger' as const, onSelect: () => setDialog({ kind: 'reason', title: 'Reject the cancellation request', label: 'Why', confirm: 'Reject', onConfirm: (why) => run(() => repo.rejectCancellation(c.id, why), 'Request rejected.') }) },
              ]}
            />
          </div>
        )}
      </li>
    );
  };
  return (
    <>
      <Card>
        <CardBody className="pt-4">
          <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Waiting for a decision ({open.length})</h3>
          <p className="text-xs text-[var(--color-ink-500)]">Approve with the carrier’s actual refund. The adjustment uses the original policy’s agent and split; the original is never changed or deleted.</p>
          {open.length ? <ul className="mt-2" data-testid="cancellations-open">{open.map(card)}</ul> : <p className="mt-3 text-sm text-[var(--color-ink-500)]">No open requests.</p>}
        </CardBody>
      </Card>
      {done.length > 0 && (
        <Card>
          <CardBody className="pt-4">
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Decided</h3>
            <ul className="mt-2" data-testid="cancellations-done">{done.map(card)}</ul>
          </CardBody>
        </Card>
      )}
      {approving && byId.get(approving.transactionId) && <ApproveDialog c={approving} t={byId.get(approving.transactionId)!} all={all} run={run} onClose={() => setApproving(null)} />}
      <Dialogs dialog={dialog} all={all} run={run} onClose={() => setDialog(null)} />
    </>
  );
}

function ApproveDialog({ c, t, all, run, onClose }: { c: LedgerCancellation; t: LedgerTransaction; all: LedgerTransaction[]; run: Run; onClose: () => void }) {
  const agentName = useAgentName();
  const remaining = remainingNetCents(t.id, all);
  const [returned, setReturned] = useState('');
  const [carrier, setCarrier] = useState('');
  const [note, setNote] = useState('');
  const [noProof, setNoProof] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const r = parseMoneyCents(returned);
  const rValid = r !== null && !Number.isNaN(r) && r > 0;
  const k = parseMoneyCents(carrier);
  const kValid = k !== null && !Number.isNaN(k) && k >= 0;
  const originalOk = t.verificationStatus === 'verified' || t.settlement === 'settled_outside';
  useEffect(() => setError(''), [returned, carrier, note, noProof]);
  async function approve() {
    if (!rValid) return setError('Enter the actual net premium returned by the carrier.');
    if ((r as number) > remaining) return setError(`That’s more than the ${formatCents(remaining)} net premium left on the policy.`);
    if (!kValid) return setError('Enter the actual carrier commission returned (0 if none).');
    if (!c.documentIds.length && !noProof.trim()) return setError('No cancellation notice is attached: give the reason for approving without it.');
    setBusy(true);
    const ok = await run(() => repo.approveCancellation(c.id, r as number, k as number, note, noProof), 'Cancellation approved — a negative record linked to the policy was added.');
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Approve cancellation — ${policyLabel(t)}`}
      subtitle="Enter the carrier’s actual amounts. Nothing is worked out until you have them."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !originalOk} onClick={() => void approve()}>Approve cancellation</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="approve-form">
        <DialogError text={error} />
        {!originalOk && <p className="text-sm text-[var(--color-warning-600)]">The original policy isn’t verified yet. Verify it first (or void it if it was never written).</p>}
        <p className="text-sm text-[var(--color-ink-700)]">
          Original: {formatShortDate(t.eventDate)} · net {formatCents(t.netCents)} · agent <strong>{agentName(t)}</strong>{t.agentRate !== null ? ` at ${formatRate(t.agentRate)}` : ''} · carrier {formatRate(t.carrierRate)}. Left on the policy: <strong data-testid="remaining-net">{formatCents(remaining)}</strong>.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="approve-returned">Net premium returned ($)</label>
            <input id="approve-returned" inputMode="decimal" className={inputClass} value={returned} onChange={(e) => setReturned(e.target.value)} autoFocus placeholder={c.expectedRefundCents ? `Expected ${formatCents(c.expectedRefundCents)}` : ''} />
          </div>
          <div>
            <label className={labelClass} htmlFor="approve-carrier">Carrier commission returned ($)</label>
            <input id="approve-carrier" inputMode="decimal" className={inputClass} value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            {rValid && (
              <button type="button" className="mt-1 cursor-pointer text-xs font-medium text-[var(--color-brand-700)] hover:underline" onClick={() => setCarrier(String(((carrierCommissionCents(r as number, t.carrierRate) ?? 0) / 100).toFixed(2)))}>
                Use {formatCents(carrierCommissionCents(r as number, t.carrierRate) ?? 0)} (the original {formatRate(t.carrierRate)}) — only if the carrier’s statement says so
              </button>
            )}
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="approve-note">Note</label>
          <input id="approve-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Per carrier statement 11-2026" />
        </div>
        {!c.documentIds.length && (
          <div>
            <label className={labelClass} htmlFor="approve-noproof">No cancellation notice attached — reason for approving without it</label>
            <input id="approve-noproof" className={inputClass} value={noProof} onChange={(e) => setNoProof(e.target.value)} maxLength={1000} />
          </div>
        )}
        {rValid && t.agentRate !== null && (
          <p className="rounded-lg bg-[var(--color-ink-50)] px-3 py-2 text-sm text-[var(--color-ink-800)]" data-testid="approve-preview">
            Agent adjustment: <strong>{formatCents(agentCommissionCents(-(r as number), t.carrierRate, t.agentRate) ?? 0)}</strong> ({agentName(t)}: −{formatCents(r as number)} × {formatRate(t.carrierRate)} × {formatRate(t.agentRate)}), carried against future payouts if needed · Agency: −{kValid ? formatCents(k as number) : '—'} carrier commission
          </p>
        )}
      </div>
    </Modal>
  );
}

// ─────────────────────────────── carrier rates ───────────────────────────────

function CarrierRatesSection() {
  const carrier = useCarrierRates();
  const userId = useAccountsStore((s) => s.currentUserId);
  const [adding, setAdding] = useState<{ carrier?: string } | null>(null);
  const [retiring, setRetiring] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const groups = useMemo(() => {
    const m = new Map<string, typeof carrier.rows>();
    for (const r of carrier.rows) m.set(r.carrierKey, [...(m.get(r.carrierKey) ?? []), r]);
    return [...m.values()].sort((a, b) => a[0].carrierName.localeCompare(b[0].carrierName));
  }, [carrier.rows]);
  const today = toLocalDateKey(new Date());
  return (
    <Card>
      <CardBody className="pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Carrier commission rates</h3>
            <p className="text-xs text-[var(--color-ink-500)]">What each carrier pays the agency, from a date (no commission until one is set). Confidential: only admins see them. Commissions already recorded keep their rate.</p>
          </div>
          <Button size="sm" onClick={() => setAdding({})} disabled={carrier.status !== 'ready'}>Add a rate</Button>
        </div>
        {carrier.status === 'unavailable' && <p className="mt-3 text-sm text-[var(--color-warning-600)]" data-testid="rates-unavailable">{carrier.message ?? 'Carrier rates aren’t available.'}</p>}
        {message && <p className="mt-3 text-sm text-[var(--color-danger-600)]" role="alert">{message}</p>}
        {carrier.status === 'ready' && groups.length === 0 && <p className="mt-3 text-sm text-[var(--color-ink-500)]">No carrier rates yet: no commission is worked out until one is set.</p>}
        <div className="mt-3 flex flex-col gap-3" data-testid="carrier-rates">
          {groups.map((rows) => {
            const now = rows.filter((r) => !r.retiredAt && r.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
            return (
              <div key={rows[0].carrierKey} className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2" data-carrier={rows[0].carrierKey}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--color-ink-900)]">
                    {rows[0].carrierName} <span className="font-normal text-[var(--color-ink-500)]">— today {now ? formatRate(now.rate) : 'not set'}</span>
                  </p>
                  <Button size="sm" variant="secondary" onClick={() => setAdding({ carrier: rows[0].carrierName })}>New rate from a date</Button>
                </div>
                <table className="mt-1 min-w-full text-xs">
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={r.retiredAt ? 'text-[var(--color-ink-400)] line-through' : 'text-[var(--color-ink-700)]'} data-rate={r.id}>
                        <td className="py-1 pr-3 tabular-nums">{formatRate(r.rate)}</td>
                        <td className="py-1 pr-3">from {formatShortDate(r.effectiveFrom)}{r.effectiveFrom > today ? ' (upcoming)' : ''}</td>
                        <td className="py-1 pr-3">{r.evidence ?? <span className="text-[var(--color-ink-400)]">no evidence noted</span>}</td>
                        <td className="py-1 pr-3 no-underline">{r.retiredAt ? `retired: ${r.retiredReason}` : ''}</td>
                        <td className="py-1 text-right">
                          {!r.retiredAt && (
                            <button type="button" className="cursor-pointer font-medium text-[var(--color-danger-600)] hover:underline" onClick={() => setRetiring(r.id)} aria-label={`Retire ${formatRate(r.rate)} from ${r.effectiveFrom}`}>
                              Retire…
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        {adding && <CarrierRateDialog carrier={adding.carrier} onClose={() => setAdding(null)} />}
        {retiring !== null && (
          <ReasonDialog
            title="Retire this rate"
            label="Why (kept in the history)"
            confirm="Retire"
            description="Use this for a rate entered by mistake. Policies then use the rate before it (or none). Commissions already recorded keep their rate."
            onClose={() => setRetiring(null)}
            onConfirm={async (why) => {
              const res = await retireCarrierCommissionRate(retiring, why);
              if (!res.ok) {
                setMessage(res.message);
                return false;
              }
              setMessage('');
              await reloadCarrierRates(userId);
              return true;
            }}
          />
        )}
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────── payout schedule ───────────────────────────────

function ScheduleSection({ schedule, historicalWaiting, run }: { schedule: PayoutSchedule; historicalWaiting: number; run: Run }) {
  const [s, setS] = useState<PayoutSchedule>(schedule);
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Record<string, number> | null>(null);
  const [confirmBackfill, setConfirmBackfill] = useState(false);
  const changed = JSON.stringify(s) !== JSON.stringify(schedule);
  const words = describeSchedule(s);
  const today = toLocalDateKey(new Date());
  const dow = (id: string, value: number, onChange: (n: number) => void) => (
    <select id={id} className={inputClass} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {WEEKDAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
    </select>
  );
  return (
    <>
      <Card>
        <CardBody className="pt-4" data-testid="schedule-form">
          <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Payout schedule</h3>
          <p className="text-xs text-[var(--color-ink-500)]">Agent commission is payable from the bound date — never waiting for the carrier’s payment — once verified. Weekly for policies, monthly for endorsements; each payout is approved and marked paid on the Payouts tab.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelClass} htmlFor="sch-week-start">Policy week starts</label>
              {dow('sch-week-start', s.weeklyPeriodStartDow, (n) => setS({ ...s, weeklyPeriodStartDow: n }))}
            </div>
            <div>
              <label className={labelClass} htmlFor="sch-week-pay">Paid the following</label>
              {dow('sch-week-pay', s.weeklyPayDow, (n) => setS({ ...s, weeklyPayDow: n }))}
            </div>
            <div>
              <label className={labelClass} htmlFor="sch-month-rule">Endorsements paid on</label>
              <select id="sch-month-rule" className={inputClass} value={s.monthlyPayRule} onChange={(e) => setS({ ...s, monthlyPayRule: e.target.value as PayoutSchedule['monthlyPayRule'], monthlyPayDay: e.target.value === 'day_of_month' ? (s.monthlyPayDay ?? 15) : null })}>
                <option value="first_weekday">the first weekday of the next month</option>
                <option value="day_of_month">a day of the next month</option>
              </select>
            </div>
            <div>
              {s.monthlyPayRule === 'first_weekday' ? (
                <>
                  <label className={labelClass} htmlFor="sch-month-dow">Weekday</label>
                  {dow('sch-month-dow', s.monthlyPayDow, (n) => setS({ ...s, monthlyPayDow: n }))}
                </>
              ) : (
                <>
                  <label className={labelClass} htmlFor="sch-month-day">Day (1–28)</label>
                  <input id="sch-month-day" inputMode="numeric" className={inputClass} value={s.monthlyPayDay ?? ''} onChange={(e) => setS({ ...s, monthlyPayDay: Number(e.target.value) || null })} />
                </>
              )}
            </div>
          </div>
          <ul className="mt-3 text-sm text-[var(--color-ink-700)]" data-testid="schedule-words">
            <li>{words.weekly} A policy bound today ({formatShortDate(today)}) is paid {formatShortDate(payoutDate(s, 'weekly', today))}.</li>
            <li>{words.monthly} An endorsement dated today is paid {formatShortDate(payoutDate(s, 'monthly', today))}.</li>
          </ul>
          {changed && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className={labelClass} htmlFor="sch-why">Why it changes (kept in the audit)</label>
                <input id="sch-why" className={inputClass} value={why} onChange={(e) => (setWhy(e.target.value), setError(''))} maxLength={1000} />
              </div>
              <Button
                onClick={async () => {
                  if (!why.trim()) return setError('Say why the schedule changes.');
                  if (s.monthlyPayRule === 'day_of_month' && (!s.monthlyPayDay || s.monthlyPayDay < 1 || s.monthlyPayDay > 28)) return setError('Choose a day between 1 and 28.');
                  if (await run(() => repo.setPayoutSchedule(s, why.trim()), 'Payout schedule saved.')) setWhy('');
                }}
              >
                Save schedule
              </Button>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-[var(--color-danger-600)]" role="alert">{error}</p>}
        </CardBody>
      </Card>
      <Card>
        <CardBody className="pt-4" data-testid="backfill">
          <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Historical records</h3>
          <p className="text-xs text-[var(--color-ink-500)]">Policies and endorsements that existed before commission tracking. Recording them puts them in Review as “Historical – needs review”: never verified with today’s rates, never paid until you confirm them or mark them settled outside RenewalIQ.</p>
          <p className="mt-2 text-sm text-[var(--color-ink-700)]">{historicalWaiting} waiting to be recorded.</p>
          {preview && (
            <p className="mt-1 text-xs text-[var(--color-ink-600)]" data-testid="backfill-preview">
              Would record {preview.to_record ?? 0} ({preview.policies ?? 0} policies, {preview.endorsements ?? 0} endorsements); {preview.endorsements_without_link ?? 0} endorsements without a policy link and {preview.without_agent ?? 0} without an agent will be flagged; {preview.removed_or_gone ?? 0} removed ones are skipped.
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" onClick={async () => { const res = await repo.backfillPreview(); if (res.ok) setPreview(res.data); else setError(res.message); }}>Count them</Button>
            <Button size="sm" disabled={historicalWaiting === 0} onClick={() => setConfirmBackfill(true)}>Record for review…</Button>
          </div>
        </CardBody>
      </Card>
      <ConfirmDialog
        open={confirmBackfill}
        onCancel={() => setConfirmBackfill(false)}
        onConfirm={() => {
          setConfirmBackfill(false);
          void run(async () => {
            const res = await repo.backfillHistorical();
            return res.ok ? { ok: true } : res;
          }, 'Historical policies and endorsements recorded for review.');
        }}
        title="Record the historical policies for review?"
        description="They're recorded with the agent on the account today and flagged as unconfirmed. None is verified or paid until you review it."
        confirmLabel="Record for review"
        variant="default"
      />
    </>
  );
}
