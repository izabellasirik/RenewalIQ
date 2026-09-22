import { useMemo, useState, type FormEvent } from 'react';
import { BadgeDollarSign, Building2, FileQuestion, Plus, Send, ShieldCheck, StickyNote, Trash2, XCircle } from 'lucide-react';
import type { MarketQuote, MissingItem, MissingItemType, QuoteStatus } from '../../types';
import { AWAITING_CARRIER_STATUSES, QUOTE_STATUS_LABELS, QUOTE_STATUS_ORDER } from '../../types';
import { Badge, Button, Card, CardBody, EmptyState, OverflowMenu } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { addBusinessDays, formatShortDate, todayKey } from '../../services/workflow/dates';
import { RequestItemsDialog } from './RequestItemsDialog';
import { DateInput } from './DateInput';
import { formatTimestampShort } from './time';
import { QUOTE_STATUS_TONE } from './quoteStatus';
import { inputClass, labelClass, smallInputClass } from './formStyles';
import { cn } from '../../utils/cn';

const STATUS_SORT: Record<QuoteStatus, number> = { additional_info_requested: 0, quoted: 1, waiting_on_carrier: 2, submitted: 3, preparing: 4, bound: 5, declined: 6 };

export function QuotesPanel({ accountId, focusQuoteId }: { accountId: string; focusQuoteId?: string }) {
  const { quotes, items, contacts } = useAccountWorkflow(accountId);
  const appetiteRecords = useAccountsStore((s) => s.effectiveAppetiteRecords);
  const [adding, setAdding] = useState(false);
  const [requestIds, setRequestIds] = useState<string[] | null>(null);

  const sorted = useMemo(() => [...quotes].sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status] || (a.createdAt < b.createdAt ? -1 : 1)), [quotes]);
  const marketNames = useMemo(() => [...new Set(appetiteRecords.map((r) => r.marketName))].sort(), [appetiteRecords]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-ink-500)]">Every market this account is out to, where it stands, and what each carrier is waiting on.</p>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setAdding((v) => !v)}>
          Add market
        </Button>
      </div>

      {adding && <AddMarketForm accountId={accountId} marketNames={marketNames} onDone={() => setAdding(false)} />}

      {quotes.length === 0 && !adding ? (
        <EmptyState
          icon={<Building2 size={26} strokeWidth={1.5} />}
          title="No markets yet"
          description="Add a carrier or MGA you're submitting to (e.g. Progressive), or add one from Carrier Appetite / Market Finder."
          action={
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
              Add market
            </Button>
          }
        />
      ) : (
        sorted.map((quote) => (
          <QuoteCard
            key={quote.id}
            accountId={accountId}
            quote={quote}
            highlighted={quote.id === focusQuoteId}
            requestedItems={items.filter((i) => i.neededByQuoteId === quote.id)}
            contactName={(id) => contacts.find((c) => c.id === id)?.name}
            onRequestFromClient={(ids) => setRequestIds(ids)}
          />
        ))
      )}

      <datalist id="market-name-options">
        {marketNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <RequestItemsDialog accountId={accountId} itemIds={requestIds ?? []} open={!!requestIds} onClose={() => setRequestIds(null)} />
    </div>
  );
}

