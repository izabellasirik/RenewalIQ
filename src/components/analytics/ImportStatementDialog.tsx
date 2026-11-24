import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Button, Modal } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { alreadyAdded, parseStatement, type ParsedStatement } from '../../services/finance/statementImport';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type MoneyEntry, type MoneyFields } from '../../services/finance/money';
import { formatCents } from '../../services/workflow/policies';
import { formatShortDate } from '../../services/workflow/dates';
import { cn } from '../../utils/cn';

/** The lines of a file as cells: a PDF's lines of text, a spreadsheet's rows (header row included). */
async function fileLines(file: File): Promise<string[][]> {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const { parsePdf } = await import('../../services/ingestion/parsePdf');
    const raw = await parsePdf(file);
    return (raw.layout ?? []).map((l) => l.cells.map((c) => c.text));
  }
  const { parseFile } = await import('../../services/ingestion/parseFile');
  const raw = await parseFile(file);
  if (raw.tables?.length) return raw.tables.flatMap((t) => [[t.sheetName ?? ''], t.headers, ...t.rows]).map((r) => r.map((c) => c ?? ''));
  return raw.text.split('\n').map((l) => l.split(/\t|\s{2,}/));
}

type Row = ParsedStatement['lines'][number] & { picked: boolean; duplicate: boolean };

/**
 * Income & expenses → Import statement: an income & expense statement (PDF, Excel, CSV) read into
 * entries, shown first — the admin ticks what to add and can change the date and categories.
 */
