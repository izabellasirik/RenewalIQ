import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardBody } from '../ui';
import { formatRate } from '../workspace/PoliciesSection';
import { fetchMyBalance, fetchMyPayoutLines, fetchMyPayouts, type MyBalanceEntry, type MyPayout, type MyPayoutLine } from '../../services/supabase/payoutRepo';
import { KIND_LABELS } from '../../services/finance/ledger';
import { runPeriodLabel } from '../../services/finance/payouts';
import { formatCents } from '../../services/workflow/policies';
import { formatShortDate } from '../../services/workflow/dates';

/**
 * The signed-in agent's own payouts (approved or paid by an admin), what's in each — their agent
 * commission only, never carrier figures — and their commission balance: any negative amount carried
 * from a payout, and what later payouts recovered of it. Nothing shows until there's a payout (or 0065).
 */
export function MyPayoutsCard() {
  const [payouts, setPayouts] = useState<MyPayout[] | null>(null);
  const [balance, setBalance] = useState<MyBalanceEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, MyPayoutLine[]>>({});

  useEffect(() => {
    void Promise.all([fetchMyPayouts(), fetchMyBalance()]).then(([p, b]) => {
      setPayouts(p.ok ? p.data : null);
      if (b.ok) setBalance(b.data);
    });
  }, []);
  useEffect(() => {
    if (open && !lines[open]) void fetchMyPayoutLines(open).then((res) => res.ok && setLines((l) => ({ ...l, [open]: res.data })));
  }, [open, lines]);

  if (!payouts || (payouts.length === 0 && balance.length === 0)) return null;
  const owed = -balance.reduce((s, e) => s + e.amountCents, 0);
  const carried = balance.filter((e) => e.kind === 'carried');
  const period = (e: Pick<MyBalanceEntry, 'stream' | 'periodStart' | 'periodEnd'>) =>
    e.stream && e.periodStart && e.periodEnd ? runPeriodLabel({ stream: e.stream, periodStart: e.periodStart, periodEnd: e.periodEnd }) : 'a payout';

  return (
    <Card>
      <CardBody className="pt-4" data-testid="my-payouts">
        <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Your payouts</h3>
        <p className="text-xs text-[var(--color-ink-500)]">Policies are paid weekly, endorsements monthly, once verified and approved by your agency admin.</p>
        {carried.length > 0 && (
          <div className="mt-3 rounded-lg border border-[var(--color-ink-100)] px-3 py-2 text-sm" data-testid="my-balance">
            {owed > 0 ? (
              <p>You owe <strong className="tabular-nums">{formatCents(owed)}</strong> from earlier payouts. It’s taken from your next payouts, never withdrawn.</p>
            ) : (
              <p>Nothing owed from earlier payouts.</p>
            )}
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-[var(--color-ink-600)]">
              {carried.map((c) => (
                <li key={c.id}>
                  {formatCents(c.amountCents)} carried from {period(c)}
                  {balance
                    .filter((x) => x.appliesTo === c.id)
                    .map((x) => (
                      <span key={x.id}> · {formatCents(x.amountCents)} {x.kind === 'recovered' ? `recovered in ${period(x)}` : 'written off by your agency'}</span>
                    ))}
                  {c.leftCents ? ` · ${formatCents(c.leftCents)} left` : ' · fully recovered'}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="mt-3 flex flex-col">
          {payouts.map((p) => (
            <li key={p.id} className="border-b border-[var(--color-ink-50)] py-2 last:border-b-0" data-payout={p.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <strong>{formatShortDate(p.payDate)}</strong> · {runPeriodLabel(p)}
                  <Badge tone={p.status === 'paid' ? 'success' : p.payCents === 0 ? 'neutral' : 'info'} className="ml-2">
                    {p.status === 'paid' ? `Paid ${p.paidOn ? formatShortDate(p.paidOn) : ''}` : p.payCents === 0 ? (p.carriedCents < 0 ? 'Nothing to pay · carried to your balance' : 'Nothing to pay · went to what you owed') : `Approved for ${formatShortDate(p.payDate)}`}
                  </Badge>
                </span>
                <span className="flex items-center gap-2">
                  <strong className="tabular-nums" data-field="pay">{formatCents(p.payCents)}</strong>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>{open === p.id ? 'Hide' : 'Details'}</Button>
                </span>
              </div>
              {open === p.id && (
                <div className="mt-2 text-xs text-[var(--color-ink-700)]" data-testid="my-payout-lines">
                  {(lines[p.id] ?? []).map((l, i) => (
                    <p key={i} className="flex justify-between gap-2 py-0.5">
                      <span>
                        {l.lineType === 'adjustment' ? `Adjustment — ${l.reason ?? ''}` : `${l.kind ? KIND_LABELS[l.kind] : ''} ${l.policyNumber ?? ''} · ${l.clientName ?? ''} · ${l.eventDate ? formatShortDate(l.eventDate) : ''} · net ${l.netCents === null ? '—' : formatCents(l.netCents)}${l.agentRate === null ? '' : ` × 10% × ${formatRate(l.agentRate)}`}${l.late ? ' (from an earlier period)' : ''}`}
                      </span>
                      <span className="tabular-nums">{formatCents(l.agentCents)}</span>
                    </p>
                  ))}
                  {p.recoveredCents > 0 && <p className="flex justify-between gap-2 py-0.5"><span>Recovered from what you owed</span><span className="tabular-nums">{formatCents(-p.recoveredCents)}</span></p>}
                  {p.carriedCents < 0 && <p className="flex justify-between gap-2 py-0.5"><span>Carried to your balance</span><span className="tabular-nums">{formatCents(p.carriedCents)}</span></p>}
                  <p className="flex justify-between gap-2 border-t border-[var(--color-ink-50)] pt-1 font-semibold"><span>Paid to you</span><span className="tabular-nums">{formatCents(p.payCents)}</span></p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
