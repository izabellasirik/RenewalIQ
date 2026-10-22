import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Link2, Mail, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardBody, Drawer, Modal } from '../ui';
import { inputClass } from './formStyles';
import { useAccountsStore } from '../../state/useAccountsStore';
import { buildMatchInputs } from '../../services/emailAssistant/matchAccount';
import { gmailThreadUrl, relatedEmailsView, saveSuggestions, suggestThreadLinks, threadsToMatch, type EmailThreadMeta } from '../../services/relatedEmails/relatedEmails';
import {
  actOnLink,
  fetchAccountEmails,
  fetchGmailConnection,
  fetchLinkedAccounts,
  linkManually,
  searchMyThreads,
  suggestLink,
  syncGmail,
  type AccountEmailLink,
  type GmailConnection,
  type LinkAction,
} from '../../services/supabase/gmailRepo';

const PAGE = 20;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
type Row = { link: AccountEmailLink; thread: EmailThreadMeta };

/**
 * Related Emails on an account's Overview: the signed-in broker's own Gmail threads about this account.
 * Collapsed by default (count To Review and the latest subject); To Review (5, View All for the rest),
 * Reviewed and Not Related below. Read-only: nothing here changes Gmail. Hidden where it isn't set up.
 */
export function RelatedEmailsCard({ accountId }: { accountId: string }) {
  const accounts = useAccountsStore((s) => s.accounts);
  const riskProfiles = useAccountsStore((s) => s.riskProfiles);
  const quotes = useAccountsStore((s) => s.quotes);
  const agencyId = useAccountsStore((s) => s.agencyAccess?.agencyId ?? null);
  const [conn, setConn] = useState<GmailConnection | null | undefined>(undefined);
  const [available, setAvailable] = useState(true);
  const [links, setLinks] = useState<AccountEmailLink[]>([]);
  const [threads, setThreads] = useState<EmailThreadMeta[]>([]);
  const [open, setOpen] = useState(false);
  const [showReviewed, setShowReviewed] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(0);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const c = await fetchGmailConnection();
    if (!c.ok) {
      if (c.missingMigration || /not configured/i.test(c.message)) setAvailable(false);
      return;
    }
    setConn(c.data);
    const r = await fetchAccountEmails(accountId);
    if (r.ok) {
      setLinks(r.data.links);
      setThreads(r.data.threads);
    }
  }, [accountId]);
  useEffect(() => void load(), [load]);

  const view = useMemo(() => relatedEmailsView(accountId, links, threads), [accountId, links, threads]);
  const rejected: Row[] = useMemo(() => {
    const byId = new Map(threads.map((t) => [t.id, t]));
    return links.filter((l) => l.reviewStatus === 'not_related' && byId.has(l.threadId)).map((link) => ({ link, thread: byId.get(link.threadId)! }));
  }, [links, threads]);

  if (!available || conn === undefined) return null;
  const connected = conn && conn.status !== 'disconnected';

  // Refresh: new / changed threads from Gmail, then the deterministic matcher suggests accounts for them
  // (any of the broker's accounts, not only this one). Suggestions are only ever "possible".
  const refresh = async () => {
    setBusy(true);
    setNote(null);
    const r = await syncGmail();
    if (!r.ok) {
      setNote(r.message);
      setBusy(false);
      return;
    }
    if (r.data.status === 'reconnect_needed') setNote('Gmail access has expired. Reconnect it in Your profile.');
    // Match this sync's threads AND the ones already stored, so contacts saved since then are found.
    const stored = await searchMyThreads('', 500);
    const pool = threadsToMatch(r.data.threads, stored.ok ? stored.data : []);
    const linked = await fetchLinkedAccounts(pool.map((p) => p.thread.id));
    const inputs = buildMatchInputs({ accounts, riskProfiles, quotes }, { agencyId });
    const items = pool.flatMap(({ thread: t, snippet }) =>
      suggestThreadLinks(t, snippet, inputs, linked.ok ? (linked.data[t.id] ?? []) : [], { agencyId }).map((suggestion) => ({ threadId: t.id, suggestion }))
    );
    const { saved: suggested, failed, firstError } = await saveSuggestions(items, suggestLink);
    if (r.data.status === 'ok')
      setNote(
        `${r.data.threads.length} new or updated ${r.data.threads.length === 1 ? 'thread' : 'threads'} · ${suggested} new ${suggested === 1 ? 'suggestion' : 'suggestions'}${r.data.truncated ? ' (only the most recent mail was fetched)' : ''}.` +
          (failed ? ` ${failed} ${failed === 1 ? 'suggestion' : 'suggestions'} couldn’t be saved: ${firstError}` : '')
      );
    await load();
    setBusy(false);
  };
  const act = async (linkId: string, action: LinkAction) => {
    const r = await actOnLink(linkId, action);
    if (!r.ok) setNote(r.message);
    await load();
  };

  const EmailRow = ({ row, kind }: { row: Row; kind: 'review' | 'reviewed' | 'rejected' }) => (
    <li className="flex flex-col gap-1 border-b border-[var(--color-ink-50)] py-2 last:border-b-0 sm:flex-row sm:items-start sm:justify-between" data-email-link={row.link.id}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--color-ink-900)]">{row.thread.subject || '(no subject)'}</p>
        <p className="truncate text-xs text-[var(--color-ink-600)]">
          {row.thread.fromName ? `${row.thread.fromName} · ` : ''}{row.thread.fromEmail ?? ''} · {when(row.thread.lastMessageAt)}
          {row.thread.messageCount > 1 ? ` · ${row.thread.messageCount} messages` : ''}
        </p>
        <p className="text-[11px] text-[var(--color-ink-500)]">
          {row.link.matchStatus === 'confirmed' ? <Badge tone="success">Confirmed</Badge> : <Badge tone="warning">Possible</Badge>}{' '}
          {row.link.reasons.map((x) => x.detail).join('; ')}
          {kind === 'reviewed' && row.link.reviewedAt && <span className="ml-1">· Reviewed {when(row.link.reviewedAt)}</span>}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <a href={gmailThreadUrl(conn!.emailAddress, row.thread.gmailThreadId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-ink-50)]">
          Open in Gmail <ExternalLink size={11} aria-hidden />
        </a>
        {kind === 'review' && (
          <>
            {row.link.matchStatus === 'possible' && <Button size="sm" variant="ghost" onClick={() => act(row.link.id, 'confirm')}>Confirm</Button>}
            <Button size="sm" variant="secondary" onClick={() => act(row.link.id, 'reviewed')}>Reviewed</Button>
            <Button size="sm" variant="ghost" onClick={() => act(row.link.id, 'not_related')}>Not Related</Button>
          </>
        )}
        {kind === 'reviewed' && <Button size="sm" variant="ghost" onClick={() => act(row.link.id, 'undo_reviewed')}>Undo</Button>}
        {kind === 'rejected' && <Button size="sm" variant="ghost" onClick={() => act(row.link.id, 'restore')}>Restore</Button>}
      </div>
    </li>
  );

  return (
    <Card data-testid="related-emails">
      <CardBody className="pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" aria-expanded={open}>
            {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
            <Mail size={15} aria-hidden className="text-[var(--color-ink-500)]" />
            <span className="text-sm font-semibold text-[var(--color-ink-900)]">Related Emails</span>
            {view.awaitingCount > 0 && <span className="rounded-full bg-[var(--color-brand-100)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-brand-800)]" data-testid="related-emails-count">{view.awaitingCount} to review</span>}
            {!open && view.latestSubject && <span className="truncate text-xs text-[var(--color-ink-500)]">— {view.latestSubject}</span>}
          </button>
          {connected && (
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" icon={<Link2 size={13} />} onClick={() => setLinking(true)}>Link an email</Button>
              <Button size="sm" variant="secondary" icon={<RefreshCw size={13} className={busy ? 'animate-spin' : ''} />} onClick={refresh} disabled={busy}>Refresh</Button>
            </span>
          )}
        </div>
        {note && <p className="mt-2 text-xs text-[var(--color-ink-600)]" role="status">{note}</p>}
        {open && (
          <div className="mt-3">
            {!connected ? (
              <p className="text-sm text-[var(--color-ink-500)]">Connect your Gmail in Your profile (top right) to see emails about this account here. Only you see your emails.</p>
            ) : (
              <>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">To Review</h4>
                {view.preview.length === 0 ? (
                  <p className="py-2 text-sm text-[var(--color-ink-500)]">Nothing to review. Use Refresh to check Gmail for new emails.</p>
                ) : (
                  <ul>{view.preview.map((row) => <EmailRow key={row.link.id} row={row} kind="review" />)}</ul>
                )}
                {view.active.length > view.preview.length && (
                  <Button size="sm" variant="ghost" onClick={() => { setPage(0); setAll(true); }}>View All ({view.active.length})</Button>
                )}
                {view.reviewed.length > 0 && (
                  <div className="mt-3">
                    <button type="button" onClick={() => setShowReviewed(!showReviewed)} className="flex cursor-pointer items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]" aria-expanded={showReviewed}>
                      {showReviewed ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Reviewed ({view.reviewed.length})
                    </button>
                    {showReviewed && <ul>{view.reviewed.map((row) => <EmailRow key={row.link.id} row={row} kind="reviewed" />)}</ul>}
                  </div>
                )}
                {rejected.length > 0 && (
                  <div className="mt-2">
                    <button type="button" onClick={() => setShowRejected(!showRejected)} className="flex cursor-pointer items-center gap-1 text-xs text-[var(--color-ink-500)]" aria-expanded={showRejected}>
                      {showRejected ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Not related ({rejected.length})
                    </button>
                    {showRejected && <ul>{rejected.map((row) => <EmailRow key={row.link.id} row={row} kind="rejected" />)}</ul>}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardBody>
      <Drawer open={all} onClose={() => setAll(false)} title="Related Emails — To Review" subtitle={`${view.active.length} awaiting review`}>
        <ul>{view.active.slice(page * PAGE, page * PAGE + PAGE).map((row) => <EmailRow key={row.link.id} row={row} kind="review" />)}</ul>
        {view.active.length > PAGE && (
          <div className="mt-3 flex items-center justify-between text-xs">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page + 1} of {Math.ceil(view.active.length / PAGE)}</span>
            <Button size="sm" variant="ghost" disabled={(page + 1) * PAGE >= view.active.length} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </Drawer>
      {linking && <LinkEmailDialog accountId={accountId} linkedThreadIds={new Set(links.filter((l) => l.reviewStatus !== 'not_related').map((l) => l.threadId))} onClose={() => setLinking(false)} onLinked={() => { setLinking(false); setOpen(true); void load(); }} />}
    </Card>
  );
}

/** Link one of the broker's own synced emails to this account by hand (confirmed). Searches RenewalIQ's copy of headers, never Gmail. */
function LinkEmailDialog({ accountId, linkedThreadIds, onClose, onLinked }: { accountId: string; linkedThreadIds: Set<string>; onClose: () => void; onLinked: () => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<EmailThreadMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => void searchMyThreads(q).then((r) => (r.ok ? setRows(r.data) : setError(r.message))), 250);
    return () => clearTimeout(t);
  }, [q]);
  const link = async (threadId: string) => {
    const r = await linkManually(threadId, accountId);
    if (r.ok) onLinked();
    else setError(r.message);
  };
  return (
    <Modal open onClose={onClose} title="Link an email to this account" subtitle="Your recent synced emails (Refresh first if one is missing).">
      <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject or sender" aria-label="Search your emails" autoFocus />
      {error && <p className="mt-2 text-xs text-[var(--color-danger-600)]">{error}</p>}
      <ul className="mt-2 max-h-80 overflow-y-auto">
        {rows.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 border-b border-[var(--color-ink-50)] py-2 last:border-b-0">
            <span className="min-w-0">
              <span className="block truncate text-sm">{t.subject || '(no subject)'}</span>
              <span className="block truncate text-xs text-[var(--color-ink-500)]">{t.fromEmail} · {when(t.lastMessageAt)}</span>
            </span>
            {linkedThreadIds.has(t.id) ? <span className="text-xs text-[var(--color-ink-400)]">Linked</span> : <Button size="sm" onClick={() => link(t.id)}>Link</Button>}
          </li>
        ))}
        {rows.length === 0 && <li className="py-3 text-sm text-[var(--color-ink-500)]">No emails found.</li>}
      </ul>
    </Modal>
  );
}
