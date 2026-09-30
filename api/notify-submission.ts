/**
 * POST /api/notify-submission
 *   { kind: 'intake', submissionId, clientToken }   — after a Submission Intake form finished (0029)
 *   { kind: 'request', token }                      — after a client pressed Submit on a document request (0035)
 *
 * Emails the assigned broker that a client just submitted documents, through Resend
 * (https://resend.com). Called by the public client page — no sign-in — so it trusts nothing it is
 * sent: claim_submission_email (0040), run here with the service role, checks the client's own proof
 * (the intake submission's client key / the request's link token), that the submission really was
 * saved and verified, and that this submission event hasn't been emailed already; it also returns the
 * broker's address, which never reaches the browser. Each event is emailed at most once (the claim,
 * plus Resend's Idempotency-Key); a send the email service refuses can be retried, a sent one never.
 *
 * Vercel environment variables (server-side only, never VITE_):
 *   RESEND_API_KEY              — as for team invitations (api/send-invitation.ts)
 *   NOTIFY_EMAIL_FROM           — sender on a Resend-verified domain, e.g. "Renewal IQ <notifications@yourdomain.com>"
 *                                 (falls back to INVITE_EMAIL_FROM). Shown as "<Agency> via Renewal IQ".
 *   SUPABASE_SERVICE_ROLE_KEY   — lets this server call the claim; never exposed to the browser
 *   APP_URL (optional)          — the address used for the "Open in Renewal IQ" button
 * Until they're set this answers 501 { notConfigured: true } and nothing is recorded as sent.
 *
 * From is always Renewal IQ's own sending address — never the client's. Reply-To is the client's
 * email when they gave one, so the broker can simply reply.
 */

export interface NotifyEnv {
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

type Body = { kind?: unknown; submissionId?: unknown; clientToken?: unknown; token?: unknown };

export async function handleNotifySubmission(request: Request, env: NotifyEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.NOTIFY_EMAIL_FROM || env.INVITE_EMAIL_FROM;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  if (!apiKey || !from || !serviceKey || !supabaseUrl) return json(501, { notConfigured: true, error: 'Submission emails are not configured for this deployment.' });
  if (!senderAddress(from)) return json(501, { notConfigured: true, error: 'NOTIFY_EMAIL_FROM is not a valid address.' });

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // handled below
  }
  const kind = body.kind === 'intake' || body.kind === 'request' ? body.kind : null;
  const id = kind === 'intake' ? String(body.submissionId ?? '') : '';
  const proof = String((kind === 'intake' ? body.clientToken : body.token) ?? '');
  if (!kind || !/^[0-9a-f-]{32,36}$/i.test(proof) || (kind === 'intake' && !/^[\w-]{1,80}$/.test(id))) return json(400, { error: 'Unknown submission.' });

  const rpc = (fn: string, args: Record<string, unknown>) =>
    fetchImpl(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8_000),
    });

  let claim: ClaimedEmail | { claimed: false; reason: string };
  try {
    const res = await rpc('claim_submission_email', { p_kind: kind, p_id: id, p_proof: kind === 'request' ? proof.replace(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i, '$1-$2-$3-$4-$5') : proof });
    if (!res.ok) return json(502, { error: 'Could not check the submission.' });
    claim = (await res.json()) as typeof claim;
  } catch {
    return json(502, { error: 'Could not check the submission.' });
  }
  if (!claim.claimed) {
    // Already emailed (a retry or double submit), not submitted/verified yet, or no broker address.
    return json(claim.reason === 'not_found' ? 404 : 200, { sent: false, reason: claim.reason });
  }

  const appUrl = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  let sent = false;
  let providerId: string | null = null;
  let error: string | null = null;
  try {
    const message = buildSubmissionEmail(claim, { from, appUrl });
    const sendRes = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
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
    await rpc('complete_submission_email', { p_event_key: claim.eventKey, p_sent: sent, p_provider_message_id: providerId, p_error: error });
  } catch {
    // The claim stays "sending" and becomes claimable again after 10 minutes if it wasn't sent.
  }
  return sent ? json(200, { sent: true }) : json(502, { sent: false, error });
}

export async function POST(request: Request): Promise<Response> {
  return handleNotifySubmission(request, process.env as NotifyEnv);
}
