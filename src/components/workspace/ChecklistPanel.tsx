import { useMemo, useState, type FormEvent } from 'react';
import { Ban, CheckCircle2, Circle, ClipboardList, Clock, Mail, PackageCheck, Pencil, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import type { MarketQuote, MissingItem, MissingItemStatus, MissingItemType, UploadedDocument } from '../../types';
import { carriersFor, forwardedAt } from '../../services/workflow/requirementKey';
import { MISSING_ITEM_STATUS_LABELS } from '../../types';
import { Badge, Button, Card, CardBody, EmptyState, OverflowMenu, ProgressBar, type OverflowMenuItem } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { CHECKLIST_TEMPLATES, expandTemplate, findTemplateItem } from '../../services/workflow/checklistTemplates';
import { formatShortDate, todayKey } from '../../services/workflow/dates';
import { RequestItemsDialog } from './RequestItemsDialog';
import { ReceiveItemDialog } from './ReceiveItemDialog';
import { DocumentPreviewLink } from './DocumentPreviewLink';
import { DateInput } from './DateInput';
import { inputClass, labelClass, linkButtonClass, smallInputClass } from './formStyles';
import { cn } from '../../utils/cn';

/** Received, but at least one carrier that asked for it hasn't been sent it yet. */
function awaitingSend(item: MissingItem): boolean {
  return item.status === 'received' && carriersFor(item).some((q) => !forwardedAt(item, q));
}

function statusRank(item: MissingItem): number {
  if (awaitingSend(item)) return 0;
  if (item.status === 'missing') return carriersFor(item).length ? 1 : 2;
  if (item.status === 'requested') return 3;
  if (item.status === 'received') return 4;
  return 5;
}

/**
 * The submission checklist: what's missing, what's been requested from whom, what's received, and
 * which carrier is waiting on what. `compact` (Account Overview) shows only outstanding items.
 */
export function ChecklistPanel({ accountId, compact = false, onViewAll }: { accountId: string; compact?: boolean; onViewAll?: () => void }) {
  const { profile, documents, items, quotes, contacts } = useAccountWorkflow(accountId);
  const addMissingItems = useAccountsStore((s) => s.addMissingItems);
  const recordCarrierRequest = useAccountsStore((s) => s.recordCarrierRequest);

  const [requestIds, setRequestIds] = useState<string[] | null>(null);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const sorted = useMemo(() => [...items].sort((a, b) => statusRank(a) - statusRank(b) || (a.createdAt < b.createdAt ? -1 : 1)), [items]);
  const outstanding = sorted.filter((i) => i.status === 'missing' || i.status === 'requested' || awaitingSend(i));
  // Overview shows what's outstanding first, then what's been received (so a just-clicked
  // "Received" stays visible to double-check); waived items only in the full checklist.
  const visible = compact ? [...outstanding, ...sorted.filter((i) => i.status === 'received' && !outstanding.includes(i))] : sorted;
  const unrequested = items.filter((i) => i.status === 'missing');
  const active = items.filter((i) => i.status !== 'waived');
  const receivedCount = active.filter((i) => i.status === 'received').length;
  const hasTemplate = items.some((i) => !!i.templateKey);

  const linkedDocIds = new Set(items.map((i) => i.documentId).filter(Boolean));

  function startTemplate(key: string) {
    const template = CHECKLIST_TEMPLATES.find((t) => t.key === key);
    if (!template) return;
    const existing = new Set(items.map((i) => i.templateKey));
    addMissingItems(
      accountId,
      expandTemplate(template, profile).filter((seed) => !existing.has(seed.templateKey))
    );
  }

  return (
    <Card>
      <CardBody className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
              <ClipboardList size={16} className="text-[var(--color-ink-500)]" />
              {compact ? 'Missing & received items' : 'Submission checklist'}
            </h3>
            {active.length > 0 && (
              <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
                {receivedCount} of {active.length} received
                {outstanding.length > 0 ? ` · ${outstanding.length} outstanding` : ''}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unrequested.length > 1 && (
              <Button size="sm" variant="secondary" icon={<Mail size={14} />} onClick={() => setRequestIds(unrequested.map((i) => i.id))}>
                Request all missing ({unrequested.length})
              </Button>
            )}
            {!compact && (
              <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setAdding((v) => !v)}>
                Add item
              </Button>
            )}
            {compact && onViewAll && items.length > 0 && (
              <button onClick={onViewAll} className={linkButtonClass}>
                Full checklist →
              </button>
            )}
          </div>
        </div>

        {active.length > 0 && !compact && <ProgressBar value={(receivedCount / Math.max(active.length, 1)) * 100} className="mt-3" />}

        {!compact && adding && <AddItemForm accountId={accountId} quotes={quotes.map((q) => ({ id: q.id, name: q.marketName }))} onDone={() => setAdding(false)} addMissingItems={addMissingItems} recordCarrierRequest={recordCarrierRequest} />}

        {items.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<ClipboardList size={24} strokeWidth={1.5} />}
              title="No checklist yet"
              description="Start from the standard trucking submission checklist, then mark what you already have."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {CHECKLIST_TEMPLATES.map((t) => (
                    <Button key={t.key} size="sm" icon={<ClipboardList size={14} />} onClick={() => startTemplate(t.key)}>
                      Start {t.label.toLowerCase()} checklist
                    </Button>
                  ))}
                  {!compact && (
                    <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
                      Add item manually
                    </Button>
                  )}
                </div>
              }
            />
          </div>
        ) : visible.length === 0 ? (
          <p className="mt-4 flex items-center gap-1.5 rounded-lg bg-[var(--color-success-100)]/50 px-3 py-2.5 text-sm text-[var(--color-success-600)]">
            <CheckCircle2 size={15} />
            Nothing outstanding — every checklist item is received or waived.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {compact && outstanding.length === 0 && (
              <li className="flex items-center gap-1.5 rounded-lg bg-[var(--color-success-100)]/50 px-3 py-2 text-sm text-[var(--color-success-600)]">
                <CheckCircle2 size={15} />
                Nothing outstanding — received items below.
              </li>
            )}
            {visible.map((item) => (
              <ItemRow
                key={item.id}
                accountId={accountId}
                item={item}
                carriers={carriersFor(item).map((id) => quotes.find((q) => q.id === id)).filter((q): q is MarketQuote => !!q)}
                contactName={contacts.find((c) => c.id === item.requestedFromContactId)?.name}
                document={documents.find((d) => d.id === item.documentId)}
                suggestedDoc={
                  item.status === 'missing' || item.status === 'requested'
                    ? documents.find((d) => !linkedDocIds.has(d.id) && (findTemplateItem(item.templateKey)?.documentCategories ?? []).includes(d.category))
                    : undefined
                }
                onRequest={() => setRequestIds([item.id])}
                onReceive={() => setReceiveId(item.id)}
              />
            ))}
          </ul>
        )}

        {!compact && items.length > 0 && !hasTemplate && (
          <div className="mt-3 flex flex-wrap gap-2">
            {CHECKLIST_TEMPLATES.map((t) => (
              <button key={t.key} onClick={() => startTemplate(t.key)} className={linkButtonClass}>
                <Plus size={12} /> Add the {t.label.toLowerCase()} checklist
              </button>
            ))}
          </div>
        )}
      </CardBody>

      <RequestItemsDialog accountId={accountId} itemIds={requestIds ?? []} open={!!requestIds} onClose={() => setRequestIds(null)} />
      <ReceiveItemDialog accountId={accountId} itemId={receiveId} open={!!receiveId} onClose={() => setReceiveId(null)} />
    </Card>
  );
}

