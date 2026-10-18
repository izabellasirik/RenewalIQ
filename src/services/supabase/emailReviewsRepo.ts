import { supabase } from './client';
import type { RepoResult } from './commissionRepo';
import type { EmailReview, AccountReview } from '../emailAssistant/reviewEmail';
import type { EarlierAttachment } from '../emailAssistant/attachments';

/**
 * The Email Assistant's records (0061): one row per review with the email's metadata and what was
 * found (short evidence snippets only, never the body), each attachment's fingerprint, and an
 * append-only audit of what the agent approved. Without 0061 every call says so and the assistant
 * still works — the review is then remembered only through the note it adds to the account.
 */

export const MIGRATION_0061_MESSAGE = 'Saving email reviews needs database migration 0061_email_assistant.sql. The review still works; it just isn’t stored.';
const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
// Missing table or function: its error code, its message, or a bare 404 (some gateways send no body).
const isMissing = (e: { code?: string; message?: string; status?: number }) =>
  e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || (/email_review/i.test(e.message ?? '') && /does not exist|could not find|schema cache/i.test(e.message ?? '')) || (e.status === 404 && !e.code);
const fail = (e: { code?: string; message?: string } | unknown, fallback: string, status?: number): RepoResult<never> => {
  const err = { ...(e as { code?: string; message?: string }), status };
  if (isMissing(err)) return { ok: false, message: MIGRATION_0061_MESSAGE, missingMigration: true };
  return { ok: false, message: err.message || fallback };
};

export type EmailReviewAction = 'approved' | 'applied' | 'failed' | 'imported' | 'dismissed' | 'draft_copied' | 'draft_opened';

export interface EmailReviewActionInput {
  action: EmailReviewAction;
  suggestionKind?: string;
  detail?: string;
  documentIds?: string[];
}

const clip = (s: string | undefined | null, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);

async function sha256Text(text: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** What is stored about what was found: labels, dates and short snippets — capped well under the database's 16 KB limit. */
export function reviewFindings(review: EmailReview, accountReview: AccountReview): Record<string, unknown> {
  const snip = (s: string) => clip(s, 220);
  return {
    documents: review.extraction.documents.slice(0, 25).map((d) => ({ label: clip(d.label, 120), stance: d.stance, evidence: snip(d.evidence) })),
    deadlines: review.extraction.deadlines.slice(0, 5).map((d) => ({ date: d.date, evidence: snip(d.evidence) })),
    deadlineNote: clip(review.deadlineCheck.note, 200),
    droppedDeadlines: review.deadlineCheck.dropped.length,
    reasons: accountReview.classification.reasons.slice(0, 5).map((r) => clip(r, 200)),
    uncertain: accountReview.classification.uncertain.slice(0, 8).map((r) => clip(r, 200)),
    contradictions: accountReview.contradictions.slice(0, 10).map((c) => ({ code: c.code, message: clip(c.message, 300) })),
    accountWarnings: accountReview.accountWarnings.slice(0, 5).map((w) => clip(w, 300)),
    safety: review.safety.map((s) => s.code),
    ai: review.read.ai ? { dropped: review.read.ai.dropped, fromCache: review.read.ai.fromCache } : review.read.aiSkipped ? { skipped: clip(review.read.aiSkipped, 200) } : null,
  };
}

/** Records the review (and its attachments' fingerprints) for the account. Returns its id. */
export async function saveEmailReview(submissionId: string, review: EmailReview, accountReview: AccountReview): Promise<RepoResult<string>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { email } = review;
    const res = await supabase
      .from('email_reviews')
      .insert({
        submission_id: submissionId,
        source_kind: review.source.kind,
        source_file_name: clip(review.source.fileName, 200),
        provider_message_id: clip(review.source.providerMessageId, 300),
        fingerprint: review.fingerprint,
        message_id_sha256: email.messageId ? await sha256Text(email.messageId.trim()) : null,
        sender_address: clip(email.from.address, 320),
        sender_name: clip(email.from.name, 200),
        subject: clip(email.subject, 300),
        email_date: email.date ?? null,
        attachment_count: Math.min(email.attachments.length, 100),
        category: accountReview.classification.category,
        confidence: accountReview.classification.confidence,
        intent: review.extraction.intent,
        read_method: review.read.method,
        ai_model: clip(review.read.ai?.model, 100),
        match_status: review.match.status,
        findings: reviewFindings(review, accountReview),
      })
      .select('id')
      .single();
    if (res.error) return fail(res.error, 'Could not save the email review.', res.status);
    const id = (res.data as { id: string }).id;
    if (accountReview.attachments.length) {
      const att = await supabase.from('email_review_attachments').insert(
        accountReview.attachments.slice(0, 100).map((a) => ({
          review_id: id,
          position: a.index,
          name: clip(a.name, 255) || 'attachment',
          content_type: clip(a.contentType, 150),
          size_bytes: a.sizeBytes,
          sha256: a.sha256 ?? null,
          kinds: a.kinds.slice(0, 10),
          status: a.status,
        }))
      );
      if (att.error) return fail(att.error, 'Could not save the attachments’ fingerprints.', att.status);
    }
    return { ok: true, data: id };
  } catch (err) {
    return fail(err, 'Could not save the email review.');
  }
}

export async function recordEmailReviewActions(reviewId: string, actions: EmailReviewActionInput[]): Promise<RepoResult<void>> {
  if (!supabase) return NOT_CONFIGURED;
  if (!actions.length) return { ok: true, data: undefined };
  try {
    const res = await supabase.from('email_review_actions').insert(
      actions.map((a) => ({ review_id: reviewId, submission_id: '', action: a.action, suggestion_kind: clip(a.suggestionKind, 40), detail: clip(a.detail, 500), document_ids: (a.documentIds ?? []).slice(0, 25) }))
    );
    if (res.error) return fail(res.error, 'Could not record the approval.', res.status);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err, 'Could not record the approval.');
  }
}

export async function setEmailReviewStatus(reviewId: string, status: 'applied' | 'dismissed'): Promise<RepoResult<void>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.from('email_reviews').update({ status }).eq('id', reviewId);
    if (res.error) return fail(res.error, 'Could not update the review.', res.status);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err, 'Could not update the review.');
  }
}

/** Whether this email, and which of these files, came in before on the account (any agent's review). */
export async function fetchEmailSeen(submissionId: string, fingerprint: string, hashes: string[]): Promise<RepoResult<{ reviewedAt?: string; attachments: EarlierAttachment[] }>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const res = await supabase.rpc('email_review_seen', { p_submission_id: submissionId, p_fingerprint: fingerprint, p_hashes: hashes.slice(0, 100) });
    if (res.error) return fail(res.error, 'Could not check earlier emails.', res.status);
    const d = (res.data ?? {}) as { reviewed_at?: string | null; attachments?: { sha256: string; name: string; reviewed_at: string }[] };
    return { ok: true, data: { reviewedAt: d.reviewed_at ?? undefined, attachments: (d.attachments ?? []).map((a) => ({ sha256: a.sha256, name: a.name, reviewedAt: a.reviewed_at })) } };
  } catch (err) {
    return fail(err, 'Could not check earlier emails.');
  }
}
