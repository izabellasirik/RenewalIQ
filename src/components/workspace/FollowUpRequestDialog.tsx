import { useEffect, useState } from 'react';
import { Check, Copy, Mail, Send } from 'lucide-react';
import type { DocumentRequest } from '../../types';
import { outstandingRequestItems } from '../../types';
import { Button, Modal } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { draftRequestFollowUpEmail, mailtoHref } from '../../services/workflow/emailDraft';
import { addBusinessDays, formatShortDate } from '../../services/workflow/dates';
import { requestLink } from '../../services/supabase/documentRequestsRepo';
import { inputClass, labelClass } from './formStyles';

/**
 * Following up on a client request: the message lists ONLY what's still outstanding (never what
 * already came in) with the same secure link. Nothing is sent by Renewal IQ — the broker sends it,
 * then records the follow-up and picks the next date.
 */
export function FollowUpRequestDialog({ accountId, request, onClose }: { accountId: string; request: DocumentRequest; onClose: () => void }) {
  const { account } = useAccountWorkflow(accountId);
  const followUpClientRequest = useAccountsStore((s) => s.followUpClientRequest);
  const outstanding = outstandingRequestItems(request);
  const received = request.items.filter((i) => i.status !== 'requested' && i.status !== 'waived').length;
  const link = requestLink(request.token);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [next, setNext] = useState(() => addBusinessDays(new Date(), 3));
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    const d = draftRequestFollowUpEmail({ account, contactName: request.contactName, outstanding, received, uploadLink: link, brokerName: account.assignedBroker?.name });
    setSubject(d.subject);
    setBody(d.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, request.id, outstanding.map((i) => i.id).join(',')]);

  if (!account) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function markSent() {
    setBusy(true);
    setError(null);
    const res = await followUpClientRequest(request.id, next);
    setBusy(false);
    if (!res.ok) return setError(res.message ?? 'Could not record the follow-up.');
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Follow up: ${outstanding.length} item${outstanding.length === 1 ? '' : 's'} still needed`}
      subtitle={`${account.namedInsured}${request.contactName ? ` · ${request.contactName}` : ''} · Requested ${formatShortDate(request.requestedAt)}`}
      footer={
        <>
          <Button variant="secondary" size="sm" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy email'}
          </Button>
          <a
            href={mailtoHref(request.contactEmail, { subject, body })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-ink-200)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-800)] hover:bg-[var(--color-ink-50)]"
          >
            <Mail size={14} />
            Open in email app
          </a>
          <Button size="sm" icon={<Send size={14} />} onClick={() => void markSent()} disabled={busy}>
            Mark follow-up sent
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <p className={labelClass}>Still outstanding</p>
          <ul className="flex flex-wrap gap-1.5" data-testid="follow-up-items">
            {outstanding.map((i) => (
              <li key={i.id} className="rounded-full border border-[var(--color-ink-200)] px-2.5 py-1 text-xs text-[var(--color-ink-700)]">
                {i.label}
              </li>
            ))}
          </ul>
          {received > 0 && <p className="mt-1 text-xs text-[var(--color-ink-500)]">{received} already received — not asked for again.</p>}
        </div>
        <div className="w-48">
          <label className={labelClass} htmlFor="fu-next">
            Next follow-up
          </label>
          <input id="fu-next" type="date" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="fu-subject">
            Subject
          </label>
          <input id="fu-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="fu-body">
            Email
          </label>
          <textarea id="fu-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} className={`${inputClass} font-[inherit] leading-relaxed`} />
        </div>
        {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
      </div>
    </Modal>
  );
}