function ItemRow({
  accountId,
  item,
  carriers,
  contactName,
  document,
  suggestedDoc,
  onRequest,
  onReceive,
}: {
  accountId: string;
  item: MissingItem;
  /** Every carrier linked to this requirement. */
  carriers: MarketQuote[];
  contactName?: string;
  document?: UploadedDocument;
  suggestedDoc?: UploadedDocument;
  onRequest: () => void;
  onReceive: () => void;
}) {
  const updateMissingItem = useAccountsStore((s) => s.updateMissingItem);
  const setItemStatus = useAccountsStore((s) => s.setItemStatus);
  const deleteMissingItem = useAccountsStore((s) => s.deleteMissingItem);
  const markItemReceived = useAccountsStore((s) => s.markItemReceived);
  const markItemSentToCarrier = useAccountsStore((s) => s.markItemSentToCarrier);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(item.label);
  const [draftNotes, setDraftNotes] = useState(item.notes ?? '');

  // One "Mark sent" per carrier still waiting on this (received) requirement.
  const readyToSend = item.status === 'received' ? carriers.filter((q) => q.status !== 'declined' && q.status !== 'bound' && !forwardedAt(item, q.id)) : [];
  const sentTo = carriers.filter((q) => forwardedAt(item, q.id));
  const followUpDue = item.status === 'requested' && item.followUpDate && item.followUpDate <= todayKey();

  const menu: OverflowMenuItem[] = [
    {
      key: 'edit',
      label: 'Edit / notes',
      icon: <Pencil size={14} />,
      onSelect: () => {
        setDraftLabel(item.label);
        setDraftNotes(item.notes ?? '');
        setEditing(true);
      },
    },
    ...(item.status === 'received' || item.status === 'waived'
      ? [{ key: 'reopen', label: 'Move back to missing', icon: <RotateCcw size={14} />, onSelect: () => setItemStatus(accountId, item.id, 'missing') }]
      : [{ key: 'waive', label: 'Waive (not needed)', icon: <Ban size={14} />, onSelect: () => setItemStatus(accountId, item.id, 'waived') }]),
    { key: 'delete', label: 'Remove item', icon: <Trash2 size={14} />, tone: 'danger' as const, onSelect: () => deleteMissingItem(accountId, item.id) },
  ];

  function saveEdit() {
    if (!draftLabel.trim()) return;
    updateMissingItem(accountId, item.id, { label: draftLabel.trim(), notes: draftNotes.trim() || undefined });
    setEditing(false);
  }

  const StatusIcon = item.status === 'received' ? CheckCircle2 : item.status === 'requested' ? Clock : item.status === 'waived' ? Ban : Circle;

  return (
    <li
      className={cn(
        'rounded-lg border px-3 py-2.5',
        readyToSend.length > 0 ? 'border-[var(--color-accent-500)]/40 bg-[var(--color-accent-100)]/40' : 'border-[var(--color-ink-100)] bg-white',
        item.status === 'waived' && 'opacity-60'
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 gap-2.5">
          <StatusIcon
            size={16}
            className={cn(
              'mt-0.5 shrink-0',
              item.status === 'received' ? 'text-[var(--color-success-500)]' : item.status === 'requested' ? 'text-[var(--color-warning-500)]' : item.status === 'missing' ? 'text-[var(--color-danger-500)]' : 'text-[var(--color-ink-300)]'
            )}
          />
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex flex-col gap-1.5">
                <input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} className={inputClass} autoFocus />
                <textarea value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} className={inputClass} rows={2} placeholder="Notes" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEdit}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className={cn('text-sm font-medium text-[var(--color-ink-800)]', item.status === 'waived' && 'line-through')}>{item.label}</p>
                  {item.type === 'information' && <span className="rounded bg-[var(--color-ink-100)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-ink-500)]">Info</span>}
                  <ItemStatusSelect
                    value={item.status}
                    // Choosing Received asks for the file, the same as the Received button; cancelling keeps the old status.
                    onChange={(status) => (status === 'received' && item.status !== 'received' ? onReceive() : setItemStatus(accountId, item.id, status))}
                    label={item.label}
                  />
                  {carriers.length > 0 && (
                    <Badge tone="brand" className="px-2 py-0.5 text-[11px]">
                      Needed by {carriers.map((q) => q.marketName).join(', ')}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex flex-col gap-0.5 text-xs text-[var(--color-ink-500)]">
                  {item.status === 'requested' && (
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      Requested{contactName ? ` from ${contactName}` : ''}
                      {item.requestedAt ? ` ${formatShortDate(item.requestedAt)}` : ''} ·
                      <label className={cn('inline-flex items-center gap-1', followUpDue && 'font-medium text-[var(--color-danger-600)]')}>
                        Follow-up
                        <DateInput
                          value={item.followUpDate}
                          onCommit={(v) => updateMissingItem(accountId, item.id, { followUpDate: v })}
                          className={smallInputClass}
                          aria-label={`Follow-up date for ${item.label}`}
                        />
                      </label>
                    </span>
                  )}
                  {item.status === 'received' && (
                    <span>
                      Received {item.receivedAt ? formatShortDate(item.receivedAt) : ''}
                      {sentTo.map((q) => ` · Sent to ${q.marketName} ${formatShortDate(forwardedAt(item, q.id))}`).join('')}
                    </span>
                  )}
                  {document && <DocumentPreviewLink doc={document} />}
                  {suggestedDoc && (
                    <span className="flex flex-wrap items-center gap-1 text-[var(--color-accent-600)]">
                      Uploaded: {suggestedDoc.name}
                      <button onClick={() => markItemReceived(accountId, item.id, { documentId: suggestedDoc.id })} className="font-medium underline cursor-pointer">
                        Mark received with this file
                      </button>
                    </span>
                  )}
                  {item.notes && <span className="whitespace-pre-line italic">{item.notes}</span>}
                </div>
              </>
            )}
          </div>
        </div>

        {!editing && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
            {readyToSend.map((q) => (
              <Button key={q.id} size="sm" icon={<Send size={13} />} onClick={() => markItemSentToCarrier(accountId, item.id, q.id)}>
                Mark sent to {q.marketName}
              </Button>
            ))}
            {(item.status === 'missing' || item.status === 'requested') && (
              <>
                <Button size="sm" variant={item.status === 'missing' ? 'primary' : 'secondary'} icon={<Mail size={13} />} onClick={onRequest}>
                  {item.status === 'requested' ? 'Request again' : 'Request'}
                </Button>
                <Button size="sm" variant="secondary" icon={<PackageCheck size={13} />} onClick={onReceive}>
                  Received
                </Button>
              </>
            )}
            <OverflowMenu items={menu} />
          </div>
        )}
      </div>
    </li>
  );
}

