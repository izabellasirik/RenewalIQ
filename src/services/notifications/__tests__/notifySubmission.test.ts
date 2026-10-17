import { describe, expect, it, vi } from 'vitest';
import { handleNotifySubmission, senderAddress, type ClaimedEmail, type NotifyEnv } from '../../../../api/notify-submission';

const SECRET = 'hook-secret-0123456789';
const ENV: NotifyEnv = {
  NOTIFY_WEBHOOK_SECRET: SECRET,
  RESEND_API_KEY: 're_test',
  NOTIFY_EMAIL_FROM: 'Renewal IQ <notifications@renewaliq.test>',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_URL: 'https://db.test',
  APP_URL: 'https://app.renewaliq.test',
};

const CLAIM: ClaimedEmail = {
  claimed: true,
  eventKey: 'request:dreq_1:20260930120000000000',
  kind: 'request',
  submittedAt: '2026-09-30T16:00:00Z',
  brokerEmail: 'roman@agency.com',
  brokerName: 'Roman Smith',
  agencyName: 'Adriatic Agency',
  accountName: 'ABC Transportation',
  accountId: 'acct_1',
  clientName: 'Pat Client',
  clientEmail: 'pat@client.com',
  files: ['loss_runs.pdf', 'ifta_q2.pdf'],
};

/** A call as the database makes it (pg_net / pg_cron): the shared secret, an event or "drain". */
const hook = (body: unknown, secret: string | null = SECRET) =>
  new Request('https://preview.renewaliq.test/api/notify-submission', { method: 'POST', body: JSON.stringify(body), headers: secret ? { 'x-renewaliq-notify-secret': secret } : {} });

/** A fake Supabase + Resend: `claims` are answered in order; records every call. */
function backend(claims: unknown[], opts: { resend?: { status: number; body: unknown }[]; due?: string[] } = {}) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const claimQueue = [...claims];
  const resendQueue = [...(opts.resend ?? [])];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (u.endsWith('/rpc/due_submission_emails')) return new Response(JSON.stringify(opts.due ?? []), { status: 200 });
    if (u.endsWith('/rpc/claim_submission_email_event')) return new Response(JSON.stringify(claimQueue.shift() ?? { claimed: false, reason: 'already_sent' }), { status: 200 });
    if (u.endsWith('/rpc/complete_submission_email_event')) return new Response('', { status: 204 });
    if (u === 'https://api.resend.com/emails') {
      const r = resendQueue.shift() ?? { status: 200, body: { id: `email_${calls.length}` } };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    throw new Error(`unexpected ${u}`);
  });
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    calls,
    sends: () => calls.filter((c) => c.url === 'https://api.resend.com/emails'),
    completions: () => calls.filter((c) => c.url.endsWith('/rpc/complete_submission_email_event')).map((c) => c.body),
  };
}

