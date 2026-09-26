import { useState, type FormEvent } from 'react';
import { ExternalLink } from 'lucide-react';
import type { MarketQuote, MissingItem } from '../../types';
import { MISSING_ITEM_STATUS_LABELS, QUOTE_STATUS_LABELS } from '../../types';
import { Badge, Button, Modal } from '../ui';
import { MarketDetailDrawer } from '../appetite/MarketDetailDrawer';
import { useAccountsStore } from '../../state/useAccountsStore';
import { formatShortDate } from '../../services/workflow/dates';
import { forwardedAt } from '../../services/workflow/requirementKey';
import { QuoteOptionsList } from './QuoteOptionsList';
import { QUOTE_STATUS_TONE } from './quoteStatus';

/**
 * Everything about one market on an account, in one small window (opened by clicking the market's
 * name): status and dates, the notes — with a box to add one — every quote it returned, what the
 * carrier asked for and where each item stands, and, when the market is in the appetite database, a
 * short appetite summary with the full record one click away. Other changes stay on the card.
 */
export function MarketDetailsDialog({
  accountId,
  quote,
  requestedItems,
  open,
  onClose,
}: {
  accountId: string;
  quote: MarketQuote;
  requestedItems: MissingItem[];
  open: boolean;
  onClose: () => void;
}) {
  const records = useAccountsStore((s) => s.effectiveAppetiteRecords);
  const [appetiteOpen, setAppetiteOpen] = useState(false);
  const addQuoteNote = useAccountsStore((s) => s.addQuoteNote);
  const [draft, setDraft] = useState('');
  const record =
    records.find((r) => r.id === quote.appetiteRecordId) ??
    records.find((r) => r.marketName.trim().toLowerCase() === quote.marketName.trim().toLowerCase()) ??
    null;
  const notes = [...quote.notes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const facts: [string, string | null | undefined][] = [
    ['Status', QUOTE_STATUS_LABELS[quote.status]],
    ['Sent', quote.submittedAt ? formatShortDate(quote.submittedAt) : 'Not submitted yet'],
    ['Follow up', quote.followUpDate ? formatShortDate(quote.followUpDate) : null],
    ['Premium', quote.premium ? `$${quote.premium.toLocaleString('en-US')}` : null],
    ['Declined because', quote.status === 'declined' ? quote.declineReason : null],
    ['Added', formatShortDate(quote.createdAt)],
  ];

  return (
    <>
      <Modal open={open && !appetiteOpen} onClose={onClose} title={quote.marketName} subtitle={record ? `${record.marketType === 'direct' ? 'Direct carrier' : 'MGA'}${record.availableThrough ? ` · through ${record.availableThrough}` : ''}` : undefined}>
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            {facts
              .filter(([, v]) => !!v)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-[var(--color-ink-500)]">{label}</dt>
                  <dd className="font-medium text-[var(--color-ink-900)]">{label === 'Status' ? <Badge tone={QUOTE_STATUS_TONE[quote.status]}>{value}</Badge> : value}</dd>
                </div>
              ))}
          </dl>

          <section>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Notes</p>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (!draft.trim()) return;
                addQuoteNote(accountId, quote.id, draft);
                setDraft('');
              }}
              className="mb-2 flex items-start gap-2"
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder={`Add a note about ${quote.marketName}…`}
                aria-label={`New note for ${quote.marketName}`}
                className="min-w-0 flex-1 rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
              />
              <Button type="submit" size="sm" disabled={!draft.trim()}>
                Add note
              </Button>
            </form>
            {notes.length === 0 ? (
              <p className="text-sm italic text-[var(--color-ink-400)]">No notes yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {notes.map((n) => (
                  <li key={n.id} className="text-sm">
                    <span className="text-xs text-[var(--color-ink-400)]">{formatShortDate(n.createdAt)}</span>
                    <p className="whitespace-pre-line text-[var(--color-ink-700)]">{n.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <QuoteOptionsList accountId={accountId} quote={quote} />

          <section>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Requested by {quote.marketName}</p>
            {requestedItems.length === 0 ? (
              <p className="text-sm italic text-[var(--color-ink-400)]">Nothing requested.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {requestedItems.map((item) => {
                  const sent = forwardedAt(item, quote.id);
                  return (
                    <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate text-[var(--color-ink-800)]">{item.label}</span>
                      <span className="shrink-0 text-xs text-[var(--color-ink-500)]">{sent ? `Sent ${formatShortDate(sent)}` : MISSING_ITEM_STATUS_LABELS[item.status]}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>


          {record && (
            <section className="rounded-lg bg-[var(--color-ink-50)] px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Appetite</p>
              {record.underwritingNotes ? (
                <p className="mt-1 line-clamp-3 text-sm text-[var(--color-ink-700)]">{record.underwritingNotes}</p>
              ) : (
                <p className="mt-1 text-sm text-[var(--color-ink-500)]">This market is in the appetite database.</p>
              )}
              <Button size="sm" variant="secondary" icon={<ExternalLink size={13} />} className="mt-2" onClick={() => setAppetiteOpen(true)}>
                Full appetite record
              </Button>
            </section>
          )}
        </div>
      </Modal>
      <MarketDetailDrawer open={open && appetiteOpen} onClose={() => setAppetiteOpen(false)} record={record} result={null} />
    </>
  );
}
