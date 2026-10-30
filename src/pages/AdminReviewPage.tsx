import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Copy, Handshake, Loader2, Lock, Undo2 } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState } from '../components/ui';
import { useAccountsStore } from '../state/useAccountsStore';
import { REASON_LABELS, fetchAdminReviewItems, resolveAdminReview, type AdminReviewItem, type ReviewAccount } from '../services/supabase/adminReviewRepo';
import { declineCancellationUndo, fetchPolicyCancellations, undoCancellation, type PolicyCancellation } from '../services/supabase/ledgerRepo';
import { formatShortDate, toLocalDateKey } from '../services/workflow/dates';
import { formatCents } from '../services/workflow/policies';
import { cn } from '../utils/cn';
import { fetchBrokerFeeShares, resolveOtherReferral, setAgentBrokerFeeShare, type BrokerFeeShare } from '../services/supabase/partnersRepo';
import { reloadOtherReferrals } from '../hooks/useOtherReferrals';
import { reloadReferralSources } from '../hooks/useReferralSources';
import { reloadBrokerFeeShares } from '../hooks/useBrokerFeeShare';
import { centsInput, parseMoneyCents } from '../services/workflow/policies';
import { useOnDataRefresh } from '../services/appFreshness';

const day = (iso: string | null | undefined) => (iso ? formatShortDate(toLocalDateKey(new Date(iso))) : '—');

/**
 * Admin Review (agency admins): one place for what needs an admin — accounts an agent created that may
 * duplicate an existing one (0080), and agents' requests to undo a cancellation after its week (0076).
 * The bell links straight to an item (?item=).
 */
