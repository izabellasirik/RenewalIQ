import { useEffect, useState } from 'react';
import { Ban, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, FileSearch, Inbox, Loader2, Mail, RefreshCw, X } from 'lucide-react';
import type { DocumentRequest, DocumentRequestFile, DocumentRequestItem } from '../../types';
import { DOCUMENT_REQUEST_STATUS_LABELS, isOpenRequest, outstandingRequestItems } from '../../types';
import { Badge, Button, Card, CardBody, ConfirmDialog, type BadgeTone } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { formatShortDate } from '../../services/workflow/dates';
import { requestLink } from '../../services/supabase/documentRequestsRepo';
import { DocumentPreviewLink } from './DocumentPreviewLink';
import { DateInput } from './DateInput';
import { FollowUpRequestDialog } from './FollowUpRequestDialog';
import { smallInputClass } from './formStyles';

const STATUS_TONE: Record<DocumentRequest['status'], BadgeTone> = { waiting: 'warning', partial: 'info', complete: 'success', cancelled: 'neutral' };

/**
 * Client document requests on this account (0030): what each asked for, what's come in, what
 * still needs review, and when to follow up. `compact` (Overview) shows only open requests and
 * uploads waiting for review; the Checklist tab shows them all.
 */
export function ClientRequestsCard({ accountId, compact = false }: { accountId: string; compact?: boolean }) {
  const { documentRequests } = useAccountWorkflow(accountId);
  const loadDocumentRequests = useAccountsStore((s) => s.loadDocumentRequests);
  const syncRequestUploads = useAccountsStore((s) => s.syncRequestUploads);
  const [checking, setChecking] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  async function refresh() {
    setChecking(true);
    await loadDocumentRequests([accountId]);
    await syncRequestUploads(accountId);
    setChecking(false);
  }

  // Opening the account picks up anything the client uploaded since.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const needsAttention = (r: DocumentRequest) => isOpenRequest(r) || r.files.some((f) => f.matchStatus === 'needs_review' || !f.importedAt);
  const open = documentRequests.filter(needsAttention);
  const closed = documentRequests.filter((r) => !needsAttention(r));
  if (documentRequests.length === 0 || (compact && open.length === 0)) return null;

  return (
    <Card>
      <CardBody className="pt-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
            <Inbox size={16} className="text-[var(--color-ink-500)]" />
            Client requests
          </h3>
          <button onClick={() => void refresh()} disabled={checking} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={checking ? 'animate-spin' : undefined} />
            {checking ? 'Checking for uploads…' : 'Check for uploads'}
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-3">
          {open.map((r) => (
            <RequestBlock key={r.id} accountId={accountId} request={r} />
          ))}
          {open.length === 0 && <p className="text-sm text-[var(--color-ink-400)]">No open requests.</p>}
        </div>
        {!compact && closed.length > 0 && (
          <div className="mt-3">
            <button onClick={() => setShowClosed((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-500)] hover:text-[var(--color-ink-700)] cursor-pointer">
              {showClosed ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {closed.length} completed or cancelled request{closed.length === 1 ? '' : 's'}
            </button>
            {showClosed && (
              <div className="mt-2 flex flex-col gap-3">
                {closed.map((r) => (
                  <RequestBlock key={r.id} accountId={accountId} request={r} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RequestBlock({ accountId, request: r }: { accountId: string; request: DocumentRequest }) {
  const { documents } = useAccountWorkflow(accountId);
  const cancelClientRequest = useAccountsStore((s) => s.cancelClientRequest);
  const rescheduleClientRequest = useAccountsStore((s) => s.rescheduleClientRequest);
  const [followingUp, setFollowingUp] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outstanding = outstandingRequestItems(r);
  const openNow = isOpenRequest(r);
  const active = r.items.filter((i) => i.status !== 'waived');

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(requestLink(r.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', requestLink(r.token));
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] p-3" data-testid="client-request">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
            <Badge tone={STATUS_TONE[r.status]}>{DOCUMENT_REQUEST_STATUS_LABELS[r.status]}</Badge>
            {openNow && (
              <span data-testid="request-remaining">
                {outstanding.length} item{outstanding.length === 1 ? '' : 's'} remaining
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
            {r.contactName ? `To ${r.contactName} · ` : ''}Requested {formatShortDate(r.requestedAt)}
            {r.followUpCount > 0 && ` · Followed up ${r.followUpCount}× (last ${formatShortDate(r.lastFollowUpAt)})`}
            {r.closedAt && ` · ${r.status === 'complete' ? 'Completed' : 'Closed'} ${formatShortDate(r.closedAt)}`}
          </p>
        </div>
        {openNow && (
          <div className="flex flex-wrap items-center gap-1.5">
            {outstanding.length > 0 && (
              <Button size="sm" icon={<Mail size={13} />} onClick={() => setFollowingUp(true)}>
                Follow up
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={() => void copyLink()}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setConfirmCancel(true)} aria-label="Cancel request">
              Cancel
            </Button>
          </div>
        )}
      </div>

      <ul className="mt-2 flex flex-col gap-1.5">
        {active.map((i) => (
          <RequestItemRow key={i.id} request={r} item={i} files={r.files.filter((f) => f.requestItemId === i.id)} documents={documents} />
        ))}
      </ul>

      {openNow && outstanding.length > 0 && (
        <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-600)]">
          Next follow-up
          <DateInput
            value={r.nextFollowUp}
            onCommit={(v) => v && void rescheduleClientRequest(r.id, v).then((res) => !res.ok && setError(res.message ?? 'Could not change the date.'))}
            className={smallInputClass}
            aria-label="Next follow-up for this request"
          />
          {!r.nextFollowUp && <span className="text-[var(--color-warning-700)]">none set</span>}
        </label>
      )}
      {error && <p className="mt-1 text-xs text-[var(--color-danger-600)]">{error}</p>}

      {followingUp && <FollowUpRequestDialog accountId={accountId} request={r} onClose={() => setFollowingUp(false)} />}
      <ConfirmDialog
        open={confirmCancel}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          void cancelClientRequest(r.id).then((res) => !res.ok && setError(res.message ?? 'Could not cancel.'));
        }}
        title="Cancel this request?"
        description="The link stops accepting uploads. Anything already received stays on the account; the checklist items stay as they are."
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
      />
    </div>
  );
}

function RequestItemRow({ request, item, files, documents }: { request: DocumentRequest; item: DocumentRequestItem; files: DocumentRequestFile[]; documents: import('../../types').UploadedDocument[] }) {
  const review = files.filter((f) => f.matchStatus === 'needs_review');
  const pendingImport = files.some((f) => !f.importedAt);
  const state =
    item.status === 'satisfied' ? (
      <span className="inline-flex items-center gap-1 text-[var(--color-success-600)]">
        <CheckCircle2 size={13} /> Received {formatShortDate(item.satisfiedAt)}
      </span>
    ) : item.status === 'needs_review' ? (
      <span className="inline-flex items-center gap-1 font-medium text-[var(--color-warning-700)]">
        <FileSearch size={13} /> Needs review
      </span>
    ) : item.status === 'uploaded' ? (
      <span className="inline-flex items-center gap-1 text-[var(--color-ink-500)]">
        {pendingImport ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Uploaded {formatShortDate(item.uploadedAt)}
        {pendingImport ? ' — checking' : ''}
      </span>
    ) : request.status === 'cancelled' ? (
      <span className="inline-flex items-center gap-1 text-[var(--color-ink-400)]">
        <Ban size={13} /> Not received
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-[var(--color-ink-500)]">
        <Clock size={13} /> Requested {formatShortDate(request.requestedAt)}
      </span>
    );
  return (
    <li className="rounded-md bg-[var(--color-ink-50)]/60 px-2.5 py-1.5 text-sm" data-testid="request-item" data-status={item.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[var(--color-ink-800)]">{item.label}</span>
        <span className="text-xs">{state}</span>
      </div>
      {review.map((f) => (
        <ReviewRow key={f.id} request={request} item={item} file={f} doc={documents.find((d) => d.id === f.importedDocumentId)} />
      ))}
    </li>
  );
}

/** An upload that couldn't be confirmed automatically: the broker decides, nothing is guessed. */
function ReviewRow({ request, item, file, doc }: { request: DocumentRequest; item: DocumentRequestItem; file: DocumentRequestFile; doc?: import('../../types').UploadedDocument }) {
  const resolve = useAccountsStore((s) => s.resolveRequestUpload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = request.items.filter((i) => i.id !== item.id && i.status !== 'waived');

  async function act(action: 'satisfy' | 'reject' | 'reassign', target?: string) {
    setBusy(true);
    setError(null);
    const res = await resolve(request.id, file.id, action, target);
    setBusy(false);
    if (!res.ok) setError(res.message ?? 'Could not save that.');
  }

  return (
    <div className="mt-1.5 rounded-md border border-[var(--color-warning-100)] bg-white px-2.5 py-2 text-xs" data-testid="needs-review">
      <div className="flex flex-wrap items-center gap-2 text-[var(--color-ink-700)]">
        {doc ? <DocumentPreviewLink doc={doc} /> : <span className="font-medium">{file.fileName}</span>}
        {file.matchNote && <span className="text-[var(--color-ink-500)]">— {file.matchNote}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => void act('satisfy')}>
          Yes, it’s the {item.label}
        </Button>
        {others.length > 0 && (
          <select
            disabled={busy}
            value=""
            onChange={(e) => e.target.value && void act('reassign', e.target.value)}
            className="rounded-md border border-[var(--color-ink-200)] bg-white px-2 py-1 text-xs cursor-pointer"
            aria-label={`It's for another item`}
          >
            <option value="">It’s for…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('reject')}>
          Not what we asked for
        </Button>
      </div>
      {error && <p className="mt-1 text-[var(--color-danger-600)]">{error}</p>}
    </div>
  );
}
