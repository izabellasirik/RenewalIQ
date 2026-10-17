import { useMemo, useRef } from 'react';
import { CheckCircle2, Download, Printer, XCircle } from 'lucide-react';
import { Badge, Button, Card } from '../ui';
import { cn } from '../../utils/cn';
import { TRANSACTION_TYPES, fmtMoney, fmtPct, moneyInput, monthLabel, nextMonth, statement, ties, type ProducerStatement } from '../../services/commissions/calc';
import { toCsv, type SampleLedger } from '../../services/commissions/sampleLedger';
import { AssumptionFlag, Money, ProducerSelect, TypeBadge } from './shared';
import { downloadText, tdClass, thClass } from './commissionsUi';

/** A producer's (or everyone's) monthly statement — marked SAMPLE and DRAFT; printable and downloadable. */
export function StatementsTab({ ledger, month, producerId, onProducer, agencyName }: { ledger: SampleLedger; month: string; producerId: string; onProducer: (id: string) => void; agencyName: string }) {
  const st = useMemo(() => statement(ledger, month, producerId || undefined), [ledger, month, producerId]);
  const docRef = useRef<HTMLDivElement>(null);
  const t = st.totals;
  const balanced = ties(st);
  const shown = st.rows.filter((r) => r.lines.length || r.adjustments.length || r.broughtForward);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <label className="sr-only" htmlFor="statement-producer">Producer</label>
        <ProducerSelect id="statement-producer" producers={ledger.producers} value={producerId} onChange={onProducer} allLabel="All producers" />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Printer size={15} />} onClick={() => docRef.current && printStatement(docRef.current)}>Print / PDF</Button>
          <Button variant="secondary" icon={<Download size={15} />} onClick={() => downloadText(`SAMPLE-commission-statement-${month}${producerId ? `-${producerId}` : ''}.csv`, statementCsv(st.rows, st.label, agencyName))}>CSV</Button>
        </div>
      </div>

      <Card className="overflow-hidden" data-testid="statement">
        <div ref={docRef} className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[var(--color-brand-800)] pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">{agencyName} · <span className="text-[var(--color-warning-600)]">Sample</span></p>
              <h2 className="text-lg font-semibold text-[var(--color-brand-800)]">Producer commission statement (sample)</h2>
              <p className="text-sm text-[var(--color-ink-600)]">
                {st.label} · {producerId ? st.rows[0]?.producer.name : 'all producers'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Badge tone="warning" data-testid="statement-sample">SAMPLE — fictional figures</Badge>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-warning-600)]">DRAFT · not approved <AssumptionFlag id="A11" /></span>
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-500)]">Manager view <AssumptionFlag id="A10" /></span>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="statement-totals">
            <Total label="Gross commission" cents={t.gross} id="gross" />
            <Total label="Producer payouts" cents={t.agent + t.adjTotal} id="payouts" note={<>incl. adjustments {fmtMoney(t.adjTotal)}</>} />
            <Total label="Agency retained" cents={t.retained} id="retained" />
            <Total label="Net payable" cents={t.payable} id="payable" note={t.carriedForward ? <span className="text-[var(--color-danger-600)]">{fmtMoney(t.carriedForward)} carried to {monthLabel(nextMonth(month))}</span> : undefined} />
          </dl>

          {shown.length === 0 && <p className="rounded-lg bg-[var(--color-ink-50)] px-4 py-6 text-center text-sm text-[var(--color-ink-500)]">No activity for this producer in {st.label}.</p>}
          {shown.map((r) => <ProducerSection key={r.producer.id} r={r} month={month} />)}

          <p className={cn('flex items-center gap-1.5 text-xs font-medium', balanced ? 'text-[var(--color-success-600)]' : 'text-[var(--color-danger-600)]')} data-testid="statement-ties">
            {balanced ? <CheckCircle2 size={14} aria-hidden /> : <XCircle size={14} aria-hidden />}
            Check: gross {fmtMoney(t.gross)} = payouts {fmtMoney(t.agent)} + adjustments {fmtMoney(t.adjTotal)} + Agency retained {fmtMoney(t.retained)}
          </p>
        </div>
      </Card>
    </div>
  );
}