describe('broker email, sent server-side from the queue', () => {
  it('a queued event: one email to the broker, from Renewal IQ, Reply-To the client, with the details and a link', async () => {
    const b = backend([CLAIM]);
    const res = await handleNotifySubmission(hook({ eventKey: CLAIM.eventKey }), ENV, b.fetchImpl);
    expect(await res.json()).toEqual({ processed: [{ eventKey: CLAIM.eventKey, outcome: 'sent' }] });
    const claimCall = b.calls[0];
    expect(claimCall.url).toBe('https://db.test/rest/v1/rpc/claim_submission_email_event');
    expect(claimCall.headers.authorization).toBe('Bearer service-key');
    expect(claimCall.body).toEqual({ p_event_key: CLAIM.eventKey });

    expect(b.sends()).toHaveLength(1);
    const { body, headers } = b.sends()[0];
    expect(body.from).toBe('Adriatic Agency via Renewal IQ <notifications@renewaliq.test>');
    expect(body.to).toEqual(['roman@agency.com']);
    expect(body.reply_to).toBe('pat@client.com');
    expect(headers['idempotency-key']).toBe(CLAIM.eventKey);
    const text = String(body.text);
    for (const s of ['Account / client: ABC Transportation', 'Client: Pat Client · pat@client.com', 'Submitted: Sep 30, 2026', '• loss_runs.pdf', '• ifta_q2.pdf', 'https://app.renewaliq.test/accounts/acct_1']) expect(text).toContain(s);
    expect(b.completions()).toEqual([{ p_event_key: CLAIM.eventKey, p_sent: true, p_provider_message_id: expect.any(String), p_error: null }]);
  });

  it('intake event (no account yet) links to Submission Intake and shows the reference', async () => {
    const b = backend([{ ...CLAIM, kind: 'intake', eventKey: 'intake:isub_1', accountId: null, intakeSubmissionId: 'isub_1', reference: 'RIQ-001070' }]);
    await handleNotifySubmission(hook({ eventKey: 'intake:isub_1' }), ENV, b.fetchImpl);
    const text = String(b.sends()[0].body.text);
    expect(text).toContain('Reference: RIQ-001070');
    expect(text).toContain('https://app.renewaliq.test/intake-links');
  });

  it('the same event delivered twice (pg_net retry + the cron sweep): one email', async () => {
    const b = backend([CLAIM, { claimed: false, reason: 'already_sent' }]);
    await handleNotifySubmission(hook({ eventKey: CLAIM.eventKey }), ENV, b.fetchImpl);
    const second = await handleNotifySubmission(hook({ eventKey: CLAIM.eventKey }), ENV, b.fetchImpl);
    expect(await second.json()).toEqual({ processed: [{ eventKey: CLAIM.eventKey, outcome: 'already_sent' }] });
    expect(b.sends()).toHaveLength(1);
  });

  it('email provider down: recorded failed; the retry sends it once, with the same idempotency key', async () => {
    const b = backend([CLAIM, { ...CLAIM, attempt: 2 }], { resend: [{ status: 503, body: { message: 'unavailable' } }, { status: 200, body: { id: 'email_ok' } }] });
    const first = await handleNotifySubmission(hook({ eventKey: CLAIM.eventKey }), ENV, b.fetchImpl);
    expect(await first.json()).toEqual({ processed: [{ eventKey: CLAIM.eventKey, outcome: 'failed' }] });
    expect(b.completions()[0]).toMatchObject({ p_sent: false, p_error: 'Email service refused it: unavailable' });
    const retry = await handleNotifySubmission(hook({ drain: true }), { ...ENV }, backendWithDue(b, [CLAIM.eventKey]));
    expect(await retry.json()).toEqual({ processed: [{ eventKey: CLAIM.eventKey, outcome: 'sent' }] });
    const accepted = b.sends().filter((_, i) => i === 1);
    expect(accepted).toHaveLength(1);
    expect(b.sends().map((s) => s.headers['idempotency-key'])).toEqual([CLAIM.eventKey, CLAIM.eventKey]);
  });

  it('drain (the cron sweep) processes every due event', async () => {
    const other = { ...CLAIM, eventKey: 'intake:isub_2', kind: 'intake' as const, accountId: null };
    const b = backend([CLAIM, other], { due: [CLAIM.eventKey, 'intake:isub_2'] });
    const res = await handleNotifySubmission(hook({ drain: true }), ENV, b.fetchImpl);
    expect(await res.json()).toEqual({ processed: [{ eventKey: CLAIM.eventKey, outcome: 'sent' }, { eventKey: 'intake:isub_2', outcome: 'sent' }] });
    expect(b.sends()).toHaveLength(2);
  });

  it('missing client email: still sent, no Reply-To, and From is never the client', async () => {
    const b = backend([{ ...CLAIM, clientEmail: null }]);
    await handleNotifySubmission(hook({ eventKey: CLAIM.eventKey }), ENV, b.fetchImpl);
    const { body } = b.sends()[0];
    expect(body.reply_to).toBeUndefined();
    expect(body.from).toBe('Adriatic Agency via Renewal IQ <notifications@renewaliq.test>');
    expect(String(body.text)).not.toContain('Reply to this email');
  });

  it('only the database can call it: no secret / wrong secret → 401, nothing touched', async () => {
    const b = backend([CLAIM]);
    expect((await handleNotifySubmission(hook({ eventKey: CLAIM.eventKey }, null), ENV, b.fetchImpl)).status).toBe(401);
    expect((await handleNotifySubmission(hook({ eventKey: CLAIM.eventKey }, 'hook-secret-0123456788'), ENV, b.fetchImpl)).status).toBe(401);
    // What the client page used to send is refused too.
    expect((await handleNotifySubmission(hook({ kind: 'request', token: 'efd96ec3955f49078f84e2c8ea3e5e68' }, null), ENV, b.fetchImpl)).status).toBe(401);
    expect(b.calls).toHaveLength(0);
  });

  it('bad input and missing configuration', async () => {
    const b = backend([CLAIM]);
    expect((await handleNotifySubmission(hook({ eventKey: "x' or 1=1" }), ENV, b.fetchImpl)).status).toBe(400);
    expect((await handleNotifySubmission(hook({ eventKey: CLAIM.eventKey }), { ...ENV, NOTIFY_WEBHOOK_SECRET: undefined }, b.fetchImpl)).status).toBe(501);
    expect((await handleNotifySubmission(hook({ eventKey: CLAIM.eventKey }), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined }, b.fetchImpl)).status).toBe(501);
    expect(b.calls).toHaveLength(0);
  });

  it('sender address parsing', () => {
    expect(senderAddress('Renewal IQ <team@x.com>')).toBe('team@x.com');
    expect(senderAddress('team@x.com')).toBe('team@x.com');
    expect(senderAddress('not an address')).toBeNull();
  });
});

/** The same fake backend, answering "due" with these keys (the cron sweep's view). */
function backendWithDue(b: ReturnType<typeof backend>, due: string[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/rpc/due_submission_emails')) return new Response(JSON.stringify(due), { status: 200 });
    return b.fetchImpl(url, init);
  }) as typeof fetch;
}
