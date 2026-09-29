import { useCallback, useEffect, useRef, useState } from 'react';
import { expandToken } from '../services/publicLinks';
import { useParams } from 'react-router-dom';
import { CircleCheck, Clock, Files, Loader2, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { Button } from '../components/ui';
import { BrandLogo } from '../components/branding/Logo';
import { fetchPublicRequest, uploadRequestFile, withdrawRequestFile, submitDocumentRequest, type PublicRequestItem, type PublicRequestView } from '../services/supabase/documentRequestsRepo';
import { errorMessage } from '../services/intake/retry';
import { cn } from '../utils/cn';
import { itemState, requestProgress, type ItemState } from '../services/requests/clientProgress';

/**
 * The client's side of a document request (0030): exactly the items this link asks for, nothing
 * else about the account. A file shows as received only once the server has verified it's in
 * storage and linked it to the item — until then it's "Uploading…", and a failure says so plainly.
 */

/** A file the client picked for an item, until the server confirms it. The key stays the same on retry. */
interface Pending {
  key: string;
  file: File;
  state: 'uploading' | 'retrying' | 'failed';
  message?: string;
}

const newFileKey = () => crypto.randomUUID().replace(/-/g, '');
/** Pending uploads from "Upload multiple documents" are kept under this key. */
const MULTI = '__multi';
/** The same file picked twice (in one batch, or again later in this visit) is only sent once. */
const fileSignature = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;



/** The agency the client is dealing with comes first; Renewal IQ stays as a quiet "powered by". */
function Shell({ children, agencyName }: { children: React.ReactNode; agencyName?: string | null }) {
  return (
    <div className="min-h-screen bg-[var(--color-ink-50)] px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
        {agencyName ? (
          <div className="mb-2" data-testid="agency-header">
            <p className="text-xl font-semibold leading-tight text-[var(--color-ink-900)] [overflow-wrap:anywhere]">{agencyName}</p>
            <p className="mt-0.5 text-sm text-[var(--color-ink-500)]">Secure document request</p>
          </div>
        ) : (
          <div className="mb-2 flex items-center gap-2.5">
            <BrandLogo size={36} />
          </div>
        )}
        {children}
        {agencyName && (
          <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-[var(--color-ink-400)]" data-testid="powered-by">
            Powered by <BrandLogo size={16} />
          </div>
        )}
      </div>
    </div>
  );
}

function Notice({ title, children, agencyName }: { title: string; children?: React.ReactNode; agencyName?: string | null }) {
  return (
    <Shell agencyName={agencyName}>
      <div className="rounded-2xl border border-[var(--color-ink-100)] bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-[var(--color-ink-900)]">{title}</h1>
        {children && <div className="mt-2 text-sm text-[var(--color-ink-600)]">{children}</div>}
      </div>
    </Shell>
  );
}

export function ClientRequestPage() {
  // The short form in links (/r/<32 characters>) and the original (/request/<uuid>) both work.
  const token = expandToken(useParams().token ?? '');
  const [view, setView] = useState<PublicRequestView | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, Pending[]>>({});
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    void fetchPublicRequest(token).then((r) => {
      if (!alive) return;
      if (r.ok) setView(r.data);
      else setLoadError(r.message);
    });
    return () => {
      alive = false;
    };
  }, [token]);

  const uploading = Object.values(pending).some((list) => list.some((p) => p.state !== 'failed'));
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  const patch = (itemId: string, key: string, change: Partial<Pending> | null) =>
    setPending((all) => {
      const list = all[itemId] ?? [];
      const next = change === null ? list.filter((p) => p.key !== key) : list.map((p) => (p.key === key ? { ...p, ...change } : p));
      return { ...all, [itemId]: next };
    });

  /** `slot`: the item id, or MULTI for "Upload multiple documents" (the agent's check places those). */
  const send = useCallback(
    async (slot: string, p: Pending) => {
      const itemId = slot;
      if (!view || inFlight.current.has(p.key)) return; // a double click never uploads twice
      inFlight.current.add(p.key);
      patch(itemId, p.key, { state: 'uploading', message: undefined });
      try {
        const updated = await uploadRequestFile(token, view.folder, itemId === MULTI ? null : itemId, p.key, p.file, (attempt) =>
          patch(itemId, p.key, { state: 'retrying', message: `Connection problem — retrying (attempt ${attempt + 1})…` })
        );
        // Confirmed by the server: it's in storage and linked to this item.
        setView(updated);
        patch(itemId, p.key, null);
      } catch (err) {
        patch(itemId, p.key, { state: 'failed', message: errorMessage(err) });
      } finally {
        inFlight.current.delete(p.key);
      }
    },
    [token, view]
  );

  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  /** Takes back a file the agent hasn't accepted yet. True once the server has removed it. */
  async function withdraw(fileKey: string): Promise<boolean> {
    setFileErrors(({ [fileKey]: _e, ...rest }) => rest);
    const res = await withdrawRequestFile(token, fileKey);
    if (!res.ok) {
      setFileErrors((e) => ({ ...e, [fileKey]: res.message }));
      return false;
    }
    setView(res.data);
    return true;
  }

  /** Replace: the old file comes out first (server-confirmed), then the new one uploads. */
  async function replace(itemId: string, fileKey: string, files: FileList | null) {
    if (!files?.length) return;
    const picked = Array.from(files);
    if (await withdraw(fileKey)) choose(itemId, picked);
  }

  const sentSignatures = useRef(new Set<string>());
  const [skipped, setSkipped] = useState<string | null>(null);
  function choose(itemId: string, files: FileList | File[] | null) {
    if (!files?.length) return;
    // Never the same file twice: picked twice in one go, or already sent during this visit.
    const fresh: File[] = [];
    const dupes: string[] = [];
    for (const f of Array.from(files)) {
      const sig = fileSignature(f);
      if (sentSignatures.current.has(sig)) dupes.push(f.name);
      else {
        sentSignatures.current.add(sig);
        fresh.push(f);
      }
    }
    setSkipped(dupes.length ? `Already uploaded, not sent again: ${dupes.join(', ')}` : null);
    if (!fresh.length) return;
    const added = fresh.map((file): Pending => ({ key: newFileKey(), file, state: 'uploading' }));
    setPending((all) => ({ ...all, [itemId]: [...(all[itemId] ?? []), ...added] }));
    // One at a time keeps it simple on slow connections.
    void (async () => {
      for (const p of added) await send(itemId, p);
    })();
  }

  if (view === undefined && !loadError)
    return (
      <Shell>
        <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-ink-500)]">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      </Shell>
    );
  if (loadError)
    return (
      <Notice title="We couldn’t load this page">
        <p>{loadError}</p>
        <Button className="mt-4" size="sm" variant="secondary" icon={<RotateCcw size={14} />} onClick={() => window.location.reload()}>
          Try again
        </Button>
      </Notice>
    );
  if (!view) return <Notice title="This link isn’t valid">Please check the link in the email, or contact your insurance agent for a new one.</Notice>;
  if (view.status === 'cancelled') return <Notice title="This request is no longer active" agencyName={view.agencyName}>Your insurance agent closed this request. If you still have questions, please contact them directly.</Notice>;
  if (view.status === 'expired') return <Notice title="This link has expired" agencyName={view.agencyName}>Please contact your insurance agent for a new link.</Notice>;

  const progress = requestProgress(view.items);
  const done = view.status === 'complete' || (progress.total > 0 && progress.remaining === 0);
  const closed = view.status === 'complete';
  const unassigned = view.unassigned ?? [];
  const multiPending = pending[MULTI] ?? [];

  return (
    <Shell agencyName={view.agencyName}>
      <div className="rounded-2xl border border-[var(--color-ink-100)] bg-white p-5 shadow-sm sm:p-6">
        {view.contactFirstName && <p className="text-sm text-[var(--color-ink-500)]">Hi {view.contactFirstName},</p>}
        <h1 className="text-lg font-semibold text-[var(--color-ink-900)] [overflow-wrap:anywhere]">Documents needed for {view.accountName}</h1>
        {done ? (
          <p className="mt-1 text-sm font-medium text-[var(--color-success-600)]" data-testid="remaining">
            Everything has been received — thank you!
          </p>
        ) : (
          <div className="mt-2">
            <p className="text-sm font-medium text-[var(--color-ink-700)]" data-testid="remaining">
              {progress.received} of {progress.total} received · {progress.remaining} remaining
              {progress.reviewing > 0 && <span className="font-normal text-[var(--color-ink-500)]"> ({progress.reviewing} being reviewed)</span>}
            </p>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-ink-100)]" aria-hidden>
              <div className="h-full rounded-full bg-[var(--color-success-500)] transition-all" style={{ width: `${progress.total ? (progress.received / progress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        <ul className="mt-5 flex flex-col gap-3">
          {view.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              pending={pending[item.id] ?? []}
              closed={closed}
              fileErrors={fileErrors}
              onChoose={(f) => choose(item.id, f)}
              onRetry={(p) => void send(item.id, p)}
              onRemove={(p) => patch(item.id, p.key, null)}
              onWithdraw={(key) => void withdraw(key)}
              onReplace={(key, f) => void replace(item.id, key, f)}
            />
          ))}
        </ul>
        {!closed && (
          <MultiUpload
            pending={multiPending}
            unassigned={unassigned}
            fileErrors={fileErrors}
            onChoose={(f) => choose(MULTI, f)}
            onRetry={(p) => void send(MULTI, p)}
            onRemove={(p) => patch(MULTI, p.key, null)}
            onWithdraw={(key) => void withdraw(key)}
            onReplace={(key, f) => void replace(MULTI, key, f)}
          />
        )}
        {skipped && <p className="mt-2 text-xs text-[var(--color-ink-500)] [overflow-wrap:anywhere]">{skipped}</p>}
        {!closed && <SubmitSection view={view} uploading={uploading} onSubmitted={setView} token={token} />}
      </div>
    </Shell>
  );
}

/** A small boxed button (Replace, Remove, Retry…) — easy to see and to tap. */
const boxButton = 'inline-flex min-h-8 items-center rounded-md border border-[var(--color-ink-200)] bg-white px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-ink-50)] cursor-pointer';

/** One uploaded file: its state in words, and Replace / Remove while your agent hasn't accepted it. */
function UploadedFile({
  file,
  reviewText,
  closed,
  error,
  onWithdraw,
  onReplace,
}: {
  file: PublicRequestItem['files'][number];
  reviewText: string;
  closed: boolean;
  error?: string;
  onWithdraw: (fileKey: string) => void;
  onReplace: (fileKey: string) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const accepted = file.state === 'accepted';
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1.5" data-testid="client-file" data-file-state={file.state ?? 'checking'}>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {accepted ? 'Received' : reviewText}: <span className="font-medium text-[var(--color-ink-800)]">{file.name}</span>
      </span>
      {!accepted && file.removable && file.key && !closed && (
        confirmRemove ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            Remove this file?
            <button className={`${boxButton} text-[var(--color-danger-600)]`} onClick={() => (setConfirmRemove(false), onWithdraw(file.key!))}>
              Yes, remove
            </button>
            <button className={`${boxButton} text-[var(--color-ink-500)]`} onClick={() => setConfirmRemove(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <button className={`${boxButton} text-[var(--color-brand-700)]`} onClick={() => onReplace(file.key!)}>
              Replace
            </button>
            <button className={`${boxButton} text-[var(--color-ink-500)]`} onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          </span>
        )
      )}
      {error && <span className="basis-full text-[var(--color-danger-600)]">{error}</span>}
    </li>
  );
}

/** Files on their way (uploading, retrying, or failed with Retry / Remove). */
function PendingList({ pending, onRetry, onRemove }: { pending: Pending[]; onRetry: (p: Pending) => void; onRemove: (p: Pending) => void }) {
  if (pending.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {pending.map((p) => (
        <li key={p.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" data-testid="client-upload" data-state={p.state}>
          {p.state === 'failed' ? <TriangleAlert size={13} className="shrink-0 text-[var(--color-danger-600)]" /> : <Loader2 size={13} className="shrink-0 animate-spin text-[var(--color-ink-500)]" />}
          <span className="min-w-0 font-medium text-[var(--color-ink-800)] [overflow-wrap:anywhere]">{p.file.name}</span>
          <span className={p.state === 'failed' ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-ink-500)]'}>
            {p.state === 'uploading' ? 'Uploading…' : p.state === 'retrying' ? p.message : `Not uploaded — ${p.message ?? 'something went wrong'}`}
          </span>
          {p.state === 'failed' && (
            <>
              <button className={`${boxButton} text-[var(--color-brand-700)]`} onClick={() => onRetry(p)}>
                Retry
              </button>
              <button className={`${boxButton} text-[var(--color-ink-500)]`} onClick={() => onRemove(p)}>
                Remove
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

type RowHandlers = {
  pending: Pending[];
  fileErrors: Record<string, string>;
  onChoose: (files: FileList | null) => void;
  onRetry: (p: Pending) => void;
  onRemove: (p: Pending) => void;
  /** Take back an uploaded file the agent hasn't accepted yet. */
  onWithdraw: (fileKey: string) => void;
  /** Swap an uploaded file for the right one: pick first, then the old one is removed and the new one sent. */
  onReplace: (fileKey: string, files: FileList | null) => void;
};

/** A hidden picker for "Replace": remembers which file it replaces until one is chosen. */
function useReplacePicker(onReplace: RowHandlers['onReplace']) {
  const ref = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      className="hidden"
      onChange={(e) => {
        if (replacing) onReplace(replacing, e.target.files);
        setReplacing(null);
        e.target.value = '';
      }}
      data-testid="client-replace-input"
    />
  );
  return {
    input,
    open: (fileKey: string) => {
      setReplacing(fileKey);
      ref.current?.click();
    },
  };
}

const STATE_STYLE: Record<ItemState, string> = {
  missing: 'border-[var(--color-ink-100)] bg-white',
  review: 'border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/30',
  received: 'border-[var(--color-success-100)] bg-[var(--color-success-100)]/40',
};

function ItemRow({ item, closed, ...h }: RowHandlers & { item: PublicRequestItem; closed: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const replace = useReplacePicker(h.onReplace);
  const state = itemState(item);
  const busy = h.pending.some((p) => p.state !== 'failed');
  const canUpload = state === 'missing' && !closed;
  const drop = useFileDrop(h.onChoose, canUpload && !busy);
  return (
    <li
      className={cn('rounded-xl border px-4 py-3 transition-colors', STATE_STYLE[state], drop.over && 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)] ring-2 ring-[var(--color-brand-500)]/30')}
      data-testid="client-item"
      data-state={state}
      data-received={state === 'received' ? 'yes' : 'no'}
      {...drop.handlers}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-start gap-2 text-sm font-medium text-[var(--color-ink-900)]">
            {state === 'received' ? (
              <CircleCheck size={16} className="mt-0.5 shrink-0 text-[var(--color-success-600)]" aria-label="Received" />
            ) : state === 'review' ? (
              <Clock size={16} className="mt-0.5 shrink-0 text-[var(--color-warning-600)]" aria-label="Under review" />
            ) : (
              <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-[var(--color-ink-300)]" aria-label="Missing" />
            )}
            <span className="min-w-0 [overflow-wrap:anywhere]">{item.label}</span>
            {state === 'received' && <span className="ml-auto shrink-0 text-xs font-medium text-[var(--color-success-600)]">Received</span>}
          </p>
          {item.instructions && <p className="mt-0.5 pl-6 text-xs text-[var(--color-ink-500)]">{item.instructions}</p>}
          {item.files.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5 pl-6 text-xs text-[var(--color-ink-600)]">
              {item.files.map((f, i) => (
                <UploadedFile
                  key={f.key ?? `${f.name}-${i}`}
                  file={f}
                  reviewText="Uploaded — your agent is reviewing"
                  closed={closed}
                  error={f.key ? h.fileErrors[f.key] : undefined}
                  onWithdraw={h.onWithdraw}
                  onReplace={replace.open}
                />
              ))}
            </ul>
          )}
          {replace.input}
        </div>
        {canUpload && (
          <>
            <input ref={input} type="file" multiple className="hidden" onChange={(e) => (h.onChoose(e.target.files), (e.target.value = ''))} data-testid="client-file-input" />
            <Button icon={<Upload size={15} />} disabled={busy} onClick={() => input.current?.click()} className="min-h-10 w-full sm:w-auto">
              Upload
            </Button>
          </>
        )}
      </div>
      <div className="pl-6">
        <PendingList pending={h.pending} onRetry={h.onRetry} onRemove={h.onRemove} />
      </div>
    </li>
  );
}

/**
 * "Upload multiple documents": several files at once, without choosing items. Each is uploaded and
 * verified like any other; your agent's check places it on the item it clearly is — anything
 * unclear waits for your agent. Nothing counts as received until your agent accepts it.
 */
function MultiUpload({ unassigned, ...h }: RowHandlers & { unassigned: NonNullable<PublicRequestView['unassigned']> }) {
  const input = useRef<HTMLInputElement>(null);
  const replace = useReplacePicker(h.onReplace);
  const drop = useFileDrop(h.onChoose, true);
  return (
    <div
      className={cn('mt-4 rounded-xl border border-dashed px-4 py-3 transition-colors', drop.over ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)]' : 'border-[var(--color-ink-200)]')}
      data-testid="multi-upload"
      {...drop.handlers}
    >
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => (h.onChoose(e.target.files), (e.target.value = ''))} data-testid="multi-file-input" />
      <Button variant="secondary" icon={<Files size={15} />} onClick={() => input.current?.click()} className="min-h-11 w-full">
        Upload multiple documents
      </Button>
      <p className="mt-1.5 text-center text-xs text-[var(--color-ink-400)]">{drop.over ? 'Drop to upload' : 'or drag and drop files here'}</p>
      {unassigned.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5 text-xs text-[var(--color-ink-600)]" data-testid="unassigned-files">
          {unassigned.map((f, i) => (
            <UploadedFile
              key={f.key ?? `${f.name}-${i}`}
              file={f}
              reviewText="Uploaded"
              closed={false}
              error={f.key ? h.fileErrors[f.key] : undefined}
              onWithdraw={h.onWithdraw}
              onReplace={replace.open}
            />
          ))}
        </ul>
      )}
      {replace.input}
      <PendingList pending={h.pending} onRetry={h.onRetry} onRemove={h.onRemove} />
    </div>
  );
}

/**
 * Files dragged onto a box upload the same way as picking them. `over`: a file is being dragged
 * over it (for the highlight). Disabled boxes ignore drops.
 */
function useFileDrop(onFiles: (files: FileList | null) => void, enabled: boolean) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  if (!enabled) return { over: false, handlers: {} };
  return {
    over,
    handlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
      },
    },
  };
}

/** Every file the client has uploaded on this request (on items, or not yet matched). */
function clientFiles(view: PublicRequestView) {
  return [...view.items.flatMap((i) => i.files), ...(view.unassigned ?? [])];
}

/**
 * "Submit": the client is done for now — the agent is told. Files are already uploaded as they're
 * picked; this doesn't change what's received. Enabled once there's something new since the last
 * submit and nothing is still uploading.
 */
function SubmitSection({ view, uploading, token, onSubmitted }: { view: PublicRequestView; uploading: boolean; token: string; onSubmitted: (v: PublicRequestView) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = clientFiles(view);
  const submittedAt = view.submittedAt ?? null;
  const newSince = files.filter((f) => !submittedAt || (f.uploadedAt && f.uploadedAt > submittedAt)).length;
  const canSubmit = files.length > 0 && newSince > 0 && !uploading && !submitting;
  return (
    <div className="mt-5" data-testid="submit-section">
      <Button
        className="min-h-11 w-full"
        disabled={!canSubmit}
        icon={submitting ? <Loader2 size={15} className="animate-spin" /> : undefined}
        onClick={async () => {
          setSubmitting(true);
          setError(null);
          const res = await submitDocumentRequest(token);
          setSubmitting(false);
          if (res.ok) onSubmitted(res.data);
          else setError(res.message);
        }}
        data-testid="submit-request"
      >
        {submittedAt && newSince > 0 ? 'Submit new files' : 'Submit'}
      </Button>
      <p className="mt-1.5 text-center text-xs text-[var(--color-ink-500)]" data-testid="submit-status">
        {error ? (
          <span className="text-[var(--color-danger-600)]">{error}</span>
        ) : uploading ? (
          'Wait for the uploads to finish, then submit.'
        ) : files.length === 0 ? (
          'Upload your documents, then submit.'
        ) : submittedAt && newSince === 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-[var(--color-success-600)]">
            <CircleCheck size={13} /> Submitted — your agent has been notified. You can add more files later.
          </span>
        ) : (
          `${newSince} file${newSince === 1 ? '' : 's'} ready — submit to let your agent know.`
        )}
      </p>
    </div>
  );
}
