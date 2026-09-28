import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CircleCheck, Loader2, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { Button } from '../components/ui';
import { BrandLogo } from '../components/branding/Logo';
import { fetchPublicRequest, uploadRequestFile, type PublicRequestItem, type PublicRequestView } from '../services/supabase/documentRequestsRepo';
import { errorMessage } from '../services/intake/retry';
import { cn } from '../utils/cn';

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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-ink-50)] px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
        <div className="mb-2 flex items-center gap-2.5">
          <BrandLogo size={36} />
        </div>
        {children}
      </div>
    </div>
  );
}

function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Shell>
      <div className="rounded-2xl border border-[var(--color-ink-100)] bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-[var(--color-ink-900)]">{title}</h1>
        {children && <div className="mt-2 text-sm text-[var(--color-ink-600)]">{children}</div>}
      </div>
    </Shell>
  );
}

export function ClientRequestPage() {
  const { token = '' } = useParams();
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

  const send = useCallback(
    async (itemId: string, p: Pending) => {
      if (!view || inFlight.current.has(p.key)) return; // a double click never uploads twice
      inFlight.current.add(p.key);
      patch(itemId, p.key, { state: 'uploading', message: undefined });
      try {
        const updated = await uploadRequestFile(token, view.folder, itemId, p.key, p.file, (attempt) =>
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

  function choose(itemId: string, files: FileList | null) {
    if (!files?.length) return;
    const added = Array.from(files).map((file): Pending => ({ key: newFileKey(), file, state: 'uploading' }));
    setPending((all) => ({ ...all, [itemId]: [...(all[itemId] ?? []), ...added] }));
    // One at a time per item keeps it simple on slow connections.
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
  if (view.status === 'cancelled') return <Notice title="This request is no longer active">Your insurance agent closed this request. If you still have questions, please contact them directly.</Notice>;
  if (view.status === 'expired') return <Notice title="This link has expired">Please contact your insurance agent for a new link.</Notice>;

  const remaining = view.items.filter((i) => !i.received);
  const done = view.status === 'complete' || remaining.length === 0;

  return (
    <Shell>
      <div className="rounded-2xl border border-[var(--color-ink-100)] bg-white p-6 shadow-sm">
        {view.contactFirstName && <p className="text-sm text-[var(--color-ink-500)]">Hi {view.contactFirstName},</p>}
        <h1 className="text-lg font-semibold text-[var(--color-ink-900)]">Documents needed for {view.accountName}</h1>
        <p className={cn('mt-1 text-sm font-medium', done ? 'text-[var(--color-success-600)]' : 'text-[var(--color-ink-600)]')} data-testid="remaining">
          {done ? 'Everything has been received — thank you!' : `${remaining.length} item${remaining.length === 1 ? '' : 's'} remaining`}
        </p>
        <ul className="mt-5 flex flex-col gap-3">
          {view.items.map((item) => (
            <ItemRow key={item.id} item={item} pending={pending[item.id] ?? []} closed={done} onChoose={(f) => choose(item.id, f)} onRetry={(p) => void send(item.id, p)} onRemove={(p) => patch(item.id, p.key, null)} />
          ))}
        </ul>
        <p className="mt-5 text-xs text-[var(--color-ink-500)]">Files go straight to your insurance agent. You can come back to this link any time to add what’s still missing.</p>
      </div>
    </Shell>
  );
}

function ItemRow({
  item,
  pending,
  closed,
  onChoose,
  onRetry,
  onRemove,
}: {
  item: PublicRequestItem;
  pending: Pending[];
  closed: boolean;
  onChoose: (files: FileList | null) => void;
  onRetry: (p: Pending) => void;
  onRemove: (p: Pending) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = pending.some((p) => p.state !== 'failed');
  return (
    <li className={cn('rounded-xl border px-4 py-3', item.received ? 'border-[var(--color-success-100)] bg-[var(--color-success-100)]/40' : 'border-[var(--color-ink-100)]')} data-testid="client-item" data-received={item.received ? 'yes' : 'no'}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-ink-900)]">
            {item.received ? <CircleCheck size={16} className="shrink-0 text-[var(--color-success-600)]" /> : <span className="h-4 w-4 shrink-0 rounded border border-[var(--color-ink-300)]" />}
            {item.label}
          </p>
          {item.instructions && <p className="mt-0.5 pl-6 text-xs text-[var(--color-ink-500)]">{item.instructions}</p>}
          {item.files.length > 0 && (
            <ul className="mt-1 pl-6 text-xs text-[var(--color-ink-600)]">
              {item.files.map((f, i) => (
                <li key={`${f.name}-${i}`}>Received: {f.name}</li>
              ))}
            </ul>
          )}
        </div>
        {!item.received && !closed && (
          <>
            <input ref={input} type="file" multiple className="hidden" onChange={(e) => (onChoose(e.target.files), (e.target.value = ''))} data-testid="client-file-input" />
            <Button size="sm" icon={<Upload size={14} />} disabled={busy} onClick={() => input.current?.click()}>
              Upload
            </Button>
          </>
        )}
      </div>
      {pending.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5 pl-6">
          {pending.map((p) => (
            <li key={p.key} className="flex flex-wrap items-center gap-2 text-xs" data-testid="client-upload" data-state={p.state}>
              {p.state === 'failed' ? <TriangleAlert size={13} className="text-[var(--color-danger-600)]" /> : <Loader2 size={13} className="animate-spin text-[var(--color-ink-500)]" />}
              <span className="font-medium text-[var(--color-ink-800)]">{p.file.name}</span>
              <span className={p.state === 'failed' ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-ink-500)]'}>
                {p.state === 'uploading' ? 'Uploading…' : p.state === 'retrying' ? p.message : `Not uploaded — ${p.message ?? 'something went wrong'}`}
              </span>
              {p.state === 'failed' && (
                <>
                  <button className="font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer" onClick={() => onRetry(p)}>
                    Retry
                  </button>
                  <button className="text-[var(--color-ink-500)] hover:underline cursor-pointer" onClick={() => onRemove(p)}>
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
