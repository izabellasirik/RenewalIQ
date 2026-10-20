import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '../ui';
import { disconnectGmail, fetchGmailConnection, startGmailConnect, type GmailConnection as Connection } from '../../services/supabase/gmailRepo';

const RESULT_TEXT: Record<string, string> = {
  connected: 'Gmail connected. Use Refresh in an account’s Related Emails to bring in your recent mail.',
  cancelled: 'Gmail wasn’t connected (cancelled).',
  failed: 'Gmail couldn’t be connected. Try again.',
};

/**
 * Connect / Disconnect the broker's own Gmail (read-only). Shown in Your profile. Hidden where Related
 * Emails isn't set up (no 0068 in this database).
 */
export function GmailConnection({ result }: { result?: string | null }) {
  const [conn, setConn] = useState<Connection | null | undefined>(undefined);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(result ? (RESULT_TEXT[result] ?? null) : null);

  const load = () =>
    void fetchGmailConnection().then((r) => {
      if (r.ok) setConn(r.data);
      else if (r.missingMigration || /not configured/i.test(r.message)) setAvailable(false);
      else setMessage(r.message);
    });
  useEffect(load, []);
  if (!available || conn === undefined) return null;

  const connect = async () => {
    setBusy(true);
    const r = await startGmailConnect(`${window.location.origin}${window.location.pathname}`);
    if (r.ok) window.location.href = r.data.url;
    else {
      setMessage(r.message);
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    const r = await disconnectGmail();
    setBusy(false);
    setMessage(r.ok ? 'Gmail disconnected. RenewalIQ no longer has access to it.' : r.message);
    load();
  };
  const connected = conn && conn.status !== 'disconnected';

  return (
    <section className="mt-5 border-t border-[var(--color-ink-100)] pt-4" data-testid="gmail-connection">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]"><Mail size={15} aria-hidden /> Email (Gmail)</h3>
      <p className="mt-1 text-xs text-[var(--color-ink-500)]">
        Read-only: RenewalIQ shows emails related to each account to you only. It never sends, deletes or changes your mail, and doesn’t store email bodies or attachments.
      </p>
      {connected ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <strong>{conn.emailAddress}</strong>
            {conn.status === 'reconnect_needed' ? <span className="ml-2 text-xs font-medium text-[var(--color-warning-600)]">Access expired — reconnect</span> : conn.lastSyncedAt ? <span className="ml-2 text-xs text-[var(--color-ink-500)]">Last refreshed {new Date(conn.lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span> : null}
          </span>
          <span className="flex gap-2">
            {conn.status === 'reconnect_needed' && <Button size="sm" onClick={connect} disabled={busy}>Reconnect</Button>}
            <Button size="sm" variant="secondary" onClick={disconnect} disabled={busy}>Disconnect</Button>
          </span>
        </div>
      ) : (
        <Button size="sm" className="mt-2" onClick={connect} disabled={busy}>Connect Gmail</Button>
      )}
      {message && <p className="mt-2 text-xs text-[var(--color-ink-600)]" role="status">{message}</p>}
    </section>
  );
}
