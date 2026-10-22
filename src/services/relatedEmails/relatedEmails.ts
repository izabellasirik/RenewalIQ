import { matchAccount, type MatchCandidateInput } from '../emailAssistant/matchAccount';
import { extractIdentifiers } from '../emailAssistant/rulesExtractor';
import type { ParsedEmail } from '../emailAssistant/parseEmail';
import type { EmailExtraction } from '../emailAssistant/types';

/**
 * Related Emails (Phase 1): which accounts one of the broker's own Gmail threads may be about, and how the
 * Overview lists them. Uses the Email Assistant's deterministic matcher unchanged, on what's synced from
 * Gmail (sender, subject and the short snippet — never the body). A suggestion is only ever "possible":
 * the broker confirms it. Accounts already linked to the thread (including ones marked Not Related) are
 * never suggested again; the database enforces the same (0068).
 */

/** One Gmail thread as synced: headers and Gmail ids only. */
export interface EmailThreadMeta {
  id: string;
  gmailThreadId: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  lastMessageId: string;
  /** ISO timestamp of the newest message. */
  lastMessageAt: string;
  messageCount: number;
}

export type LinkMatchStatus = 'possible' | 'confirmed';
/** active = To Review. */
export type LinkReviewStatus = 'active' | 'reviewed' | 'not_related';

export interface EmailAccountLink {
  id: string;
  accountId: string;
  threadId: string;
  matchStatus: LinkMatchStatus;
  reviewStatus: LinkReviewStatus;
  reasons: { kind: string; detail: string }[];
}

export interface LinkSuggestion {
  accountId: string;
  reasons: { kind: string; detail: string }[];
}

/** At most this many accounts are suggested for one thread: beyond that, nothing identifies the account. */
export const MAX_SUGGESTIONS_PER_THREAD = 3;

/**
 * The accounts to suggest for a thread. `snippet` is Gmail's short preview, used for matching only and not
 * kept. A candidate needs strong or medium evidence (a contact, USDOT / MC number, the account's name, the
 * sender's company domain) and nothing contradicting it; a market named on its own is never enough.
 */
export function suggestThreadLinks(
  thread: Pick<EmailThreadMeta, 'subject' | 'fromName' | 'fromEmail'>,
  snippet: string,
  inputs: MatchCandidateInput[],
  alreadyLinked: Iterable<string>,
  opts: { agencyId?: string | null } = {}
): LinkSuggestion[] {
  const text = `${thread.subject}\n${snippet}`;
  const email: ParsedEmail = {
    source: 'paste',
    from: { address: thread.fromEmail ?? '', name: thread.fromName ?? undefined },
    to: [],
    cc: [],
    subject: thread.subject,
    text: snippet,
    newText: snippet,
    html: [],
    attachments: [],
    auth: {},
    warnings: [],
  };
  const extraction: EmailExtraction = {
    extractor: { id: 'related-emails', version: '1' },
    intent: 'other',
    senderRoleGuess: 'unknown',
    documents: [],
    deadlines: [],
    urgent: false,
    identifiers: extractIdentifiers(text),
  };
  const linked = new Set(alreadyLinked);
  const match = matchAccount(email, extraction, inputs, opts);
  const usable = match.candidates.filter(
    (c) => !linked.has(c.accountId) && c.evidence.some((e) => e.strength === 'strong' || e.strength === 'medium') && !c.evidence.some((e) => e.strength === 'conflict')
  );
  if (usable.length > MAX_SUGGESTIONS_PER_THREAD) return [];
  return usable.map((c) => ({ accountId: c.accountId, reasons: c.evidence.map((e) => ({ kind: e.kind, detail: e.detail })) }));
}

