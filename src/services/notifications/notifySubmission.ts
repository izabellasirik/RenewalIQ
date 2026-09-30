/**
 * Tells Renewal IQ's server that a client just submitted, so it can email the assigned broker
 * (api/notify-submission.ts, 0040). Called only after the submission was saved and verified; the
 * server checks that again and sends each submission's email at most once, so calling this twice —
 * a retry, a double click — never sends two. It never blocks or fails the client's own flow.
 */
export type SubmissionNotice = { kind: 'intake'; submissionId: string; clientToken: string } | { kind: 'request'; token: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function notifyBrokerOfSubmission(notice: SubmissionNotice, opts: { fetchImpl?: typeof fetch; retryDelayMs?: number } = {}): Promise<'sent' | 'skipped' | 'failed'> {
  const doFetch = opts.fetchImpl ?? fetch;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await doFetch('/api/notify-submission', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(notice) });
      if (res.ok) {
        const out = (await res.json().catch(() => null)) as { sent?: boolean } | null;
        return out?.sent ? 'sent' : 'skipped';
      }
      // Not configured, not found or refused: retrying won't change it.
      if (res.status < 500 || res.status === 501) return 'skipped';
    } catch {
      // network: retry
    }
    if (attempt < 2) await wait((opts.retryDelayMs ?? 1500) * 2 ** attempt);
  }
  return 'failed';
}
