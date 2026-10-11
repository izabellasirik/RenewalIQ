import { useEffect, useState } from 'react';
import { Ban, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, ExternalLink, FileSearch, Inbox, Loader2, Mail, RefreshCw, Send, Undo2, X } from 'lucide-react';
import type { DocumentRequest, DocumentRequestFile, DocumentRequestItem } from '../../types';
import { isOpenRequest, outstandingRequestItems } from '../../types';
import { REQUEST_PROGRESS, requestProgress } from '../../services/requests/requestStatus';
import { Badge, Button, Card, CardBody, ConfirmDialog, Modal } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { formatShortDate } from '../../services/workflow/dates';
import { downloadRequestFile, requestLink } from '../../services/supabase/documentRequestsRepo';
import { rollbackDocument, type RollbackReport } from '../../services/extraction';
import { DocumentPreviewLink } from './DocumentPreviewLink';
import { DateInput } from './DateInput';
import { FollowUpRequestDialog } from './FollowUpRequestDialog';
import { smallInputClass } from './formStyles';


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
  // What "Wrong document" undid — shown here, since the request itself moves (complete → open).
  const [undone, setUndone] = useState<{ fileName: string; report: RollbackReport | null } | null>(null);

  async function refresh() {
    setChecking(true);
    await loadDocumentRequests([accountId]);
    await syncRequestUploads(accountId);
    // Again: another tab or teammate may have checked some of the files meanwhile.
    await loadDocumentRequests([accountId]);
    setChecking(false);
  }

  // Opening the account picks up anything the client uploaded since — once the broker is known
  // (a page opened straight from a link mounts before sign-in has finished loading).
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  useEffect(() => {
    if (currentUserId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, currentUserId]);

  const needsAttention = (r: DocumentRequest) => isOpenRequest(r) || r.files.some((f) => f.matchStatus === 'needs_review' || f.matchStatus === 'pending');
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
        {undone && (
          <div className="mt-3 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] px-3 py-2 text-sm text-[var(--color-ink-700)]" role="status" data-testid="wrong-document-result">
            <div className="flex items-start justify-between gap-2">
              <p>
                Removed <span className="font-medium">{undone.fileName}</span> and asked for it again.{' '}
                {undone.report && rollbackSummary(undone.report).length ? `${rollbackSummary(undone.report).join(', ')} that came only from it ${rollbackSummary(undone.report).length === 1 && !/s$/.test(rollbackSummary(undone.report)[0]) ? 'was' : 'were'} removed.` : 'No Risk Profile data came only from it.'}
                {undone.report?.flagged.length ? ` ${undone.report.flagged.length} item${undone.report.flagged.length === 1 ? '' : 's'} you edited or confirmed ${undone.report.flagged.length === 1 ? 'was' : 'were'} kept for review (below).` : ''}
              </p>
              <button onClick={() => setUndone(null)} className="shrink-0 text-[var(--color-ink-400)] hover:text-[var(--color-ink-700)] cursor-pointer" aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-col gap-3">
          {open.map((r) => (
            <RequestBlock key={r.id} accountId={accountId} request={r} onUndone={setUndone} />
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
                  <RequestBlock key={r.id} accountId={accountId} request={r} onUndone={setUndone} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

type OnUndone = (v: { fileName: string; report: RollbackReport | null }) => void;

function RequestBlock({ accountId, request: r, onUndone }: { accountId: string; request: DocumentRequest; onUndone: OnUndone }) {
  const { documents } = useAccountWorkflow(accountId);
  const cancelClientRequest = useAccountsStore((s) => s.cancelClientRequest);
  const rescheduleClientRequest = useAccountsStore((s) => s.rescheduleClientRequest);
  const markClientRequestSent = useAccountsStore((s) => s.markClientRequestSent);
  const [followingUp, setFollowingUp] = useState(false);
  const progress = requestProgress(r);
  const prepared = r.deliveryStatus === 'prepared';
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
            <Badge tone={REQUEST_PROGRESS[progress].tone} data-testid="request-progress" data-progress={progress}>
              {REQUEST_PROGRESS[progress].label}
            </Badge>
            {openNow && (
              <span data-testid="request-remaining">
                {outstanding.length} item{outstanding.length === 1 ? '' : 's'} remaining
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
            {r.contactName ? `To ${r.contactName} · ` : ''}
            {prepared ? `Prepared ${formatShortDate(r.requestedAt)} — not marked sent` : r.deliveryStatus === 'sent' ? `Sent ${formatShortDate(r.sentAt ?? r.requestedAt)}` : `Requested ${formatShortDate(r.requestedAt)} (sending unconfirmed)`}
            {r.followUpCount > 0 && ` · Followed up ${r.followUpCount}× (last ${formatShortDate(r.lastFollowUpAt)})`}
            {r.closedAt && ` · ${r.status === 'complete' ? 'Completed' : 'Closed'} ${formatShortDate(r.closedAt)}`}
          </p>
        </div>
        {openNow && (
          <div className="flex flex-wrap items-center gap-1.5">
            {prepared && (
              <Button size="sm" icon={<Send size={13} />} onClick={() => void markClientRequestSent(r.id).then((res) => !res.ok && setError(res.message ?? 'Could not record it.'))}>
                Mark as sent
              </Button>
            )}
            {r.deliveryStatus === 'unconfirmed' && (
              <Button size="sm" variant="secondary" icon={<Check size={13} />} title="Record that this request really was sent" onClick={() => void markClientRequestSent(r.id, { sentOn: r.requestedAt.slice(0, 10) }).then((res) => !res.ok && setError(res.message ?? 'Could not record it.'))}>
                Confirm sent
              </Button>
            )}
            {outstanding.length > 0 && !prepared && (
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
          <RequestItemRow key={i.id} request={r} item={i} files={r.files.filter((f) => f.requestItemId === i.id)} documents={documents} onUndone={onUndone} />
        ))}
      </ul>
      {/* Sent with "Upload multiple documents" and not placed on an item yet. */}
      {r.files.some((f) => !f.requestItemId && (f.matchStatus === 'pending' || f.matchStatus === 'needs_review')) && (
        <div className="mt-1.5 rounded-md bg-[var(--color-ink-50)]/60 px-2.5 py-1.5 text-sm" data-testid="unassigned-uploads">
          <p className="text-xs font-medium text-[var(--color-ink-600)]">Uploaded without choosing an item</p>
          {r.files
            .filter((f) => !f.requestItemId && f.matchStatus === 'pending')
            .map((f) => (
              <p key={f.id} className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-ink-500)]">
                <Loader2 size={12} className="animate-spin" /> {f.fileName} — checking which item it is
              </p>
            ))}
          {r.files
            .filter((f) => !f.requestItemId && f.matchStatus === 'needs_review')
            .map((f) => (
              <ReviewRow key={f.id} request={r} file={f} doc={documents.find((d) => d.id === f.importedDocumentId)} />
            ))}
        </div>
      )}

      {openNow && outstanding.length > 0 && !prepared && (
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

function RequestItemRow({
  request,
  item,
  files,
  documents,
  onUndone,
}: {
  request: DocumentRequest;
  item: DocumentRequestItem;
  files: DocumentRequestFile[];
  documents: import('../../types').UploadedDocument[];
  onUndone: OnUndone;
}) {
  const review = files.filter((f) => f.matchStatus === 'needs_review');
  const pendingImport = files.some((f) => f.matchStatus === 'pending');
  // The client files accepted for this item (its own, or one moved here from another item).
  const accepted = request.files.filter((f) => f.importedDocumentId && ((f.matchStatus === 'satisfied' && (f.resolvedItemId ?? f.requestItemId) === item.id) || (f.matchStatus === 'reassigned' && f.resolvedItemId === item.id)));
  const [wrong, setWrong] = useState<DocumentRequestFile | null>(null);
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
      {item.status === 'satisfied' &&
        accepted.map((f) => {
          const doc = documents.find((d) => d.id === f.importedDocumentId);
          return (
            <div key={f.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-600)]" data-testid="accepted-file">
              {doc ? <DocumentPreviewLink doc={doc} /> : <span>{f.fileName}</span>}
              <button onClick={() => setWrong(f)} className="inline-flex items-center gap-1 font-medium text-[var(--color-danger-600)] hover:underline cursor-pointer">
                <Undo2 size={12} /> Wrong document
              </button>
            </div>
          );
        })}
      {review.map((f) => (
        <ReviewRow key={f.id} request={request} item={item} file={f} doc={documents.find((d) => d.id === f.importedDocumentId)} />
      ))}
      {wrong && <WrongDocumentDialog request={request} item={item} file={wrong} onClose={() => setWrong(null)} onUndone={onUndone} />}
    </li>
  );
}

/**
 * An accepted upload turns out to be the wrong document. Shows exactly what will be undone before
 * doing it: only data that came from this file alone goes; anything the broker typed, and anything
 * another document also shows, stays; anything the broker edited or confirmed is kept and flagged.
 */
function WrongDocumentDialog({ request, item, file, onClose, onUndone }: { request: DocumentRequest; item: DocumentRequestItem; file: DocumentRequestFile; onClose: () => void; onUndone: OnUndone }) {
  const markWrong = useAccountsStore((s) => s.markRequestUploadWrong);
  const profile = useAccountsStore((s) => s.riskProfiles[request.accountId]);
  const lossRuns = useAccountsStore((s) => s.accounts.find((a) => a.id === request.accountId)?.lossRuns);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const impact = profile && file.importedDocumentId ? rollbackDocument(profile, lossRuns ?? [], file.importedDocumentId, file.fileName).report : null;

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await markWrong(request.id, file.id, reason.trim() || undefined);
    setBusy(false);
    if (!res.ok) return setError(res.message ?? 'Could not undo it.');
    onUndone({ fileName: file.fileName, report: res.report ?? null });
    onClose();
  }

  const shown = impact;
  const removedParts = shown ? rollbackSummary(shown) : [];

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Wrong document for ${item.label}?`}
      subtitle={file.fileName}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => void confirm()} disabled={busy} icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}>
            Remove it and ask again
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-[var(--color-ink-700)]" data-testid="wrong-document">
        {(
          <p>
            The file comes out of the account and {item.label} is asked for again on the same link. {request.contactName ?? 'The client'} can upload the right one; nothing else on the checklist changes.
          </p>
        )}
        <div className="rounded-lg bg-[var(--color-ink-50)] px-3 py-2">
          <p className="font-medium text-[var(--color-ink-800)]">What will be undone</p>
          <p className="mt-0.5" data-testid="rollback-removed">
            {removedParts.length ? `${removedParts.join(', ')} that came only from this file.` : 'No Risk Profile data came only from this file.'}
          </p>
          {!!shown?.keptBySupport && <p className="mt-0.5 text-[var(--color-ink-500)]">{shown.keptBySupport} also shown by another document — kept.</p>}
          <p className="mt-0.5 text-[var(--color-ink-500)]">Anything you typed yourself stays.</p>
        </div>
        {!!shown?.flagged.length && (
          <div className="rounded-lg border border-[var(--color-warning-100)] px-3 py-2" data-testid="rollback-flagged">
            <p className="font-medium text-[var(--color-warning-700)]">Kept for you to review ({shown.flagged.length})</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-[var(--color-ink-600)]">
              {shown.flagged.map((f, i) => (
                <li key={i}>
                  {f.label} — {f.reason}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-[var(--color-ink-500)]">They stay, listed under “Check items from a removed document” on the Risk Profile and Checklist, until you keep or remove each one.</p>
          </div>
        )}
        {(
          <label className="text-xs text-[var(--color-ink-600)]">
            What was wrong? (optional, kept with the upload record)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={`${smallInputClass} mt-1 w-full`} placeholder="e.g. last year’s report" />
          </label>
        )}
        {error && <p className="text-[var(--color-danger-600)]">{error}</p>}
      </div>
    </Modal>
  );
}

function rollbackSummary(r: RollbackReport): string[] {
  const n = (count: number, one: string, many: string) => (count > 0 ? `${count} ${count === 1 ? one : many}` : null);
  return [
    n(r.removed.fields, 'value', 'values'),
    n(r.removed.drivers, 'driver', 'drivers'),
    n(r.removed.vehicles, 'vehicle', 'vehicles'),
    n(r.removed.losses, 'claim', 'claims'),
    n(r.removed.lossRuns, 'loss-run record', 'loss-run records'),
    n(r.removed.coverageLines, 'coverage line', 'coverage lines'),
  ].filter((x): x is string => !!x);
}

/** An upload that couldn't be confirmed automatically: the broker decides, nothing is guessed. */
/** `item` absent: a file sent with "Upload multiple documents" that couldn't be placed automatically. */
function ReviewRow({ request, item, file, doc }: { request: DocumentRequest; item?: DocumentRequestItem; file: DocumentRequestFile; doc?: import('../../types').UploadedDocument }) {
  const resolve = useAccountsStore((s) => s.resolveRequestUpload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = request.items.filter((i) => i.id !== item?.id && i.status !== 'waived');

  // A held file isn't an account document: open the client's original straight from storage.
  async function openHeldFile() {
    const tab = window.open('', '_blank');
    const res = await downloadRequestFile(file);
    if (!res.ok) {
      tab?.close();
      return setError(`Couldn't open it: ${res.message}`);
    }
    const url = URL.createObjectURL(res.data);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

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
        {doc ? (
          <DocumentPreviewLink doc={doc} />
        ) : (
          <button onClick={() => void openHeldFile()} className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer" title="Open the client's file">
            <ExternalLink size={12} /> {file.fileName}
          </button>
        )}
        {file.matchNote && <span className="text-[var(--color-ink-500)]">— {file.matchNote}</span>}
      </div>
      {!doc && <p className="mt-0.5 text-[var(--color-ink-500)]">Not added to the account yet — it’s only added (and read into the Risk Profile) if you confirm it.</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {item && (
          <Button size="sm" disabled={busy} onClick={() => void act('satisfy')}>
            Yes, it’s the {item.label}
          </Button>
        )}
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
