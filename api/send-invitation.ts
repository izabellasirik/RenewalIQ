/**
 * POST /api/send-invitation  { invitationId }  (Authorization: Bearer <Supabase access token>)
 *
 * Emails an agency invitation to the address it was created for, through Resend
 * (https://resend.com). Needs two Vercel environment variables — until both are set this answers
 * 501 { notConfigured: true } and the app tells the admin to copy the link instead; it never
 * claims an email went out unless Resend accepted it:
 *   RESEND_API_KEY     — a Resend API key (server-side only; never a VITE_ variable)
 *   INVITE_EMAIL_FROM  — the sender, on a domain verified in Resend, e.g. "Renewal IQ <team@yourdomain.com>"
 * Optional: APP_URL (e.g. https://app.yourdomain.com) for the link; defaults to this deployment's own address.
 *
 * Not an open mailer: the invitation is read with the caller's own Supabase session, so RLS (0018)
 * only returns it to an admin of the agency that created it, and the only possible recipient is
 * the email address the invitation was made for. Accepted, cancelled and expired invitations are
 * refused.
 */

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_EMAIL_FROM;
  if (!apiKey || !from) return json(501, { notConfigured: true, error: 'Invitation email is not configured for this deployment.' });

  const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  const auth = request.headers.get('authorization') ?? '';
  if (!supabaseUrl || !anonKey) return json(501, { notConfigured: true, error: 'Supabase is not configured for this deployment.' });
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sign in to send invitations.' });

  let invitationId = '';
  try {
    invitationId = String(((await request.json()) as { invitationId?: unknown }).invitationId ?? '');
  } catch {
    // handled below
  }
  if (!/^[0-9a-f-]{36}$/i.test(invitationId)) return json(400, { error: 'Unknown invitation.' });

  const rest = (path: string) =>
    fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: { apikey: anonKey, authorization: auth, accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, authorization: auth }, signal: AbortSignal.timeout(8_000) });
    if (!userRes.ok) return json(401, { error: 'Sign in to send invitations.' });
    const user = (await userRes.json()) as { id: string; email?: string };

    const invRes = await rest(`agency_invitations?id=eq.${invitationId}&select=email,role,token,expires_at,accepted_at,revoked_at,agency_id`);
    const inv = invRes.ok ? ((await invRes.json()) as { email: string; role: string; token: string; expires_at: string; accepted_at: string | null; revoked_at: string | null; agency_id: string }[])[0] : undefined;
    if (!inv) return json(404, { error: 'Only an admin of this agency can send this invitation.' });
    if (inv.accepted_at || inv.revoked_at || new Date(inv.expires_at) < new Date()) return json(409, { error: 'This invitation is no longer open — create a new one.' });

    const [agencyRes, meRes] = await Promise.all([rest(`agencies?id=eq.${inv.agency_id}&select=name`), rest(`profiles?user_id=eq.${user.id}&select=display_name`)]);
    const agencyName = (agencyRes.ok ? ((await agencyRes.json()) as { name: string }[])[0]?.name : undefined) ?? 'your agency';
    const inviter = (meRes.ok ? ((await meRes.json()) as { display_name: string | null }[])[0]?.display_name?.trim() : undefined) || user.email || 'Your agency admin';

    const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    const link = `${appUrl}/invite/${encodeURIComponent(inv.token)}`;
    const role = inv.role === 'admin' ? 'an Admin' : 'an Agent';
    const expires = new Date(inv.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const subject = `${inviter} invited you to join ${agencyName} on Renewal IQ`;
    const text = `${inviter} invited you to join ${agencyName} on Renewal IQ as ${role}.\n\nOpen this link to create your account (or sign in) with ${inv.email} and join:\n${link}\n\nThe invitation expires on ${expires}. If you weren't expecting it, you can ignore this email.`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
  <p style="font-size:18px;font-weight:600;margin:0 0 16px">Renewal IQ</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(agencyName)}</strong> on Renewal IQ as ${role}.</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Create your account (or sign in) with <strong>${escapeHtml(inv.email)}</strong> to join.</p>
  <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">Accept invitation</a></p>
  <p style="font-size:13px;line-height:1.5;color:#64748b;margin:0 0 6px">Or open this link: <a href="${escapeHtml(link)}" style="color:#1e3a5f">${escapeHtml(link)}</a></p>
  <p style="font-size:13px;line-height:1.5;color:#64748b;margin:0">The invitation expires on ${expires}. If you weren't expecting it, you can ignore this email.</p>
</div>`;

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [inv.email], subject, text, html, ...(user.email ? { reply_to: user.email } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!sendRes.ok) {
      const detail = ((await sendRes.json().catch(() => null)) as { message?: string } | null)?.message;
      return json(502, { error: `The email service refused the message${detail ? `: ${detail}` : ''}. Copy the invitation link and send it to the new user.` });
    }
    return json(200, { sent: true });
  } catch {
    return json(502, { error: 'The invitation email could not be sent. Copy the invitation link and send it to the new user.' });
  }
}
