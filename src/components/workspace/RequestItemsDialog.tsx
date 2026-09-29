import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Link2, Loader2, Lock, Mail, Send, UserPlus } from 'lucide-react';
import { Button, Modal } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { draftClientRequestEmail, mailtoHref } from '../../services/workflow/emailDraft';
import { addBusinessDays, todayKey } from '../../services/workflow/dates';
import type { MissingItem } from '../../types';
import { inputClass, labelClass } from './formStyles';
import { isSupabaseConfigured } from '../../services/supabase/client';
import { splitDriverMvrs } from '../../services/workflow/driverRequirements';
import { EMPTY_DRIVERS } from '../../utils/emptyArrays';

/** Stands in for the secure link in the draft until it's created (on the first copy / open / send). */
const LINK_PLACEHOLDER = '[secure upload link — added when you copy or send this]';
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * Request one or more missing items from a client contact: pick the contact, edit a drafted email,
 * copy it / open it in the broker's email app, choose a follow-up date, then mark it sent. Nothing
 * is emailed by Renewal IQ itself — "Mark as sent" records that the broker sent it.
 *
 * For a cloud account the email carries a secure upload link (0030) showing the client exactly
 * these items. The request behind it is created once — on the first copy, open or send — and the
 * contact and items are then fixed, so the link always matches what it asks for.
 */
/**
 * `newDocument`: "+ Request document" — the broker names a document that isn't on the checklist yet
 * (e.g. "Updated MVR"); sending adds it to the checklist as Requested, through the same flow.
 */
