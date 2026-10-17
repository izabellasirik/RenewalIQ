import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../ui';
import { fetchFounderAiUsage, type FounderAiUsage } from '../../services/productAnalytics/founderRepo';

/** USD with cents, or fractions of a cent for the small per-document numbers. */
export function formatUsd(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v !== 0 && Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const plural = (n: number, word: string) => `${Number(n).toLocaleString()} ${word}${Number(n) === 1 ? '' : 's'}`;

const OPERATION_LABELS: Record<string, string> = { structured_extraction: 'Extraction (upload)', transcription: 'Transcription (preview)' };
const SOURCE_LABELS: Record<string, string> = { photo: 'Photos', scanned_pdf_page: 'Scanned PDF pages', unknown: 'Unlabelled' };

function Stat({ label, value, hint, testId }: { label: string; value: string | number; hint?: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white px-4 py-3 [box-shadow:var(--shadow-card)]" data-testid={testId}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-400)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--color-ink-900)]">{value}</p>
      {hint && <p className="text-xs text-[var(--color-ink-500)]">{hint}</p>}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; detail: string; cost: number }[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-[var(--color-ink-700)]">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--color-ink-400)]">Nothing yet this month.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.label} className="flex items-baseline justify-between gap-3 text-xs text-[var(--color-ink-700)]">
              <span className="truncate">
                {r.label} <span className="text-[var(--color-ink-400)]">· {r.detail}</span>
              </span>
              <span className="font-medium tabular-nums">{formatUsd(r.cost)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Founder Analytics → AI Usage & Cost. Read through founder_ai_usage() (0046), which the database
 * refuses to anyone but the founder — this component is only ever rendered on the founder page.
 */
export function AiUsageSection() {
  const [data, setData] = useState<FounderAiUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetchFounderAiUsage();
    // The database doesn't have 0046 yet: say what to do rather than show PostgREST's message.
    if (!res.ok) return setError(/founder_ai_usage|schema cache|PGRST202/i.test(res.message) ? 'AI usage tracking isn’t set up in the database yet — run supabase/migrations/0046_ai_usage.sql in the Supabase SQL Editor, then refresh.' : res.message);
    setError(null);
    setData(res.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const maxDay = Math.max(0.0001, ...(data?.daily ?? []).map((d) => Number(d.cost)));
  return (
    <Card data-testid="founder-ai-usage">
      <CardHeader className="pb-2">
        <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">AI Usage &amp; Cost</h3>
        <p className="text-xs text-[var(--color-ink-500)]">
          Every AI read of a photo or scanned page, with the tokens Anthropic billed. Reuses of an earlier read cost nothing.{data ? ` Days in ${data.timezone}.` : ''}
        </p>
      </CardHeader>
      <CardBody className="flex flex-col gap-4 pt-1">
        {error && <p className="text-sm text-[var(--color-danger-700)]">{error}</p>}
        {!data && !error && (
          <p className="flex items-center gap-2 text-sm text-[var(--color-ink-500)]">
            <Loader2 size={15} className="animate-spin" /> Loading…
          </p>
        )}
        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="AI cost today" value={formatUsd(data.costToday)} testId="ai-cost-today" />
              <Stat label="AI cost this week" value={formatUsd(data.costWeek)} testId="ai-cost-week" />
              <Stat label="AI cost this month" value={formatUsd(data.costMonth)} testId="ai-cost-month" />
              <Stat label="Avg cost per document" value={formatUsd(data.avgCostPerDocumentMonth)} hint="this month" testId="ai-avg-doc" />
              <Stat label="Documents processed" value={data.documentsMonth} hint="this month" testId="ai-docs" />
              <Stat label="Scanned pages processed" value={data.scannedPagesMonth} hint="this month" testId="ai-pages" />
              <Stat label="Paid AI calls" value={data.paidCallsMonth} hint={data.failedCallsMonth ? `${data.failedCallsMonth} failed · this month` : 'this month'} testId="ai-paid-calls" />
              <Stat label="Cached / reused reads" value={data.cachedReadsMonth} hint="no new paid call" testId="ai-cached" />
            </div>
            {data.topDocumentMonth && (
              <p className="text-xs text-[var(--color-ink-600)]" data-testid="ai-top-document">
                Highest-cost document this month: <span className="font-medium">{data.topDocumentMonth.fileName ?? data.topDocumentMonth.documentId}</span> — {formatUsd(data.topDocumentMonth.cost)} over{' '}
                {data.topDocumentMonth.calls} paid call{data.topDocumentMonth.calls === 1 ? '' : 's'}
              </p>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold text-[var(--color-ink-700)]">Daily AI cost — last 30 days</p>
              <div className="flex h-20 items-end gap-[2px]" data-testid="ai-daily-trend">
                {data.daily.map((d) => (
                  <div
                    key={d.day}
                    title={`${d.day}: ${formatUsd(d.cost)} · ${d.calls} paid call${d.calls === 1 ? '' : 's'}`}
                    className="flex-1 rounded-t bg-[var(--color-brand-700)]"
                    style={{ height: `${Math.max(Number(d.cost) > 0 ? 4 : 1, (Number(d.cost) / maxDay) * 100)}%`, opacity: Number(d.cost) > 0 ? 1 : 0.2 }}
                  />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Breakdown title="By model (this month)" rows={data.byModel.map((m) => ({ label: m.model, detail: `${plural(m.calls, 'call')} · ${Number(m.inputTokens).toLocaleString()} in / ${Number(m.outputTokens).toLocaleString()} out tokens`, cost: m.cost }))} />
              <Breakdown title="By brokerage" rows={data.byBrokerage.map((b) => ({ label: b.name, detail: `${plural(b.documents, 'doc')} · ${plural(b.calls, 'call')}`, cost: b.cost }))} />
              <Breakdown title="Extraction vs transcription" rows={data.byOperation.map((o) => ({ label: OPERATION_LABELS[o.operation] ?? o.operation, detail: `${o.calls} paid · ${o.cached} reused`, cost: o.cost }))} />
              <Breakdown title="Photos vs scanned PDF pages" rows={data.bySource.map((s) => ({ label: SOURCE_LABELS[s.source] ?? s.source, detail: plural(s.calls, 'paid call'), cost: s.cost }))} />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