function AddMarketForm({ accountId, marketNames, onDone }: { accountId: string; marketNames: string[]; onDone: () => void }) {
  const addQuote = useAccountsStore((s) => s.addQuote);
  const appetiteRecords = useAccountsStore((s) => s.effectiveAppetiteRecords);
  const [name, setName] = useState('');
  const [sent, setSent] = useState(false);
  const [submittedAt, setSubmittedAt] = useState(todayKey());
  const [followUpDate, setFollowUpDate] = useState(addBusinessDays(new Date(), 3));

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const record = appetiteRecords.find((r) => r.marketName.toLowerCase() === trimmed.toLowerCase());
    addQuote(accountId, {
      marketName: record?.marketName ?? trimmed,
      appetiteRecordId: record?.id,
      status: sent ? 'submitted' : 'preparing',
      submittedAt: sent ? submittedAt : undefined,
      followUpDate: sent ? followUpDate : undefined,
    });
    onDone();
  }

  return (
    <Card>
      <CardBody className="pt-4">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
            <div>
              <label className={labelClass}>Market / carrier</label>
              <input value={name} onChange={(e) => setName(e.target.value)} list="market-name-options" className={inputClass} placeholder="e.g. Progressive" autoFocus />
              {marketNames.length > 0 && <p className="mt-1 text-[11px] text-[var(--color-ink-400)]">Type any carrier or MGA — known markets autocomplete.</p>}
            </div>
            {sent && (
              <>
                <div>
                  <label className={labelClass}>Submission sent</label>
                  <input type="date" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Follow up on</label>
                  <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className={inputClass} />
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-[var(--color-ink-700)]">
              <input type="checkbox" checked={sent} onChange={(e) => setSent(e.target.checked)} />
              Submission already sent
            </label>
            <div className="ml-auto flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" size="sm" icon={<Plus size={14} />} disabled={!name.trim()}>
                Add market
              </Button>
            </div>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

type InlineForm = null | 'submit' | 'quote' | 'decline' | 'request' | 'note';

function QuoteCard({
  accountId,
  quote,
  highlighted,
  requestedItems,
  contactName,
  onRequestFromClient,
}: {
  accountId: string;
  quote: MarketQuote;
  highlighted: boolean;
  requestedItems: MissingItem[];
  contactName: (id?: string) => string | undefined;
  onRequestFromClient: (itemIds: string[]) => void;
}) {
  const updateQuote = useAccountsStore((s) => s.updateQuote);
  const deleteQuote = useAccountsStore((s) => s.deleteQuote);
  const addQuoteNote = useAccountsStore((s) => s.addQuoteNote);
  const recordCarrierRequest = useAccountsStore((s) => s.recordCarrierRequest);
  const markItemSentToCarrier = useAccountsStore((s) => s.markItemSentToCarrier);

  const [form, setForm] = useState<InlineForm>(null);
  const [date, setDate] = useState(todayKey());
  const [followUp, setFollowUp] = useState(addBusinessDays(new Date(), 3));
  const [premium, setPremium] = useState('');
  const [reason, setReason] = useState('');
  const [reqLabel, setReqLabel] = useState('');
  const [reqType, setReqType] = useState<MissingItemType>('document');
  const [note, setNote] = useState('');

  const awaiting = AWAITING_CARRIER_STATUSES.includes(quote.status);
  const closed = quote.status === 'declined' || quote.status === 'bound';
  const followUpDue = awaiting && quote.followUpDate && quote.followUpDate <= todayKey();

  function open(f: InlineForm) {
    setForm((cur) => (cur === f ? null : f));
    setDate(todayKey());
    setFollowUp(addBusinessDays(new Date(), 3));
    setPremium(quote.premium ? String(quote.premium) : '');
    setReason(quote.declineReason ?? '');
    setReqLabel('');
    setNote('');
  }

  function parsePremium(v: string): number | undefined {
    const n = Number(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  function submitInline(e: FormEvent) {
    e.preventDefault();
    if (form === 'submit') updateQuote(accountId, quote.id, { status: 'submitted', submittedAt: date, followUpDate: followUp || undefined });
    if (form === 'quote') updateQuote(accountId, quote.id, { status: 'quoted', premium: parsePremium(premium) });
    if (form === 'decline') updateQuote(accountId, quote.id, { status: 'declined', declineReason: reason.trim() || undefined });
    if (form === 'note') addQuoteNote(accountId, quote.id, note);
    if (form === 'request') {
      if (!reqLabel.trim()) return;
      // Only records the request. The client email is drafted when the broker clicks "Request from client".
      recordCarrierRequest(accountId, quote.id, { label: reqLabel.trim(), type: reqType });
    }
    setForm(null);
  }

  const notes = [...quote.notes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <Card className={cn(highlighted && 'ring-2 ring-[var(--color-brand-500)]')}>
      <CardBody className="pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-[var(--color-ink-900)]">{quote.marketName}</h3>
              <Badge tone={QUOTE_STATUS_TONE[quote.status]}>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
              {quote.premium && (quote.status === 'quoted' || quote.status === 'bound') && (
                <span className="text-sm font-semibold text-[var(--color-success-600)]">${quote.premium.toLocaleString('en-US')}</span>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--color-ink-500)]">
              {quote.submittedAt ? `Submitted ${formatShortDate(quote.submittedAt)}` : 'Not submitted yet'}
              {quote.status === 'declined' && quote.declineReason ? ` · Declined: ${quote.declineReason}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={quote.status}
              onChange={(e) => updateQuote(accountId, quote.id, { status: e.target.value as QuoteStatus })}
              className={smallInputClass}
              aria-label={`Status for ${quote.marketName}`}
            >
              {QUOTE_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {QUOTE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <OverflowMenu items={[{ key: 'delete', label: 'Remove market', icon: <Trash2 size={14} />, tone: 'danger', onSelect: () => deleteQuote(accountId, quote.id) }]} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--color-ink-600)]">
          <label className="inline-flex items-center gap-1.5">
            Sent
            <DateInput value={quote.submittedAt} onCommit={(v) => updateQuote(accountId, quote.id, { submittedAt: v })} className={smallInputClass} aria-label={`Date sent to ${quote.marketName}`} />
          </label>
          {awaiting && (
            <label className={cn('inline-flex items-center gap-1.5', followUpDue && 'font-medium text-[var(--color-danger-600)]')}>
              Follow up
              <DateInput value={quote.followUpDate} onCommit={(v) => updateQuote(accountId, quote.id, { followUpDate: v })} className={smallInputClass} aria-label={`Follow-up date for ${quote.marketName}`} />
              {followUpDue && <span>due</span>}
            </label>
          )}
        </div>

        {!closed && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {quote.status === 'preparing' && (
              <Button size="sm" icon={<Send size={13} />} onClick={() => open('submit')}>
                Mark submitted
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<FileQuestion size={13} />} onClick={() => open('request')}>
              Carrier requested…
            </Button>
            {quote.status !== 'quoted' && (
              <Button size="sm" variant="secondary" icon={<BadgeDollarSign size={13} />} onClick={() => open('quote')}>
                Record quote
              </Button>
            )}
            {quote.status === 'quoted' && (
              <Button size="sm" variant="secondary" icon={<ShieldCheck size={13} />} onClick={() => updateQuote(accountId, quote.id, { status: 'bound' })}>
                Mark bound
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<XCircle size={13} />} onClick={() => open('decline')}>
              Declined
            </Button>
          </div>
        )}

        {form && form !== 'note' && (
          <form onSubmit={submitInline} className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            {form === 'submit' && (
              <>
                <div>
                  <label className={labelClass}>Submission sent</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Follow up on</label>
                  <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={inputClass} />
                </div>
              </>
            )}
            {form === 'quote' && (
              <div className="sm:col-span-2">
                <label className={labelClass}>Premium</label>
                <input value={premium} onChange={(e) => setPremium(e.target.value)} className={inputClass} placeholder="$12,500" inputMode="decimal" autoFocus />
              </div>
            )}
            {form === 'decline' && (
              <div className="sm:col-span-2">
                <label className={labelClass}>Reason</label>
                <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="e.g. Outside appetite — hazmat" autoFocus />
              </div>
            )}
            {form === 'request' && (
              <>
                <div>
                  <label className={labelClass}>{quote.marketName} requested</label>
                  <input value={reqLabel} onChange={(e) => setReqLabel(e.target.value)} className={inputClass} placeholder="e.g. Current MVR — John Smith" autoFocus />
                </div>
                <div>
                  <label className={labelClass}>Type</label>
                  <select value={reqType} onChange={(e) => setReqType(e.target.value as MissingItemType)} className={inputClass}>
                    <option value="document">Document</option>
                    <option value="information">Information</option>
                  </select>
                </div>
              </>
            )}
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={form === 'request' && !reqLabel.trim()}>
                Save
              </Button>
            </div>
          </form>
        )}

        {requestedItems.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Requested by {quote.marketName}</p>
            <ul className="flex flex-col gap-1.5">
              {requestedItems.map((item) => {
                const ready = item.status === 'received' && !item.forwardedToCarrierAt;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      'flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between',
                      ready ? 'border-[var(--color-accent-500)]/40 bg-[var(--color-accent-100)]/40' : 'border-[var(--color-ink-100)]'
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-ink-800)]">{item.label}</p>
                      <p className="text-xs text-[var(--color-ink-500)]">
                        {item.forwardedToCarrierAt
                          ? `Sent to ${quote.marketName} ${formatShortDate(item.forwardedToCarrierAt)}`
                          : item.status === 'received'
                            ? `Received ${item.receivedAt ? formatShortDate(item.receivedAt) : ''} — ready to send`
                            : item.status === 'requested'
                              ? `Waiting on client${contactName(item.requestedFromContactId) ? ` (${contactName(item.requestedFromContactId)})` : ''}${item.followUpDate ? ` · follow-up ${formatShortDate(item.followUpDate)}` : ''}`
                              : item.status === 'waived'
                                ? 'Waived'
                                : 'Not yet requested from client'}
                      </p>
                    </div>
                    {ready && (
                      <Button size="sm" icon={<Send size={13} />} onClick={() => markItemSentToCarrier(accountId, item.id)}>
                        Mark sent to {quote.marketName}
                      </Button>
                    )}
                    {item.status === 'missing' && (
                      <Button size="sm" variant="secondary" onClick={() => onRequestFromClient([item.id])}>
                        Request from client
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-4 border-t border-[var(--color-ink-100)] pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Notes</p>
            {form !== 'note' && (
              <button onClick={() => open('note')} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
                <StickyNote size={12} /> Add note
              </button>
            )}
          </div>
          {form === 'note' && (
            <form onSubmit={submitInline} className="mt-2 flex flex-col gap-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputClass} placeholder={`e.g. Spoke with ${quote.marketName} underwriter — expects quote Friday`} autoFocus />
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={!note.trim()}>
                  Save note
                </Button>
              </div>
            </form>
          )}
          {notes.length === 0 && form !== 'note' ? (
            <p className="mt-1 text-xs text-[var(--color-ink-400)]">No notes yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {notes.map((n) => (
                <li key={n.id} className="text-sm">
                  <span className="mr-2 text-xs text-[var(--color-ink-400)]">{formatTimestampShort(n.createdAt)}</span>
                  <span className="whitespace-pre-line text-[var(--color-ink-700)]">{n.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