export function RequestItemsDialog({ accountId, itemIds, open, onClose, newDocument = false }: { accountId: string; itemIds: string[]; open: boolean; onClose: () => void; newDocument?: boolean }) {
  const { account, items, quotes, contacts, effectiveDate } = useAccountWorkflow(accountId);
  const markItemsRequested = useAccountsStore((s) => s.markItemsRequested);
  const createClientRequest = useAccountsStore((s) => s.createClientRequest);
  const canLink = useAccountsStore((s) => isSupabaseConfigured && !!s.currentUserId && !!s.cloudAccountIds[accountId]);
  const clientKey = useRef(newKey());
  // The checklist item "+ Request document" adds (made once, when the link or request needs it).
  const newItemId = useRef<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const addMissingItems = useAccountsStore((s) => s.addMissingItems);
  const updateMissingItem = useAccountsStore((s) => s.updateMissingItem);
  const addContact = useAccountsStore((s) => s.addContact);
  const [docName, setDocName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [requestedOn, setRequestedOn] = useState(todayKey());

  // Every item that can still be requested — the broker ticks which ones go in this one email.
  const candidates = useMemo(() => items.filter((i) => i.status === 'missing' || i.status === 'requested' || itemIds.includes(i.id)), [items, itemIds]);
  const [selectedIds, setSelectedIds] = useState<string[]>(itemIds);
  const draftItem: MissingItem | null = useMemo(
    () =>
      newDocument
        ? { id: 'new', accountId, type: 'document', label: docName.trim() || 'Document', instructions: instructions.trim() || undefined, status: 'missing', createdAt: '', updatedAt: '' }
        : null,
    [newDocument, accountId, docName, instructions]
  );
  const pickedItems = useMemo(() => (draftItem ? [draftItem] : candidates.filter((i) => selectedIds.includes(i.id))), [draftItem, candidates, selectedIds]);
  // "MVRs — all drivers" goes out as one MVR per named driver when the Risk Profile knows them.
  const drivers = useAccountsStore((s) => s.riskProfiles[accountId]?.drivers) ?? EMPTY_DRIVERS;
  const driverSplit = useMemo(() => (draftItem ? { display: pickedItems, splits: [] } : splitDriverMvrs(pickedItems, items, drivers)), [draftItem, pickedItems, items, drivers]);
  const selectedItems = driverSplit.display;
  // The per-driver checklist items, once created/reused for this request (so repeat clicks reuse them).
  const splitIds = useRef<string[] | null>(null);
  const setItemStatus = useAccountsStore((s) => s.setItemStatus);
  const [contactId, setContactId] = useState('');
  const [followUpDate, setFollowUpDate] = useState(() => addBusinessDays(new Date(), 3));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');

  // Reset every time the dialog opens for a (possibly different) set of items.
  useEffect(() => {
    if (!open) return;
    const previous = selectedItems.find((i) => i.requestedFromContactId)?.requestedFromContactId;
    const initial = contacts.find((c) => c.id === previous) ?? contacts.find((c) => c.primary) ?? contacts[0];
    setContactId(initial?.id ?? '');
    setSelectedIds(itemIds);
    setFollowUpDate(addBusinessDays(new Date(), 3));
    setRequestedOn(todayKey());
    setDocName('');
    setInstructions('');
    setCopied(false);
    clientKey.current = newKey();
    newItemId.current = null;
    splitIds.current = null;
    setLink(null);
    setLinkError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemIds.join(',')]);

  const contact = contacts.find((c) => c.id === contactId);

  // Re-draft whenever the recipient or item set changes; the broker can edit freely afterwards.
  useEffect(() => {
    if (!open || !account) return;
    const draft = draftClientRequestEmail({
      account,
      contact,
      items: selectedItems,
      effectiveDate,
      carrierNamesByQuoteId: Object.fromEntries(quotes.map((q) => [q.id, q.marketName])),
      brokerName: account.assignedBroker?.name,
      uploadLink: link ?? (canLink ? LINK_PLACEHOLDER : undefined),
    });
    setSubject(draft.subject);
    setBody(draft.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contactId, selectedIds.join(','), account?.id, draftItem?.label, draftItem?.instructions, canLink]);

  if (!account) return null;
  const locked = !!link;

  /** The checklist items this request is for (adding "+ Request document"'s item first, once). */
  function requestItemIds(): string[] {
    if (!newDocument && driverSplit.splits.length === 0) return selectedItems.map((i) => i.id);
    if (!newDocument) {
      if (!splitIds.current) {
        // One canonical item per driver (an existing one is reused); the generic placeholder is
        // then covered by them, so it's set aside rather than left outstanding.
        const byLabel = new Map<string, string>();
        for (const split of driverSplit.splits) {
          const ids = addMissingItems(
            accountId,
            split.drivers.map((d) => ({ label: d.label, type: 'document' as const, templateKey: d.templateKey }))
          );
          split.drivers.forEach((d, i) => byLabel.set(d.label, ids[i]));
          updateMissingItem(accountId, split.genericId, { notes: 'Requested as one MVR per driver.' });
          setItemStatus(accountId, split.genericId, 'waived');
        }
        splitIds.current = selectedItems.map((i) => byLabel.get(i.label) ?? i.id);
      }
      return splitIds.current;
    }
    if (!newItemId.current) {
      // Same requirement still outstanding on the checklist? That item is requested — no duplicate row.
      // Already received? A newer copy is being asked for, so it gets its own row.
      [newItemId.current] = addMissingItems(accountId, [{ label: docName.trim(), type: 'document', newCopyOfReceived: true }]);
      if (instructions.trim()) updateMissingItem(accountId, newItemId.current, { instructions: instructions.trim() });
    }
    return [newItemId.current];
  }

  /** Creates the secure link once, puts it into the email, and returns the email with it. */
  async function ensureLink(): Promise<{ body: string } | null> {
    if (!canLink) return { body };
    if (link) return { body };
    setLinkBusy(true);
    setLinkError(null);
    const res = await createClientRequest(accountId, { clientKey: clientKey.current, itemIds: requestItemIds(), contactId: contactId || undefined, followUpDate: followUpDate || undefined, requestedOn });
    setLinkBusy(false);
    if (!res.ok) {
      setLinkError(res.message);
      return null;
    }
    const withLink = body.includes(LINK_PLACEHOLDER) ? body.replace(LINK_PLACEHOLDER, res.link) : `${body}\n\nUpload securely here:\n${res.link}`;
    setLink(res.link);
    setBody(withLink);
    return { body: withLink };
  }

  async function openEmail() {
    const ready = await ensureLink();
    if (ready) window.location.href = mailtoHref(contact?.email, { subject, body: ready.body });
  }

  async function copy() {
    const ready = await ensureLink();
    if (!ready) return;
    const text = `Subject: ${subject}\n\n${ready.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function addInlineContact() {
    if (!newContactName.trim()) return;
    const id = addContact(accountId, { name: newContactName.trim(), email: newContactEmail.trim() || undefined });
    setContactId(id);
    setNewContactName('');
    setNewContactEmail('');
  }

  async function markSent() {
    if (newDocument && !docName.trim()) return;
    if (!(await ensureLink())) return; // no link, no "sent" — the error says why
    const opts = { contactId: contactId || undefined, followUpDate: followUpDate || undefined, requestedOn };
    markItemsRequested(accountId, requestItemIds(), newDocument ? { ...opts, instructions } : opts);
    onClose();
  }

  async function copyLinkOnly() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt('Copy this link:', link);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={newDocument ? 'Request a document' : selectedItems.length === 1 ? `Request ${selectedItems[0].label}` : `Request ${selectedItems.length} items in one email`}
      subtitle={account.namedInsured}
      footer={
        <>
          <Button variant="secondary" size="sm" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()} disabled={linkBusy}>
            {copied ? 'Copied' : 'Copy email'}
          </Button>
          <Button variant="secondary" size="sm" icon={<Mail size={14} />} onClick={() => void openEmail()} disabled={linkBusy}>
            Open in email app
          </Button>
          <Button size="sm" icon={linkBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} onClick={() => void markSent()} disabled={linkBusy || (newDocument ? !docName.trim() : selectedItems.length === 0)}>
            {newDocument ? 'Add to checklist as requested' : 'Mark as sent'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {newDocument && (
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className={labelClass} htmlFor="req-doc-name">
                Document
              </label>
              <input id="req-doc-name" value={docName} onChange={(e) => setDocName(e.target.value)} className={inputClass} placeholder="e.g. Updated MVR" autoFocus />
            </div>
            <div>
              <label className={labelClass} htmlFor="req-doc-instructions">
                Note / instructions for the client (optional)
              </label>
              <input id="req-doc-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} className={inputClass} placeholder="e.g. for John Smith, dated within the last 14 days" />
            </div>
          </div>
        )}
        <div className={newDocument ? 'hidden' : undefined}>
          <div className="flex items-center justify-between">
            <p className={labelClass}>
              Requesting {pickedItems.length} of {candidates.length} — all in one email
            </p>
            {candidates.length > 1 && !locked && (
              <button
                type="button"
                onClick={() => setSelectedIds(pickedItems.length === candidates.length ? [] : candidates.map((i) => i.id))}
                className="text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer"
              >
                {pickedItems.length === candidates.length ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {candidates.map((i) => {
              const on = selectedIds.includes(i.id);
              return (
                <li key={i.id}>
                  <label
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${on ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-800)]/8 text-[var(--color-brand-800)]' : 'border-[var(--color-ink-200)] text-[var(--color-ink-500)]'}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={locked}
                      onChange={() => setSelectedIds((cur) => (on ? cur.filter((x) => x !== i.id) : [...cur, i.id]))}
                      className="h-3 w-3"
                      aria-label={`Include ${i.label}`}
                    />
                    {i.label}
                    {i.status === 'requested' && <span className="font-normal text-[var(--color-ink-400)]">(again)</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          {driverSplit.splits.some((sp) => sp.drivers.length > 0) && (
            <p className="mt-1.5 text-xs text-[var(--color-ink-500)]" data-testid="driver-split-note">
              MVRs will be requested one per driver: {driverSplit.splits.flatMap((sp) => sp.drivers.map((d) => d.label.replace(/^MVR — /, ''))).join(', ')}.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="req-contact">
              Send to
            </label>
            {contacts.length > 0 ? (
              <select id="req-contact" value={contactId} disabled={locked} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.role ? ` — ${c.role}` : ''}
                    {c.email ? ` <${c.email}>` : ''}
                  </option>
                ))}
                <option value="">No specific contact</option>
              </select>
            ) : (
              <p className="rounded-lg bg-[var(--color-ink-50)] px-3 py-2 text-xs text-[var(--color-ink-500)]">No contacts on this account yet — add one below.</p>
            )}
            {contact && !contact.email && <p className="mt-1 text-[11px] text-[var(--color-warning-600)]">No email on file for {contact.name}.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="req-requested-on">
              Requested on
            </label>
            <input id="req-requested-on" type="date" value={requestedOn} max={todayKey()} onChange={(e) => setRequestedOn(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="req-followup">
              Follow up on
            </label>
            <input id="req-followup" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className={inputClass} />
          </div>
          </div>
        </div>

        {contacts.length === 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className={labelClass}>Contact name</label>
              <input value={newContactName} onChange={(e) => setNewContactName(e.target.value)} className={inputClass} placeholder="John Smith" />
            </div>
            <div className="flex-1">
              <label className={labelClass}>Email</label>
              <input value={newContactEmail} onChange={(e) => setNewContactEmail(e.target.value)} className={inputClass} placeholder="john@abctrucking.com" />
            </div>
            <Button variant="secondary" size="sm" icon={<UserPlus size={14} />} onClick={addInlineContact} disabled={!newContactName.trim()}>
              Add
            </Button>
          </div>
        )}

        <div>
          <label className={labelClass} htmlFor="req-subject">
            Subject
          </label>
          <input id="req-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="req-body">
            Email
          </label>
          <textarea id="req-body" value={body} onChange={(e) => setBody(e.target.value)} rows={11} className={`${inputClass} font-[inherit] leading-relaxed`} />
        </div>
        {canLink && (
          <div className="rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] px-3 py-2 text-xs text-[var(--color-ink-600)]">
            {link ? (
              <div className="flex flex-wrap items-center gap-2">
                <Link2 size={13} className="shrink-0 text-[var(--color-brand-700)]" />
                <span className="min-w-0 flex-1 truncate font-mono" data-testid="request-link">
                  {link}
                </span>
                <button type="button" onClick={() => void copyLinkOnly()} className="font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
                  Copy link
                </button>
                <span className="inline-flex w-full items-center gap-1 text-[11px] text-[var(--color-ink-400)]">
                  <Lock size={11} /> This link shows the client only these items for {account.namedInsured}, and what's still needed.
                </span>
              </div>
            ) : (
              <p className="flex items-center gap-1.5">
                <Link2 size={13} className="text-[var(--color-brand-700)]" />
                A secure upload link for exactly these items is added when you copy, open or send this.
              </p>
            )}
            {linkError && <p className="mt-1 text-[var(--color-danger-600)]">Couldn’t create the link: {linkError}</p>}
          </div>
        )}
        <p className="text-[11px] text-[var(--color-ink-400)]">RenewalIQ doesn't send email. Copy it or open it in your email app, send it, then click “Mark as sent” to start the follow-up clock.</p>
      </div>
    </Modal>
  );
}
