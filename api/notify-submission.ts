/**
 * POST /api/notify-submission — sends the broker the "client submitted" email.
 *
 * Called by the DATABASE, never by the client's browser (0041): a verified submission queues an
 * event in the same transaction, and after it commits pg_net posts { eventKey } here; every two
 * minutes pg_cron posts { drain: true } to retry whatever is still due. Each call carries the shared
 * secret (header x-renewaliq-notify-secret = NOTIFY_WEBHOOK_SECRET); anything else is refused.
 *
 * Each event is claimed atomically (claim_submission_email_event), sent once through Resend with
 * Idempotency-Key = the event key, and recorded 'sent' or 'failed' (retried with back-off, up to 8
 * attempts). A submission never waits on this or on the email provider.
 *
 * Vercel environment variables (server-side only, never VITE_):
 *   NOTIFY_WEBHOOK_SECRET       — the same secret as notification_dispatch_settings.secret (0041)
 *   RESEND_API_KEY              — as for team invitations (api/send-invitation.ts)
 *   NOTIFY_EMAIL_FROM           — sender on a Resend-verified domain, e.g. "Renewal IQ <notifications@yourdomain.com>"
 *                                 (falls back to INVITE_EMAIL_FROM). Shown as "<Agency> via Renewal IQ".
 *   SUPABASE_SERVICE_ROLE_KEY   — lets this server claim events and read the broker's address
 *   APP_URL (optional)          — the address used for the "Open in Renewal IQ" button
 *
 * From is always Renewal IQ's own sending address — never the client's. Reply-To is the client's
 * email when they gave one, so the broker can simply reply.
 */

export interface NotifyEnv {
  NOTIFY_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL_FROM?: string;
  INVITE_EMAIL_FROM?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  APP_URL?: string;
}