function Total({ label, cents, id, note }: { label: string; cents: number; id: string; note?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[var(--color-ink-50)] px-3 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold" data-total={id}><Money cents={cents} /></dd>
      {note && <dd className="text-xs text-[var(--color-ink-500)]">{note}</dd>}
    </div>
  );
}

function ProducerSection({ r, month }: { r: ProducerStatement; month: string }) {
  return (
    <section data-statement-producer={r.producer.id} className="break-inside-avoid">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--color-ink-900)]">
          {r.producer.name}
        </h3>
        <span className="text-xs text-[var(--color-ink-500)]">default split {fmtPct(r.producer.splitMilli)}</span>
      </div>

      {/* Desktop / print table */}
      <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-ink-100)] md:block print:block">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-ink-50)]">
            <tr>
              <th className={thClass}>Date</th>
              <th className={thClass}>Account / policy</th>
              <th className={thClass}>Type</th>
              <th className={cn(thClass, 'text-right')}>Premium</th>
              <th className={cn(thClass, 'text-right')}>Carrier %</th>
              <th className={cn(thClass, 'text-right')}>Gross</th>
              <th className={cn(thClass, 'text-right')}>Split</th>
              <th className={cn(thClass, 'text-right')}>Payout</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-ink-100)]">
            {r.lines.map((l) => (
              <tr key={l.id} className={cn(l.gross < 0 && 'bg-[var(--color-danger-100)]/35')}>
                <td className={cn(tdClass, 'whitespace-nowrap text-[var(--color-ink-500)]')}>{l.date}</td>
                <td className={tdClass}><p className="font-medium">{l.account}</p><p className="text-xs text-[var(--color-ink-400)]">{l.policy}</p></td>
                <td className={tdClass}><TypeBadge type={l.type} /></td>
                <td className={cn(tdClass, 'text-right')}><Money cents={l.signedPremiumCents} /></td>
                <td className={cn(tdClass, 'text-right')}>{fmtPct(l.rateMilli)}</td>
                <td className={cn(tdClass, 'text-right')}><Money cents={l.gross} /></td>
                <td className={cn(tdClass, 'text-right')}>{fmtPct(l.splitMilli)}</td>
                <td className={cn(tdClass, 'text-right')}><Money cents={l.agent} /></td>
              </tr>
            ))}
            {r.adjustments.map((a) => (
              <tr key={a.id} className="bg-[var(--color-warning-100)]/45">
                <td className={cn(tdClass, 'whitespace-nowrap text-[var(--color-ink-500)]')}>{a.at.slice(0, 10)}</td>
                <td className={tdClass} colSpan={6}><span className="font-medium">Manual adjustment {a.id.toUpperCase()}</span> <AssumptionFlag id="A8" /> <span className="text-[var(--color-ink-600)]">— {a.reason}</span></td>
                <td className={cn(tdClass, 'text-right')}><Money cents={a.amountCents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone list */}
      <ul className="divide-y divide-[var(--color-ink-100)] rounded-lg border border-[var(--color-ink-100)] md:hidden print:hidden">
        {r.lines.map((l) => (
          <li key={l.id} className={cn('flex items-start justify-between gap-3 px-3 py-2.5 text-sm', l.gross < 0 && 'bg-[var(--color-danger-100)]/35')}>
            <span className="min-w-0">
              <span className="block font-medium">{l.account}</span>
              <span className="block text-xs text-[var(--color-ink-500)]">{l.date} · {TRANSACTION_TYPES[l.type].label}</span>
              <span className="block text-xs text-[var(--color-ink-400)]"><Money cents={l.signedPremiumCents} /> × {fmtPct(l.rateMilli)} × {fmtPct(l.splitMilli)}</span>
            </span>
            <Money cents={l.agent} strong className="shrink-0" />
          </li>
        ))}
        {r.adjustments.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-3 bg-[var(--color-warning-100)]/45 px-3 py-2.5 text-sm">
            <span className="min-w-0"><span className="block font-medium">Adjustment {a.id.toUpperCase()} <AssumptionFlag id="A8" /></span><span className="block text-xs text-[var(--color-ink-500)]">{a.reason}</span></span>
            <Money cents={a.amountCents} strong className="shrink-0" />
          </li>
        ))}
      </ul>

      <dl className="ml-auto mt-3 max-w-sm space-y-1 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-[var(--color-ink-600)]">Commission this month</dt><dd><Money cents={r.agent} /></dd></div>
        {r.adjustments.length > 0 && <div className="flex justify-between gap-4"><dt className="text-[var(--color-ink-600)]">Manual adjustments</dt><dd><Money cents={r.adjTotal} /></dd></div>}
        {r.broughtForward !== 0 && <div className="flex justify-between gap-4"><dt className="text-[var(--color-ink-600)]">Brought forward <AssumptionFlag id="A4" /></dt><dd><Money cents={r.broughtForward} /></dd></div>}
        <div className="flex justify-between gap-4 border-t-2 border-[var(--color-ink-800)] pt-1.5 font-semibold"><dt>Net payable</dt><dd data-payable={r.producer.id}><Money cents={r.payable} /></dd></div>
        {r.carriedForward < 0 && <div className="flex justify-between gap-4 text-[var(--color-danger-600)]"><dt>Carried to {monthLabel(nextMonth(month))} <AssumptionFlag id="A4" /></dt><dd data-carried={r.producer.id}><Money cents={r.carriedForward} /></dd></div>}
        <div className="flex justify-between gap-4 text-xs text-[var(--color-ink-400)]"><dt>Agency retained on these lines</dt><dd><Money cents={r.retained} /></dd></div>
      </dl>
    </section>
  );
}