const MISSING_ITEM_STATUS_ORDER: MissingItemStatus[] = ['missing', 'requested', 'received', 'waived'];

const STATUS_SELECT_CLASS: Record<MissingItemStatus, string> = {
  missing: 'border-[var(--color-danger-100)] bg-[var(--color-danger-100)] text-[var(--color-danger-600)]',
  requested: 'border-[var(--color-warning-100)] bg-[var(--color-warning-100)] text-[var(--color-warning-600)]',
  received: 'border-[var(--color-success-100)] bg-[var(--color-success-100)] text-[var(--color-success-600)]',
  waived: 'border-[var(--color-ink-100)] bg-[var(--color-ink-100)] text-[var(--color-ink-600)]',
};

/** Pill-styled status picker — lets the broker set any status directly (e.g. requested by phone, received by fax). */
function ItemStatusSelect({ value, onChange, label }: { value: MissingItemStatus; onChange: (status: MissingItemStatus) => void; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MissingItemStatus)}
      aria-label={`Status for ${label}`}
      className={cn('cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-medium outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]/20', STATUS_SELECT_CLASS[value])}
    >
      {MISSING_ITEM_STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {MISSING_ITEM_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

function AddItemForm({
  accountId,
  quotes,
  onDone,
  addMissingItems,
  recordCarrierRequest,
}: {
  accountId: string;
  quotes: { id: string; name: string }[];
  onDone: () => void;
  addMissingItems: (accountId: string, seeds: { label: string; type: MissingItemType; status?: 'missing' | 'received' }[]) => string[];
  recordCarrierRequest: (accountId: string, quoteId: string, input: { label: string; type: MissingItemType }) => string;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<MissingItemType>('document');
  const [neededBy, setNeededBy] = useState('');
  const [alreadyHave, setAlreadyHave] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    if (neededBy) recordCarrierRequest(accountId, neededBy, { label: label.trim(), type });
    else addMissingItems(accountId, [{ label: label.trim(), type, status: alreadyHave ? 'received' : 'missing' }]);
    setLabel('');
    onDone();
  }

  return (
    <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 sm:grid-cols-[1fr_auto_auto]">
      <div>
        <label className={labelClass}>Item</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} placeholder="e.g. Current MVR — John Smith" autoFocus />
      </div>
      <div>
        <label className={labelClass}>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value as MissingItemType)} className={inputClass}>
          <option value="document">Document</option>
          <option value="information">Information</option>
        </select>
      </div>
      <div>
        <label className={labelClass}>Needed by</label>
        <select value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className={inputClass}>
          <option value="">Submission (general)</option>
          {quotes.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        {!neededBy && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-600)]">
            <input type="checkbox" checked={alreadyHave} onChange={(e) => setAlreadyHave(e.target.checked)} />
            Already received
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" icon={<Plus size={14} />} disabled={!label.trim()}>
            Add
          </Button>
        </div>
      </div>
    </form>
  );
}