export function AdminReviewPage() {
  const isAdmin = useAccountsStore((s) => s.agencyAccess?.role === 'admin');
  const [params] = useSearchParams();
  const focus = params.get('item');
  const [items, setItems] = useState<AdminReviewItem[] | null>(null);
  const [undos, setUndos] = useState<PolicyCancellation[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([fetchAdminReviewItems(), fetchPolicyCancellations()]);
    if (r.ok) setItems(r.data);
    else {
      setItems([]);
      setError(r.message);
    }
    if (c.ok) setUndos(c.data.filter((x) => x.undoRequestedAt && !x.undoneAt && x.status === 'approved'));
  }, []);
  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);
  useOnDataRefresh(() => {
    if (isAdmin) void load();
  });
  useEffect(() => {
    if (focus && items) document.getElementById(`review-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus, items]);

  if (!isAdmin) {
    return (
      <PageContainer title="Admin Review">
        <EmptyState icon={<Lock size={24} strokeWidth={1.5} />} title="Admins only" description="Admin Review is for your agency's admins." />
      </PageContainer>
    );
  }
  const open = (items ?? []).filter((i) => i.status === 'open' && i.kind === 'possible_duplicate');
  const partners = (items ?? []).filter((i) => i.status === 'open' && i.kind === 'other_referral');
  const decided = (items ?? []).filter((i) => i.status === 'resolved');

  return (
    <PageContainer title="Admin Review" description="What needs an admin's decision: Other referral partners, possible duplicate accounts and requests to undo a cancellation.">
      {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
      {items === null ? (
        <p className="flex items-center gap-2 text-sm text-[var(--color-ink-500)]"><Loader2 size={15} className="animate-spin" /> Loading…</p>
      ) : (
        <>
          <section className="flex flex-col gap-3" data-testid="review-partners">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-700)]">
              <Handshake size={15} /> Other referral partners
              <span className="rounded-full bg-[var(--color-ink-100)] px-1.5 py-0.5 text-xs text-[var(--color-ink-600)]">{partners.length}</span>
            </h2>
            {partners.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-500)]">Nothing to review.</p>
            ) : (
              partners.map((i) => <OtherReferralItem key={i.id} item={i} focused={i.id === focus} onDone={load} />)
            )}
          </section>

          <section className="flex flex-col gap-3" data-testid="review-duplicates">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-700)]">
              <Copy size={15} /> Possible duplicate accounts
              <span className="rounded-full bg-[var(--color-ink-100)] px-1.5 py-0.5 text-xs text-[var(--color-ink-600)]">{open.length}</span>
            </h2>
            {open.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-500)]">Nothing to review.</p>
            ) : (
              open.map((i) => <DuplicateItem key={i.id} item={i} focused={i.id === focus} onDone={load} />)
            )}
          </section>

          <section className="flex flex-col gap-3" data-testid="review-undos">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-700)]">
              <Undo2 size={15} /> Requests to undo a cancellation
              <span className="rounded-full bg-[var(--color-ink-100)] px-1.5 py-0.5 text-xs text-[var(--color-ink-600)]">{undos.length}</span>
            </h2>
            {undos.length === 0 ? <p className="text-sm text-[var(--color-ink-500)]">Nothing to review.</p> : undos.map((c) => <UndoItem key={c.id} c={c} onDone={load} />)}
          </section>

          {decided.length > 0 && <DecidedList items={decided} />}
        </>
      )}
    </PageContainer>
  );
}

function AccountBox({ title, a, tone }: { title: string; a: ReviewAccount; tone: 'new' | 'existing' }) {
  const navigate = useNavigate();
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-1 rounded-lg border px-3 py-2.5', tone === 'new' ? 'border-[var(--color-warning-500)]/40 bg-[var(--color-warning-100)]/40' : 'border-[var(--color-ink-100)] bg-white')}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]">{title}</p>
      <p className="truncate font-semibold text-[var(--color-ink-900)]">{a.name}</p>
      <p className="text-xs text-[var(--color-ink-500)]">
        Agent: {a.agent || 'Unassigned'}
        {a.createdAt ? ` · created ${day(a.createdAt)}` : ''}
        {a.archived ? ' · archived' : ''}
      </p>
      {a.reasons.length > 0 && (
        <p className="flex flex-wrap gap-1">
          {a.reasons.map((r) => (
            <Badge key={r} tone="warning">{REASON_LABELS[r] ?? r}</Badge>
          ))}
        </p>
      )}
      <button type="button" onClick={() => navigate(`/accounts/${a.id}`)} className="mt-1 inline-flex w-fit cursor-pointer items-center gap-1 text-xs font-medium text-[var(--color-brand-700)] hover:underline">
        Open account <ArrowRight size={12} />
      </button>
    </div>
  );
}

function DuplicateItem({ item, focused, onDone }: { item: AdminReviewItem; focused: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState<'keep_both' | 'archive_new' | null>(null);
  const [error, setError] = useState('');
  const hydrate = useAccountsStore((s) => s.hydrateCloudSubmissions);
  async function decide(action: 'keep_both' | 'archive_new') {
    setBusy(action);
    setError('');
    const r = await resolveAdminReview(item.id, action);
    setBusy(null);
    if (!r.ok) return setError(r.message);
    if (action === 'archive_new') void hydrate();
    onDone();
  }
  return (
    <Card>
      <CardBody className={cn('flex flex-col gap-3 pt-4', focused && 'rounded-xl ring-2 ring-[var(--color-brand-500)]/40')} id={`review-${item.id}`} data-testid="review-item">
        <p className="text-sm text-[var(--color-ink-700)]">
          <span className="font-medium text-[var(--color-ink-900)]">{item.createdByName ?? 'An agent'}</span> created <span className="font-medium text-[var(--color-ink-900)]">{item.account.name}</span> on {day(item.createdAt)}. It may duplicate {item.related.length === 1 ? 'an existing account' : `${item.related.length} existing accounts`}.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <AccountBox title="New account" a={item.account} tone="new" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {item.related.map((r) => (
              <AccountBox key={r.id} title="Existing account" a={r} tone="existing" />
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => void decide('keep_both')} disabled={!!busy}>{busy === 'keep_both' ? 'Saving…' : 'Keep both'}</Button>
          <Button onClick={() => void decide('archive_new')} disabled={!!busy || item.account.archived}>{busy === 'archive_new' ? 'Archiving…' : 'Archive the new one'}</Button>
        </div>
      </CardBody>
    </Card>
  );
}

const field = 'rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-sm text-[var(--color-ink-900)] outline-none focus:border-[var(--color-brand-500)]';

/**
 * An agent chose "Other" as a client's referral partner (0083): it already counts in the broker fee split. The admin
 * marks it OK, changes the amount, adds it to the partner list, or rejects it (the client goes back to "not set").
 * When the agent has no broker fee share yet, it can be set here too.
 */
function OtherReferralItem({ item, focused, onDone }: { item: AdminReviewItem; focused: boolean; onDone: () => void }) {
  const o = item.other!;
  const now = o.current ?? { name: o.name, partnerFeeCents: o.partnerFeeCents };
  const navigate = useNavigate();
  const hydrate = useAccountsStore((s) => s.hydrateCloudSubmissions);
  const agentId = useAccountsStore((s) => s.accounts.find((a) => a.id === item.account.id)?.assignedUserId ?? null);
  const [fee, setFee] = useState(centsInput(now.partnerFeeCents));
  const [shares, setShares] = useState<Record<string, BrokerFeeShare> | null>(null);
  const [share, setShare] = useState<{ mode: 'amount' | 'percent'; value: string }>({ mode: 'percent', value: '' });
  const [busy, setBusy] = useState<'ok' | 'change' | 'add' | 'reject' | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetchBrokerFeeShares().then((r) => setShares(r.ok ? r.data : {}));
  }, []);
  const needsShare = !!agentId && !!shares && !shares[agentId];
  const feeCents = parseMoneyCents(fee);
  const changed = feeCents !== null && !Number.isNaN(feeCents) && feeCents !== now.partnerFeeCents;

  async function decide(action: 'ok' | 'change' | 'add' | 'reject') {
    setError('');
    if (action !== 'reject' && (feeCents === null || Number.isNaN(feeCents) || feeCents < 0)) return setError('Enter the amount in dollars, e.g. 50.00.');
    let nextShare: BrokerFeeShare | null = null;
    if (action !== 'reject' && needsShare && share.value.trim()) {
      const n = Number(share.value.replace(/[$,%\s]/g, ''));
      if (!Number.isFinite(n) || n < 0 || (share.mode === 'percent' && n > 100)) return setError('Enter the agent’s share as a dollar amount, or a % between 0 and 100.');
      nextShare = share.mode === 'percent' ? { mode: 'percent', value: n / 100 } : { mode: 'amount', value: Math.round(n * 100) };
    }
    setBusy(action);
    const r = await resolveOtherReferral(item.id, action, action === 'change' || action === 'add' ? feeCents : null);
    if (r.ok && nextShare && agentId) await setAgentBrokerFeeShare(agentId, nextShare);
    setBusy(null);
    if (!r.ok) return setError(r.message);
    await Promise.all([reloadOtherReferrals(), reloadReferralSources()]);
    void reloadBrokerFeeShares();
    if (action === 'add' || action === 'reject') void hydrate();
    onDone();
  }

  return (
    <Card>
      <CardBody className={cn('flex flex-col gap-3 pt-4', focused && 'rounded-xl ring-2 ring-[var(--color-brand-500)]/40')} id={`review-${item.id}`} data-testid="review-other">
        <p className="text-sm text-[var(--color-ink-700)]">
          <button type="button" onClick={() => navigate(`/accounts/${item.account.id}`)} className="cursor-pointer font-semibold text-[var(--color-brand-700)] hover:underline">
            {item.account.name}
          </button>
          <span className="text-[var(--color-ink-500)]"> · {item.createdByName ?? 'An agent'} · {day(item.createdAt)}</span>
        </p>
        <p className="text-sm text-[var(--color-ink-700)]">
          Other partner: <span className="font-semibold text-[var(--color-ink-900)]">{now.name}</span> · <span className="font-semibold tabular-nums text-[var(--color-ink-900)]">{formatCents(now.partnerFeeCents)}</span>
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-ink-600)]" htmlFor={`fee-${item.id}`}>
            Amount ($)
            <input id={`fee-${item.id}`} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={cn(field, 'w-36 tabular-nums')} />
          </label>
          {needsShare && (
            <div className="flex flex-col gap-1 text-xs font-medium text-[var(--color-ink-600)]">
              {item.account.agent || 'Agent'}’s broker fee share
              <span className="flex gap-1">
                <select value={share.mode} onChange={(e) => setShare({ mode: e.target.value as 'amount' | 'percent', value: '' })} className={cn(field, 'w-16 px-2')} aria-label="Share type">
                  <option value="amount">$</option>
                  <option value="percent">%</option>
                </select>
                <input inputMode="decimal" value={share.value} onChange={(e) => setShare({ ...share, value: e.target.value })} placeholder="Not set" className={cn(field, 'w-24')} aria-label="Agent’s share" />
              </span>
            </div>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {changed ? (
              <Button onClick={() => void decide('change')} disabled={!!busy}>{busy === 'change' ? 'Saving…' : 'Change amount'}</Button>
            ) : (
              <Button onClick={() => void decide('ok')} disabled={!!busy}>{busy === 'ok' ? 'Saving…' : 'Confirm'}</Button>
            )}
            <Button variant="secondary" onClick={() => void decide('add')} disabled={!!busy}>{busy === 'add' ? 'Adding…' : 'Add to partner list'}</Button>
            <Button variant="secondary" onClick={() => void decide('reject')} disabled={!!busy}>{busy === 'reject' ? 'Rejecting…' : 'Reject'}</Button>
          </div>
        </div>
        {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
      </CardBody>
    </Card>
  );
}

const DECIDED_WORDS: Record<string, string> = { archived_new: 'archived', kept_both: 'kept both', ok: 'confirmed', changed: 'amount changed', added: 'added to partners', rejected: 'rejected' };

function UndoItem({ c, onDone }: { c: PolicyCancellation; onDone: () => void }) {
  const accounts = useAccountsStore((s) => s.accounts);
  const quotes = useAccountsStore((s) => s.quotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const account = accounts.find((a) => a.id === c.accountId);
  const policy = useMemo(() => (quotes[c.accountId] ?? []).flatMap((q) => q.policies ?? []).find((p) => p.id === c.policyId), [quotes, c]);
  async function act(fn: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setBusy(true);
    setError('');
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onDone();
  }
  return (
    <Card>
      <CardBody className="flex flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-between" data-testid="review-undo">
        <div className="min-w-0 text-sm text-[var(--color-ink-700)]">
          <p className="font-medium text-[var(--color-ink-900)]">
            {account?.namedInsured ?? 'Account'} · {policy?.policyNumber ?? 'Policy'} {policy ? `(${policy.carrier})` : ''}
          </p>
          <p className="text-xs text-[var(--color-ink-500)]">
            {c.type === 'full' ? 'Fully' : 'Partly'} cancelled {formatShortDate(c.effectiveDate)}
            {c.refundNetCents !== null ? ` · refund ${formatCents(c.refundNetCents)}` : ''} · by {c.cancelledByName} · undo asked {day(c.undoRequestedAt)}
          </p>
          {c.undoReason && <p className="mt-0.5 text-xs text-[var(--color-ink-600)]">“{c.undoReason}”</p>}
          {error && <p className="text-xs text-[var(--color-danger-600)]">{error}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => declineCancellationUndo(c.id))}>Keep cancelled</Button>
          <Button size="sm" disabled={busy} onClick={() => void act(() => undoCancellation(c.id))}>Undo it</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function DecidedList({ items }: { items: AdminReviewItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="pb-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="cursor-pointer text-left text-sm font-semibold text-[var(--color-ink-900)]">
          Decided ({items.length}) <span className="font-normal text-[var(--color-brand-700)]">{open ? 'Hide' : 'Show'}</span>
        </button>
      </CardHeader>
      {open && (
        <CardBody className="flex flex-col gap-1.5 pt-0 text-sm text-[var(--color-ink-700)]">
          {items.map((i) => (
            <p key={i.id} className="flex flex-wrap items-center gap-1.5">
              <CheckCircle2 size={13} className="text-[var(--color-success-600)]" />
              {i.kind === 'other_referral'
                ? `${i.account.name}: Other partner ${i.other?.name ?? ''} — ${DECIDED_WORDS[i.resolution ?? ''] ?? 'decided'}${i.resolution !== 'rejected' && i.other?.finalFeeCents !== null && i.other?.finalFeeCents !== undefined ? ` (${formatCents(i.other.finalFeeCents)})` : ''}`
                : `${i.account.name} — ${DECIDED_WORDS[i.resolution ?? ''] ?? 'decided'}`}{' '}
              by {i.resolvedByName ?? 'an admin'} {day(i.resolvedAt)}
            </p>
          ))}
        </CardBody>
      )}
    </Card>
  );
}
