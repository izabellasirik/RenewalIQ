import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Mail, Send, UserPlus } from 'lucide-react';
import { Button, Modal } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { draftClientRequestEmail, mailtoHref } from '../../services/workflow/emailDraft';
import { addBusinessDays } from '../../services/workflow/dates';
import { inputClass, labelClass } from './formStyles';

/**
 * Request one or more missing items from a client contact: pick the contact, edit a drafted email,
 * copy it / open it in the broker's email app, choose a follow-up date, then mark it sent. Nothing
 * is emailed by Renewal IQ itself — "Mark as sent" records that the broker sent it.
 */
export function RequestItemsDialog({ accountId, itemIds, open, onClose }: { accountId: string; itemIds: string[]; open: boolean; onClose: () => void }) {
  const { account, items, quotes, contacts, effectiveDate } = useAccountWorkflow(accountId);
  const markItemsRequested = useAccountsStore((s) => s.markItemsRequested);
  const addContact = useAccountsStore((s) => s.addContact);

  const selectedItems = useMemo(() => items.filter((i) => itemIds.includes(i.id)), [items, itemIds]);
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
    setFollowUpDate(addBusinessDays(new Date(), 3));
    setCopied(false);
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
    });
    setSubject(draft.subject);
    setBody(draft.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contactId, itemIds.join(','), account?.id]);

  if (!account) return null;

  async function copy() {
    const text = `Subject: ${subject}\n\n${body}`;
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

  function markSent() {
    markItemsRequested(accountId, itemIds, { contactId: contactId || undefined, followUpDate: followUpDate || undefined });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={selectedItems.length === 1 ? `Request ${selectedItems[0].label}` : `Request ${selectedItems.length} items`}
      subtitle={account.namedInsured}
      footer={
        <>
          <Button variant="secondary" size="sm" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copy}>
            {copied ? 'Copied' : 'Copy email'}
          </Button>
          <a
            href={mailtoHref(contact?.email, { subject, body })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-ink-200)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-800)] hover:bg-[var(--color-ink-50)]"
          >
            <Mail size={14} />
            Open in email app
          </a>
          <Button size="sm" icon={<Send size={14} />} onClick={markSent} disabled={selectedItems.length === 0}>
            Mark as sent
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className={labelClass}>Requesting</p>
          <ul className="flex flex-wrap gap-1.5">
            {selectedItems.map((i) => (
              <li key={i.id} className="rounded-full bg-[var(--color-ink-100)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-700)]">
                {i.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="req-contact">
              Send to
            </label>
            {contacts.length > 0 ? (
              <select id="req-contact" value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputClass}>
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
          <div>
            <label className={labelClass} htmlFor="req-followup">
              Follow up on
            </label>
            <input id="req-followup" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className={inputClass} />
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
        <p className="text-[11px] text-[var(--color-ink-400)]">Renewal IQ doesn't send email. Copy it or open it in your email app, send it, then click “Mark as sent” to start the follow-up clock.</p>
      </div>
    </Modal>
  );
}