function statementCsv(rows: ProducerStatement[], label: string, agencyName: string): string {
  const out: unknown[][] = [[`${agencyName} producer commission statement — SAMPLE (fictional data), DRAFT`, label], [], ['Producer', 'Date', 'Account', 'Policy', 'Type', 'Premium', 'Carrier %', 'Gross commission', 'Split %', 'Agent payout', 'Agency retained']];
  for (const r of rows) {
    for (const l of r.lines) out.push([r.producer.name, l.date, l.account, l.policy, TRANSACTION_TYPES[l.type].label, moneyInput(l.signedPremiumCents), l.rateMilli / 1000, moneyInput(l.gross), l.splitMilli / 1000, moneyInput(l.agent), moneyInput(l.retained)]);
    for (const a of r.adjustments) out.push([r.producer.name, a.at.slice(0, 10), `Manual adjustment ${a.id.toUpperCase()}`, '', a.reason, '', '', '', '', moneyInput(a.amountCents), moneyInput(-a.amountCents)]);
    if (r.broughtForward) out.push([r.producer.name, '', 'Brought forward', '', '', '', '', '', '', moneyInput(r.broughtForward), '']);
    out.push([r.producer.name, '', 'Net payable', '', '', '', '', '', '', moneyInput(r.payable), '']);
    if (r.carriedForward) out.push([r.producer.name, '', 'Carried forward', '', '', '', '', '', '', moneyInput(r.carriedForward), '']);
  }
  return toCsv(out);
}

/**
 * Prints just the statement: copies it, with the app's stylesheets, into a hidden frame and prints
 * that — the rest of RenewalIQ (sidebar, top bar) never appears on the page.
 */
function printStatement(node: HTMLElement) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map((n) => n.outerHTML).join('');
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Sample commission statement</title>${styles}<style>@page{margin:14mm}body{background:#fff}</style></head><body><div data-print-root>${node.outerHTML}</div></body></html>`);
  doc.close();
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  if (doc.readyState === 'complete') setTimeout(go, 150);
  else frame.onload = go;
}