/** What the Overview's Related Emails section shows for one account (the signed-in broker's own links). */
export interface RelatedEmailsView<L extends EmailAccountLink = EmailAccountLink> {
  /** To Review, newest first. */
  active: { link: L; thread: EmailThreadMeta }[];
  /** The first few of `active`, shown when the section is expanded. */
  preview: { link: L; thread: EmailThreadMeta }[];
  /** Reviewed (the collapsed section), newest first. */
  reviewed: { link: L; thread: EmailThreadMeta }[];
  awaitingCount: number;
  latestSubject: string | null;
}

export const PREVIEW_COUNT = 5;

export function relatedEmailsView<L extends EmailAccountLink>(accountId: string, links: L[], threads: EmailThreadMeta[]): RelatedEmailsView<L> {
  const byId = new Map(threads.map((t) => [t.id, t]));
  const rows = links
    .filter((l) => l.accountId === accountId && byId.has(l.threadId))
    .map((link) => ({ link, thread: byId.get(link.threadId)! }))
    .sort((a, b) => b.thread.lastMessageAt.localeCompare(a.thread.lastMessageAt) || a.thread.gmailThreadId.localeCompare(b.thread.gmailThreadId));
  const active = rows.filter((r) => r.link.reviewStatus === 'active');
  return {
    active,
    preview: active.slice(0, PREVIEW_COUNT),
    reviewed: rows.filter((r) => r.link.reviewStatus === 'reviewed'),
    awaitingCount: active.length,
    latestSubject: active[0]?.thread.subject ?? null,
  };
}

/** How many suggestions Refresh saves at once (each is one small database call). */
export const SAVE_CONCURRENCY = 6;

/**
 * Saves Refresh's suggestions, a few at a time, and reports what the database refused, instead of silently
 * counting it as "0 new suggestions". `save` returns the repository's result.
 */
export async function saveSuggestions(
  items: { threadId: string; suggestion: LinkSuggestion }[],
  save: (threadId: string, s: LinkSuggestion) => Promise<{ ok: true } | { ok: false; message: string }>,
  concurrency = SAVE_CONCURRENCY
): Promise<{ saved: number; failed: number; firstError: string | null }> {
  let saved = 0;
  let failed = 0;
  let firstError: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const { threadId, suggestion } = items[next++];
      const r = await save(threadId, suggestion);
      if (r.ok) saved++;
      else {
        failed++;
        firstError ??= r.message;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { saved, failed, firstError };
}

/**
 * The accounts Related Emails may suggest: only the agency's own (the database refuses links to personal or
 * other agencies' accounts, so suggesting them only fails again on every Refresh).
 */
export function linkableInputs<I extends Pick<MatchCandidateInput, 'account'>>(inputs: I[], agencyId: string | null | undefined): I[] {
  return agencyId ? inputs.filter((i) => i.account.agencyId === agencyId) : [];
}

/** What "Link an email" shows: results only after a search has finished; "No emails found" only when it succeeded empty. */
export type LinkSearchState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; rows: EmailThreadMeta[] };
export function linkSearchView(state: LinkSearchState): 'loading' | 'error' | 'empty' | 'rows' {
  if (state.status !== 'done') return state.status;
  return state.rows.length ? 'rows' : 'empty';
}

/**
 * What Refresh matches: the threads this sync returned (with Gmail's snippet) plus every thread already
 * stored (subject and sender only — snippets aren't kept), so a contact or account added after a thread
 * was first fetched still finds it. Each thread once, the synced copy first.
 */
export function threadsToMatch(synced: (EmailThreadMeta & { snippet: string })[], stored: EmailThreadMeta[]): { thread: EmailThreadMeta; snippet: string }[] {
  const seen = new Set(synced.map((t) => t.id));
  return [...synced.map(({ snippet, ...thread }) => ({ thread, snippet })), ...stored.filter((t) => !seen.has(t.id)).map((thread) => ({ thread, snippet: '' }))];
}

/** Opens the thread in the mailbox it belongs to (Gmail picks the right signed-in account by address). */
export function gmailThreadUrl(mailbox: string, gmailThreadId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#all/${encodeURIComponent(gmailThreadId)}`;
}
