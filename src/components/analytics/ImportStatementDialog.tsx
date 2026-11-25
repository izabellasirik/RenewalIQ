import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Button, Modal } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { alreadyAdded, parseStatement, type ParsedStatement } from '../../services/finance/statementImport';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type MoneyEntry, type MoneyFields } from '../../services/finance/money';
import { formatCents } from '../../services/workflow/policies';
import { cn } from '../../utils/cn';

/** The lines of a file as cells: a PDF's lines of text, a spreadsheet's rows (header row included) — or why it can't be read. */
async function fileLines(file: File): Promise<{ lines: string[][]; problem?: string }> {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  if (!isPdf && (/^image\//.test(file.type) || /\.(jpe?g|png|heic|heif|gif|webp)$/i.test(file.name))) {
    return { lines: [], problem: `“${file.name}” is a photo or screenshot — it can’t be read yet. Use the statement’s PDF, Excel or CSV file.` };
  }
  if (!/\.(pdf|xlsx|xls|csv)$/i.test(file.name) && !isPdf && !/sheet|excel|csv/i.test(file.type)) {
    return { lines: [], problem: `“${file.name}” isn’t a PDF, Excel or CSV file.` };
  }
  if (isPdf) {
    const { parsePdf } = await import('../../services/ingestion/parsePdf');
    const raw = await parsePdf(file, { ocrScannedPages: false });
    const lines = (raw.layout ?? []).map((l) => l.cells.map((c) => c.text));
    if (lines.length) return { lines };
    if (raw.scannedPages?.length) return { lines, problem: `“${file.name}” is a scan (a picture of the page, no text in it), so it can’t be read. Use the PDF the statement was saved as.` };
    return { lines, problem: `“${file.name}” couldn’t be opened on this device${raw.warnings[0] ? ` (${raw.warnings[0].replace(/^Could not read this PDF: /, '').replace(/\.+$/, '')})` : ''}. Try it on a computer, or use the Excel / CSV file.` };
  }
  const { parseFile } = await import('../../services/ingestion/parseFile');
  const raw = await parseFile(file);
  if (raw.tables?.length) return { lines: raw.tables.flatMap((t) => [[t.sheetName ?? ''], t.headers, ...t.rows]).map((r) => r.map((c) => c ?? '')) };
  return { lines: raw.text.split('\n').map((l) => l.split(/\t|\s{2,}/)) };
}

type Row = ParsedStatement['lines'][number] & { picked: boolean; /** The amount as typed ("1,880.00"). */ amountText: string };

/** "1,880.00", "$1880", "1880.5" → cents; null when it isn't an amount. */
function amountCents(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Math.round(Number(t) * 100);
  return n > 0 ? n : null;
}
const dollars = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Income & expenses → Import statement: an income & expense statement (PDF, Excel, CSV) read into
 * entries, shown first — the admin ticks what to add and can change any line (type, category, description,
 * amount) and the date before adding. A line that looks already added is flagged and starts unticked.
 */
export function ImportStatementDialog({ entries, onClose, onSave }: { entries: MoneyEntry[]; onClose: () => void; onSave: (fields: MoneyFields) => Promise<string | null> }) {
  const [fileName, setFileName] = useState('');
  const [period, setPeriod] = useState('');
  const [date, setDate] = useState('');
  /** The period's first day: carrier / agent commission saved for it replaces the policies' amounts on those dates. */
  const [from, setFrom] = useState('');
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
      const { lines, problem } = await fileLines(file);
      const parsed = problem ? null : parseStatement(lines);
      if (!parsed) {
        setRows(null);
        setMessage(problem ?? `No income or expense lines were found in “${file.name}”. It needs headings like “INCOME” / “EXPENSES” with a description and an amount on each line.`);
        return;
      }
      const d = parsed.date ?? '';
      setFileName(file.name);
      setPeriod(parsed.period);
      setDate(d);
      setFrom(parsed.from ?? d);
      setSkipped(parsed.skipped);
      setRows(parsed.lines.map((l) => ({ ...l, amountText: dollars(l.amountCents), picked: !(d && alreadyAdded(l, d, entries)) })));
    } catch {
      setMessage('This file couldn’t be read. Try the PDF, or an Excel / CSV export.');
    } finally {
      setBusy(false);
    }
  }

  // Each line as edited: its amount from what's typed, and whether it looks already added.
  const lines = (rows ?? []).map((r) => {
    const cents = amountCents(r.amountText);
    const line = { ...r, amountCents: cents ?? 0, bad: cents === null };
    return { ...line, duplicate: !!date && !line.bad && alreadyAdded(line, date, entries) };
  });
  const picked = lines.filter((r) => r.picked);
  const income = picked.filter((r) => r.kind === 'income').reduce((n, r) => n + r.amountCents, 0);
  const expense = picked.filter((r) => r.kind === 'expense').reduce((n, r) => n + r.amountCents, 0);
  const set = (key: string, patch: Partial<Row>) => setRows((cur) => (cur ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function add() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setMessage('Choose the date for these entries.');
    if (date < '2000-01-01' || date > `${new Date().getFullYear() + 2}-12-31`) return setMessage(`Check the year — ${date.slice(0, 4)} looks like a typo.`);
    const bad = picked.filter((r) => r.bad || !r.description.trim());
    if (bad.length) return setMessage(`Check ${bad.length === 1 ? 'the line' : `${bad.length} lines`} in red — each needs a description and an amount.`);
    // The week it covers (the date alone when the statement names no period, or the date was changed to before it).
    const days = from ? (Date.parse(date) - Date.parse(from)) / 86_400_000 : -1;
    const covers = days >= 0 && days <= 366 ? { coversFrom: from, coversTo: date } : { coversFrom: date, coversTo: date };
    const replaces = (category: string, kind: Row['kind']) => (kind === 'income' ? /^\s*carrier\s+commission/i : /^\s*(agent|producer)\s+(commission|payout)/i).test(category);
    setSaving({ done: 0, total: picked.length });
    const failed: string[] = [];
    for (const [i, r] of picked.entries()) {
      const err = await onSave({ kind: r.kind, date, category: r.category.trim().slice(0, 80) || (r.kind === 'income' ? 'Other income' : 'Other expense'), description: r.description.trim().slice(0, 300), amountCents: r.amountCents, notes: `Imported from ${fileName}${period ? ` (${period})` : ''}`, ...(replaces(r.category, r.kind) ? covers : {}) });
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
      size={rows ? 'xl' : 'lg'}
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
                // Lines that now look already added (same day, amount, description) are unticked.
                setRows((cur) => (cur ?? []).map((r) => {
                  const cents = amountCents(r.amountText);
                  return cents !== null && d && alreadyAdded({ ...r, amountCents: cents }, d, entries) ? { ...r, picked: false } : r;
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
                    <input type="checkbox" aria-label="Tick all" checked={lines.every((r) => r.picked || r.duplicate)} onChange={(e) => setRows((cur) => (cur ?? []).map((r, n) => ({ ...r, picked: e.target.checked && !lines[n].duplicate })))} />
                  </th>
                  <th className="border-b border-[var(--color-ink-100)] px-3 py-2 font-medium">Type</th>
                  <th className="border-b border-[var(--color-ink-100)] px-3 py-2 font-medium">Category</th>
                  <th className="border-b border-[var(--color-ink-100)] px-3 py-2 font-medium">Description</th>
                  <th className="border-b border-[var(--color-ink-100)] px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((r) => (
                  <tr key={r.key} className={cn('align-top', !r.picked && 'bg-[var(--color-ink-50)]/60')} data-statement-row>
                    <td className="border-b border-[var(--color-ink-50)] px-3 py-2">
                      <input type="checkbox" className="mt-1.5" aria-label={`Add ${r.description}`} checked={r.picked} onChange={(e) => set(r.key, { picked: e.target.checked })} />
                    </td>
                    <td className="border-b border-[var(--color-ink-50)] px-3 py-2">
                      <select className={cn('rounded border border-[var(--color-ink-200)] bg-white px-2 py-1 text-sm', r.kind === 'income' ? 'text-[var(--color-success-600)]' : 'text-[var(--color-ink-700)]')} value={r.kind} onChange={(e) => set(r.key, { kind: e.target.value as Row['kind'] })} aria-label={`Type for ${r.description}`}>
                        <option value="income">Income</option>
                        <option value="expense">Expense</option>
                      </select>
                    </td>
                    <td className="border-b border-[var(--color-ink-50)] px-3 py-2">
                      <input className="w-44 rounded border border-[var(--color-ink-200)] bg-white px-2 py-1 text-sm" value={r.category} list={`statement-cat-${r.kind}`} onChange={(e) => set(r.key, { category: e.target.value })} aria-label={`Category for ${r.description}`} />
                    </td>
                    <td className="border-b border-[var(--color-ink-50)] px-3 py-2">
                      <input className={cn('w-full min-w-[160px] rounded border border-[var(--color-ink-200)] bg-white px-2 py-1 text-sm', r.picked && !r.description.trim() && 'border-[var(--color-danger-600)]')} value={r.description} maxLength={300} onChange={(e) => set(r.key, { description: e.target.value })} aria-label={`Description, line ${Number(r.key) + 1}`} />
                      {r.duplicate && <span className="mt-1 block w-fit rounded-full bg-[var(--color-warning-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink-700)]" data-testid="statement-duplicate">Potential duplicate</span>}
                    </td>
                    <td className="border-b border-[var(--color-ink-50)] px-3 py-2 text-right">
                      <input className={cn('w-28 text-right font-semibold tabular-nums rounded border border-[var(--color-ink-200)] bg-white px-2 py-1 text-sm', r.bad && 'border-[var(--color-danger-600)] text-[var(--color-danger-600)]')} inputMode="decimal" value={r.amountText} onChange={(e) => set(r.key, { amountText: e.target.value })} onBlur={() => { const c = amountCents(r.amountText); if (c !== null) set(r.key, { amountText: dollars(c) }); }} aria-label={`Amount for ${r.description}`} aria-invalid={r.bad || undefined} />
                    </td>
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