export function ImportStatementDialog({ entries, onClose, onSave }: { entries: MoneyEntry[]; onClose: () => void; onSave: (fields: MoneyFields) => Promise<string | null> }) {
  const [fileName, setFileName] = useState('');
  const [period, setPeriod] = useState('');
  const [date, setDate] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function read(file: File) {
    setBusy(true);
    setMessage('');
    try {
      const parsed = parseStatement(await fileLines(file));
      if (!parsed) {
        setRows(null);
        setMessage('No income or expense lines were found in this file. It needs headings like “INCOME” / “EXPENSES” with a description and an amount on each line.');
        return;
      }
      const d = parsed.date ?? '';
      setFileName(file.name);
      setPeriod(parsed.period);
      setDate(d);
      setSkipped(parsed.skipped);
      setRows(parsed.lines.map((l) => {
        const duplicate = !!d && alreadyAdded(l, d, entries);
        return { ...l, duplicate, picked: !l.hold && !duplicate };
      }));
    } catch {
      setMessage('This file couldn’t be read. Try the PDF, or an Excel / CSV export.');
    } finally {
      setBusy(false);
    }
  }

  const picked = (rows ?? []).filter((r) => r.picked);
  const income = picked.filter((r) => r.kind === 'income').reduce((n, r) => n + r.amountCents, 0);
  const expense = picked.filter((r) => r.kind === 'expense').reduce((n, r) => n + r.amountCents, 0);
  const set = (key: string, patch: Partial<Row>) => setRows((cur) => (cur ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function add() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setMessage('Choose the date for these entries.');
    if (date < '2000-01-01' || date > `${new Date().getFullYear() + 2}-12-31`) return setMessage(`Check the year — ${date.slice(0, 4)} looks like a typo.`);
    setSaving({ done: 0, total: picked.length });
    const failed: string[] = [];
    for (const [i, r] of picked.entries()) {
      const err = await onSave({ kind: r.kind, date, category: r.category.trim().slice(0, 80) || (r.kind === 'income' ? 'Other income' : 'Other expense'), description: r.description, amountCents: r.amountCents, notes: `Imported from ${fileName}${period ? ` (${period})` : ''}` });
      if (err) failed.push(`${r.description}: ${err}`);
      setSaving({ done: i + 1, total: picked.length });
    }
    setSaving(null);
    if (failed.length) return setMessage(`${picked.length - failed.length} added. Not added — ${failed.join(' · ')}`);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Import statement"
      size="lg"
      footer={
        rows ? (
          <>
            <span className="mr-auto text-sm text-[var(--color-ink-600)]">
              {picked.length} ticked · income {formatCents(income)} · expenses {formatCents(expense)}
            </span>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void add()} disabled={!picked.length || !!saving} data-testid="statement-add">
              {saving ? `Adding ${saving.done}/${saving.total}…` : `Add ${picked.length} ${picked.length === 1 ? 'entry' : 'entries'}`}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        )
      }
    >
      <input ref={input} type="file" accept=".pdf,application/pdf,.xlsx,.xls,.csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
      {!rows && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void read(f); }}
          className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-ink-200)] px-4 py-8 text-center text-sm"
          data-testid="statement-drop"
        >
          <FileUp size={22} className="text-[var(--color-ink-400)]" />
          <span className="text-[var(--color-ink-700)]">
            Drop the income & expense statement here or{' '}
            <button type="button" className="cursor-pointer font-medium text-[var(--color-brand-700)] underline" onClick={() => input.current?.click()} disabled={busy}>browse</button>
          </span>
          <span className="text-xs text-[var(--color-ink-500)]">PDF, Excel or CSV. Nothing is added until you check it.</span>
          {busy && <span className="text-xs text-[var(--color-ink-500)]">Reading…</span>}
        </div>
      )}
      {message && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">{message}</p>}
      {rows && (
        <div className="flex flex-col gap-3" data-testid="statement-preview">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelClass} htmlFor="statement-date">Date for these entries</label>
              <input id="statement-date" type="date" className={inputClass} value={date} onChange={(e) => {
                const d = e.target.value;
                setDate(d);
                setRows((cur) => (cur ?? []).map((r) => {
                  const duplicate = !!d && alreadyAdded(r, d, entries);
                  return { ...r, duplicate, picked: duplicate ? false : r.picked };
                }));
              }} />
            </div>
            <p className="pb-2 text-sm text-[var(--color-ink-600)]">
              {fileName}{period ? ` · ${period}` : ''}
              <button type="button" className="ml-3 cursor-pointer text-xs font-medium text-[var(--color-brand-700)] hover:underline" onClick={() => input.current?.click()}>Choose another file</button>
            </p>
          </div>
          <div className="max-h-[52vh] overflow-auto rounded-lg border border-[var(--color-ink-100)]">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs text-[var(--color-ink-500)]">
                <tr>
                  <th className="border-b border-[var(--color-ink-100)] px-3 py-2">
                    <input type="checkbox" aria-label="Tick all" checked={rows.every((r) => r.picked || r.duplicate)} onChange={(e) => setRows((cur) => (cur ?? []).map((r) => ({ ...r, picked: e.target.checked && !r.duplicate })))} />
                  </th>
                  <th className="border-b border-[var(--color-ink-100)] px-3 py-2 font-medium">Type</th>
                  <th className="border-b border-[var(--color-ink-100)] px-3 py-2 font-medium">Category</th>
                  <th className="border-b border-[var(--color-ink-100)] px-3 py-2 font-medium">Description</th>
                  <th className="border-b border-[var(--color-ink-100)] px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={cn('align-top', !r.picked && 'bg-[var(--color-ink-50)]/60')} data-statement-row>
                    <td className="border-b border-[var(--color-ink-50)] px-3 py-2">
                      <input type="checkbox" aria-label={`Add ${r.description}`} checked={r.picked} onChange={(e) => set(r.key, { picked: e.target.checked })} />
                    </td>
                    <td className="border-b border-[var(--color-ink-50)] px-3 py-2">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', r.kind === 'income' ? 'bg-[var(--color-success-100)] text-[var(--color-success-600)]' : 'bg-[var(--color-ink-100)] text-[var(--color-ink-600)]')}>
                        {r.kind === 'income' ? 'Income' : 'Expense'}
                      </span>
                    </td>
                    <td className="border-b border-[var(--color-ink-50)] px-3 py-2">
                      <input className="w-44 rounded border border-[var(--color-ink-200)] px-2 py-1 text-sm" value={r.category} list={`statement-cat-${r.kind}`} onChange={(e) => set(r.key, { category: e.target.value })} aria-label={`Category for ${r.description}`} />
                    </td>
                    <td className="border-b border-[var(--color-ink-50)] px-3 py-2 text-[var(--color-ink-800)]">
                      {r.description}
                      {r.duplicate && <span className="mt-1 inline-block rounded-full bg-[var(--color-ink-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-600)]">Already added · {formatShortDate(date)}</span>}
                      {r.hold && !r.duplicate && <span className="mt-1 inline-block rounded-full bg-[var(--color-ink-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-600)]">{r.hold}</span>}
                    </td>
                    <td className="whitespace-nowrap border-b border-[var(--color-ink-50)] px-3 py-2 text-right font-semibold tabular-nums">{formatCents(r.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {skipped.length > 0 && <p className="text-xs text-[var(--color-ink-500)]">Left out: {skipped.join(', ')}.</p>}
          <datalist id="statement-cat-income">{[...INCOME_CATEGORIES, 'Broker fees', 'Carrier commission'].map((c) => <option key={c} value={c} />)}</datalist>
          <datalist id="statement-cat-expense">{[...EXPENSE_CATEGORIES, 'Agent commission', 'Referral partners'].map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      )}
    </Modal>
  );
}