export interface ClaimedEmail {
  claimed: true;
  eventKey: string;
  kind: 'intake' | 'request';
  submittedAt: string;
  brokerEmail: string;
  brokerName?: string | null;
  agencyName?: string | null;
  accountName: string;
  accountId?: string | null;
  intakeSubmissionId?: string;
  reference?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  files: string[];
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** "Renewal IQ <team@x.com>" or "team@x.com" → the address, or null. */
export function senderAddress(from: string | undefined): string | null {
  const raw = (from ?? '').trim();
  const addr = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim();
  return EMAIL_RE.test(addr) ? addr : null;
}

/** Display name for From: the agency, sent by Renewal IQ (quotes and angle brackets removed). */
function senderName(agencyName: string | null | undefined): string {
  const agency = (agencyName ?? '').replace(/["<>\r\n]/g, '').trim();
  return agency ? `${agency} via Renewal IQ` : 'Renewal IQ';
}

export function buildSubmissionEmail(c: ClaimedEmail, opts: { from: string; appUrl: string }) {
  const addr = senderAddress(opts.from);
  if (!addr) throw new Error('The sending address is not valid.');
  const link = c.accountId ? `${opts.appUrl}/accounts/${encodeURIComponent(c.accountId)}` : `${opts.appUrl}/intake-links`;
  const when = new Date(c.submittedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }) + ' ET';
  const client = [c.clientName?.trim(), c.clientEmail?.trim()].filter(Boolean).join(' · ') || 'Not given';
  const what = c.kind === 'intake' ? 'a new submission' : 'documents';
  const subject = `${c.accountName}: client submitted ${what}${c.files.length ? ` (${c.files.length} file${c.files.length === 1 ? '' : 's'})` : ''}`;
  const fileLines = c.files.length ? c.files.map((f) => `  • ${f}`).join('\n') : '  (no files)';
  const button = c.accountId ? 'Open account in Renewal IQ' : 'Review in Renewal IQ';
  const text = [
    `${c.clientName?.trim() || 'Your client'} submitted ${what} for ${c.accountName}.`,
    '',
    `Account / client: ${c.accountName}`,
    `Client: ${client}`,
    `Submitted: ${when}`,
    ...(c.reference ? [`Reference: ${c.reference}`] : []),
    'Files:',
    fileLines,
    '',
    `${button}: ${link}`,
    ...(c.clientEmail ? ['', 'Reply to this email to answer the client directly.'] : []),
  ].join('\n');
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:13px;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:4px 0;font-size:14px">${value}</td></tr>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <p style="font-size:18px;font-weight:600;margin:0 0 16px">${escapeHtml(c.agencyName?.trim() || 'Renewal IQ')}</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 16px">${escapeHtml(c.clientName?.trim() || 'Your client')} submitted ${what} for <strong>${escapeHtml(c.accountName)}</strong>.</p>
  <table style="border-collapse:collapse;margin:0 0 16px">
    ${row('Account / client', escapeHtml(c.accountName))}
    ${row('Client', escapeHtml(client))}
    ${row('Submitted', escapeHtml(when))}
    ${c.reference ? row('Reference', escapeHtml(c.reference)) : ''}
    ${row('Files', c.files.length ? c.files.map((f) => escapeHtml(f)).join('<br>') : '<span style="color:#64748b">No files</span>')}
  </table>
  <p style="margin:0 0 20px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">${button}</a></p>
  ${c.clientEmail ? '<p style="font-size:13px;line-height:1.5;color:#64748b;margin:0">Reply to this email to answer the client directly.</p>' : ''}
</div>`;
  const replyTo = c.clientEmail && EMAIL_RE.test(c.clientEmail.trim()) ? c.clientEmail.trim() : null;
  return { from: `${senderName(c.agencyName)} <${addr}>`, to: [c.brokerEmail], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) };
}

/** Constant-time string comparison (the webhook secret). */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Outcome = 'sent' | 'failed' | 'already_sent' | 'not_due' | 'not_found' | 'skipped' | 'no_recipient' | 'error';

export async function handleNotifySubmission(request: Request, env: NotifyEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const hookSecret = env.NOTIFY_WEBHOOK_SECRET ?? '';
  const apiKey = env.RESEND_API_KEY;
  const from = env.NOTIFY_EMAIL_FROM || env.INVITE_EMAIL_FROM;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  if (!hookSecret || !apiKey || !from || !serviceKey || !supabaseUrl) return json(501, { notConfigured: true, error: 'Submission emails are not configured for this deployment.' });
  if (!sameSecret(request.headers.get('x-renewaliq-notify-secret') ?? '', hookSecret)) return json(401, { error: 'Not allowed.' });
  if (!senderAddress(from)) return json(501, { notConfigured: true, error: 'NOTIFY_EMAIL_FROM is not a valid address.' });

  let body: { eventKey?: unknown; drain?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // handled below
  }
  const eventKey = typeof body.eventKey === 'string' && /^(?:intake|request):[\w:-]{1,120}$/.test(body.eventKey) ? body.eventKey : null;
  if (!eventKey && body.drain !== true) return json(400, { error: 'Unknown event.' });

  const rpc = (fn: string, args: Record<string, unknown>) =>
    fetchImpl(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8_000),
    });
  const appUrl = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');

  async function processEvent(key: string): Promise<Outcome> {
    let claim: ClaimedEmail | { claimed: false; reason: Outcome };
    try {
      const res = await rpc('claim_submission_email_event', { p_event_key: key });
      if (!res.ok) return 'error';
      claim = (await res.json()) as typeof claim;
    } catch {
      return 'error';
    }
    if (!claim.claimed) return claim.reason;
    let sent = false;
    let providerId: string | null = null;
    let error: string | null = null;
    try {
      const message = buildSubmissionEmail(claim, { from: from!, appUrl });
      const sendRes = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        // Resend drops a repeat with the same key (24 h) — a crash between sending and recording never sends twice.
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'Idempotency-Key': claim.eventKey },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(10_000),
      });
      const out = (await sendRes.json().catch(() => null)) as { id?: string; message?: string } | null;
      sent = sendRes.ok;
      providerId = out?.id ?? null;
      error = sendRes.ok ? null : `Email service refused it${out?.message ? `: ${out.message}` : ''}`;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Email could not be sent';
    }
    try {
      await rpc('complete_submission_email_event', { p_event_key: claim.eventKey, p_sent: sent, p_provider_message_id: providerId, p_error: error });
    } catch {
      // Left 'sending': due again after 10 minutes; Resend's idempotency key prevents a double send.
    }
    return sent ? 'sent' : 'failed';
  }

  let keys: string[] = eventKey ? [eventKey] : [];
  if (!eventKey) {
    try {
      const res = await rpc('due_submission_emails', { p_limit: 20 });
      keys = res.ok ? ((await res.json()) as string[]) : [];
    } catch {
      keys = [];
    }
  }
  const processed: { eventKey: string; outcome: Outcome }[] = [];
  for (const key of keys) processed.push({ eventKey: key, outcome: await processEvent(key) });
  return json(200, { processed });
}

export async function POST(request: Request): Promise<Response> {
  return handleNotifySubmission(request, process.env as NotifyEnv);
}
