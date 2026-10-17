import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../api/send-invitation';

const INV_ID = '11111111-2222-3333-4444-555555555555';
const req = (body: unknown = { invitationId: INV_ID }, auth = 'Bearer user-token') =>
  new Request('https://app.example.com/api/send-invitation', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

const openInvite = { email: 'new@agency.com', role: 'agent', token: 'tok123', expires_at: new Date(Date.now() + 86400000).toISOString(), accepted_at: null, revoked_at: null, agency_id: 'ag1' };

function mockUpstream(invites: unknown[] = [openInvite], resend: Response = ok({ id: 'em_1' })) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return ok({ id: 'u1', email: 'denis@agency.com' });
      if (url.includes('/rest/v1/agency_invitations')) return ok(invites);
      if (url.includes('/rest/v1/agencies')) return ok([{ name: 'Acme Brokerage' }]);
      if (url.includes('/rest/v1/profiles')) return ok([{ display_name: 'Denis' }]);
      if (url === 'https://api.resend.com/emails') return resend;
      throw new Error(`unexpected ${url}`);
    })
  );
  return calls;
}

describe('api/send-invitation', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('RESEND_API_KEY', 're_key');
    vi.stubEnv('INVITE_EMAIL_FROM', 'Renewal IQ <team@agency.com>');
    vi.stubEnv('APP_URL', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('says it is not configured (and sends nothing) without a provider key', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const calls = mockUpstream();
    const res = await POST(req());
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ notConfigured: true });
    expect(calls).toHaveLength(0);
  });

  it('emails the invited address only, with the invitation link, using the caller’s session', async () => {
    const calls = mockUpstream();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    const inviteRead = calls.find((c) => c.url.includes('agency_invitations'))!;
    expect((inviteRead.init!.headers as Record<string, string>).authorization).toBe('Bearer user-token');
    const sent = JSON.parse(String(calls.find((c) => c.url === 'https://api.resend.com/emails')!.init!.body));
    expect(sent.to).toEqual(['new@agency.com']);
    expect(sent.from).toBe('Renewal IQ <team@agency.com>');
    expect(sent.subject).toBe('Denis invited you to join Acme Brokerage on Renewal IQ');
    expect(sent.text).toContain('https://app.example.com/invite/tok123');
    expect(sent.html).toContain('https://app.example.com/invite/tok123');
  });

  it('refuses when RLS hides the invitation (not an admin of that agency)', async () => {
    const calls = mockUpstream([]);
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.url.includes('resend'))).toBe(false);
  });

  it('refuses cancelled, accepted or expired invitations', async () => {
    for (const patch of [{ revoked_at: '2026-01-01' }, { accepted_at: '2026-01-01' }, { expires_at: '2020-01-01T00:00:00Z' }]) {
      mockUpstream([{ ...openInvite, ...patch }]);
      expect((await POST(req())).status).toBe(409);
    }
  });

  it('does not report success when the provider refuses the message', async () => {
    mockUpstream([openInvite], new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403, headers: { 'content-type': 'application/json' } }));
    const res = await POST(req());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.sent).toBeUndefined();
    expect(body.error).toContain('domain not verified');
  });

  it('requires a signed-in caller and a well-formed invitation id', async () => {
    mockUpstream();
    expect((await POST(req(undefined, ''))).status).toBe(401);
    expect((await POST(req({ invitationId: "x' or 1=1" }))).status).toBe(400);
  });
});
