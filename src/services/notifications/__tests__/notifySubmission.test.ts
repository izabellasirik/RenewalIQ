import { describe, expect, it, vi } from 'vitest';
import { handleNotifySubmission, senderAddress, type ClaimedEmail, type NotifyEnv } from '../../../../api/notify-submission';
import { notifyBrokerOfSubmission } from '../notifySubmission';

const ENV: NotifyEnv = {
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

const req = (body: unknown) => new Request('https://preview.renewaliq.test/api/notify-submission', { method: 'POST', body: JSON.stringify(body) });
const REQUEST_BODY = { kind: 'request', token: 'efd96ec3955f49078f84e2c8ea3e5e68' };

/** A fake Supabase + Resend: records every call. */
function backend(claim: unknown, resend: { status: number; body: unknown } = { status: 200, body: { id: 'email_1' } }) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (u.endsWith('/rpc/claim_submission_email')) return new Response(JSON.stringify(claim), { status: 200 });
    if (u.endsWith('/rpc/complete_submission_email')) return new Response('', { status: 204 });
    if (u === 'https://api.resend.com/emails') return new Response(JSON.stringify(resend.body), { status: resend.status });
    throw new Error(`unexpected ${u}`);
  });
  const sends = () => calls.filter((c) => c.url === 'https://api.resend.com/emails');
  const completion = () => calls.find((c) => c.url.endsWith('/rpc/complete_submission_email'))?.body;
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, sends, completion };
}

