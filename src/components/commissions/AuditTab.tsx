import { useState } from 'react';
import { Download, Lock } from 'lucide-react';
import { Button, Card, CardBody, CardHeader } from '../ui';
import { cn } from '../../utils/cn';
import { toCsv, type SampleLedger } from '../../services/commissions/sampleLedger';
import {  } from './shared';
import { downloadText, tdClass, thClass } from './commissionsUi';

type Filter = 'all' | 'adjustments' | 'edits';
const matches = (action: string, f: Filter) => f === 'all' || (f === 'adjustments' ? /adjustment/i.test(action) : /changed|added transaction/i.test(action));

/** Every change to the sample ledger, newest first. Read-only: there is nothing here to edit or delete. */
export function AuditTab({ ledger }: { ledger: SampleLedger }) {
  const [filter, setFilter] = useState<Filter>('all');
  const entries = [...ledger.audit].reverse().filter((e) => matches(e.action, filter));
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-ink-900)]">Audit history</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[var(--color-ink-500)]">
            <Lock size={13} aria-hidden /> Append-only: entries can’t be changed or deleted. Every edit, adjustment and reversal adds one.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="audit-filter">Show</label>
          <select id="audit-filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-sm">
            <option value="all">Everything</option>
            <option value="adjustments">Adjustments only</option>
            <option value="edits">Edits only</option>
          </select>
          <Button variant="secondary" icon={<Download size={15} />} onClick={() => downloadText('SAMPLE-commission-audit-history.csv', toCsv([['#', 'When (UTC)', 'Who', 'Action', 'Detail', 'Reason'], ...ledger.audit.map((e) => [e.seq, e.at, e.by, e.action, e.detail, e.reason])]))}>
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardBody className="px-0 pb-2 pt-4">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm" data-testid="audit">
            <thead className="border-y border-[var(--color-ink-100)] bg-[var(--color-ink-50)]">
              <tr>
                <th className={cn(thClass, 'pl-5')}>#</th>
                <th className={thClass}>When (UTC)</th>
                <th className={thClass}>Who</th>
                <th className={thClass}>Action</th>
                <th className={thClass}>Detail</th>
                <th className={cn(thClass, 'pr-5')}>Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-ink-100)]">
              {entries.map((e) => (
                <tr key={e.seq}>
                  <td className={cn(tdClass, 'pl-5 text-[var(--color-ink-400)]')}>{e.seq}</td>
                  <td className={cn(tdClass, 'whitespace-nowrap text-[var(--color-ink-500)]')}>{e.at.slice(0, 16).replace('T', ' ')}</td>
                  <td className={cn(tdClass, 'whitespace-nowrap')}>{e.by}</td>
                  <td className={cn(tdClass, 'whitespace-nowrap font-medium')}>{e.action}</td>
                  <td className={cn(tdClass, 'text-[var(--color-ink-700)]')}>{e.detail}</td>
                  <td className={cn(tdClass, 'pr-5 text-[var(--color-ink-600)]')}>{e.reason || <span className="text-[var(--color-ink-300)]">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ol className="divide-y divide-[var(--color-ink-100)] md:hidden" data-testid="audit-mobile">
          {entries.map((e) => (
            <li key={e.seq} className="px-5 py-3 text-sm">
              <p className="flex justify-between gap-2"><span className="font-medium">{e.action}</span><span className="text-xs text-[var(--color-ink-400)]">#{e.seq}</span></p>
              <p className="text-[var(--color-ink-700)]">{e.detail}</p>
              {e.reason && <p className="text-[var(--color-ink-500)]">Reason: {e.reason}</p>}
              <p className="mt-0.5 text-xs text-[var(--color-ink-400)]">{e.by} · {e.at.slice(0, 16).replace('T', ' ')} UTC</p>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