describe('broker email when a client submits', () => {
  it('successful submission: one email to the broker, from Renewal IQ, Reply-To the client, with the details and a link', async () => {
    const b = backend(CLAIM);
    const res = await handleNotifySubmission(req(REQUEST_BODY), ENV, b.fetchImpl);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    // The claim is made with the service key, never with anything the client sent as a credential.
    const claimCall = b.calls[0];
    expect(claimCall.headers.authorization).toBe('Bearer service-key');
    expect(claimCall.body).toEqual({ p_kind: 'request', p_id: '', p_proof: 'efd96ec3-955f-4907-8f84-e2c8ea3e5e68' });

    expect(b.sends()).toHaveLength(1);
    const { body, headers } = b.sends()[0];
    expect(body.from).toBe('Adriatic Agency via Renewal IQ <notifications@renewaliq.test>');
    expect(body.to).toEqual(['roman@agency.com']);
    expect(body.reply_to).toBe('pat@client.com');
    expect(String(body.from)).not.toContain('pat@client.com');
    expect(headers['idempotency-key']).toBe(CLAIM.eventKey);
    const text = String(body.text);
    expect(text).toContain('Account / client: ABC Transportation');
    expect(text).toContain('Client: Pat Client · pat@client.com');
    expect(text).toContain('Submitted: Sep 30, 2026');
    expect(text).toContain('• loss_runs.pdf');
    expect(text).toContain('• ifta_q2.pdf');
    expect(text).toContain('https://app.renewaliq.test/accounts/acct_1');
    expect(String(body.html)).toContain('href="https://app.renewaliq.test/accounts/acct_1"');
    expect(b.completion()).toMatchObject({ p_event_key: CLAIM.eventKey, p_sent: true, p_provider_message_id: 'email_1' });
  });

  it('intake submission (no account yet) links to Submission Intake and shows the reference', async () => {
    const b = backend({ ...CLAIM, kind: 'intake', eventKey: 'intake:isub_1', accountId: null, intakeSubmissionId: 'isub_1', reference: 'RIQ-001070' });
    await handleNotifySubmission(req({ kind: 'intake', submissionId: 'isub_1', clientToken: '03b0f0dc-ef5c-4349-b87d-3b97090565ca' }), ENV, b.fetchImpl);
    const text = String(b.sends()[0].body.text);
    expect(text).toContain('Reference: RIQ-001070');
    expect(text).toContain('https://app.renewaliq.test/intake-links');
  });

  it('retry / double submit: already emailed → no second email', async () => {
    const b = backend({ claimed: false, reason: 'already_sent' });
    const res = await handleNotifySubmission(req(REQUEST_BODY), ENV, b.fetchImpl);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: false, reason: 'already_sent' });
    expect(b.sends()).toHaveLength(0);
  });

  it('missing client email: still sent, no Reply-To, and From is never the client', async () => {
    const b = backend({ ...CLAIM, clientEmail: null, clientName: 'Pat Client' });
    await handleNotifySubmission(req(REQUEST_BODY), ENV, b.fetchImpl);
    const { body } = b.sends()[0];
    expect(body.reply_to).toBeUndefined();
    expect(body.from).toBe('Adriatic Agency via Renewal IQ <notifications@renewaliq.test>');
    expect(String(body.text)).toContain('Client: Pat Client');
    expect(String(body.text)).not.toContain('Reply to this email');
  });

  it('failed upload / not verified: the claim refuses, nothing is sent', async () => {
    const b = backend({ claimed: false, reason: 'not_submitted' });
    const res = await handleNotifySubmission(req({ kind: 'intake', submissionId: 'isub_1', clientToken: '03b0f0dc-ef5c-4349-b87d-3b97090565ca' }), ENV, b.fetchImpl);
    expect(await res.json()).toEqual({ sent: false, reason: 'not_submitted' });
    expect(b.sends()).toHaveLength(0);
  });

  it('email service refuses: recorded as failed (so a retry can send it), not as sent', async () => {
    const b = backend(CLAIM, { status: 422, body: { message: 'domain not verified' } });
    const res = await handleNotifySubmission(req(REQUEST_BODY), ENV, b.fetchImpl);
    expect(res.status).toBe(502);
    expect(b.completion()).toMatchObject({ p_sent: false, p_error: 'Email service refused it: domain not verified' });
  });

  it('not configured: 501 and nothing claimed', async () => {
    const b = backend(CLAIM);
    const res = await handleNotifySubmission(req(REQUEST_BODY), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined }, b.fetchImpl);
    expect(res.status).toBe(501);
    expect(b.calls).toHaveLength(0);
  });

  it('rejects malformed input without touching the database', async () => {
    const b = backend(CLAIM);
    expect((await handleNotifySubmission(req({ kind: 'request', token: "x' or 1=1" }), ENV, b.fetchImpl)).status).toBe(400);
    expect((await handleNotifySubmission(req({ kind: 'other', token: REQUEST_BODY.token }), ENV, b.fetchImpl)).status).toBe(400);
    expect(b.calls).toHaveLength(0);
  });

  it('sender address parsing', () => {
    expect(senderAddress('Renewal IQ <team@x.com>')).toBe('team@x.com');
    expect(senderAddress('team@x.com')).toBe('team@x.com');
    expect(senderAddress('not an address')).toBeNull();
  });
});

describe('client page → server call', () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('one call when the server answers; retries only on a server/network failure', async () => {
    const f1 = vi.fn(async () => ok({ sent: true }));
    expect(await notifyBrokerOfSubmission({ kind: 'request', token: 't' }, { fetchImpl: f1 as never, retryDelayMs: 1 })).toBe('sent');
    expect(f1).toHaveBeenCalledTimes(1);

    const f2 = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ok({ error: 'x' }, 502)).mockResolvedValueOnce(ok({ sent: false, reason: 'already_sent' }));
    expect(await notifyBrokerOfSubmission({ kind: 'request', token: 't' }, { fetchImpl: f2 as never, retryDelayMs: 1 })).toBe('skipped');
    expect(f2).toHaveBeenCalledTimes(3);

    const f3 = vi.fn(async () => ok({ notConfigured: true }, 501));
    expect(await notifyBrokerOfSubmission({ kind: 'intake', submissionId: 's', clientToken: 'c' }, { fetchImpl: f3 as never, retryDelayMs: 1 })).toBe('skipped');
    expect(f3).toHaveBeenCalledTimes(1);
  });
});
