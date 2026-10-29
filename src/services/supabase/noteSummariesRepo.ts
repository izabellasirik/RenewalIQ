import { supabase } from './client';
import type { RepoResult } from './commissionRepo';

/**
 * Saved notes summaries for account cards (0082). Read and written by whoever can see the account; the
 * summary itself comes from the AI function's "notes_summary" mode, only when someone clicks Summarize.
 */
export const MIGRATION_0082_MESSAGE = 'Notes summaries need database migration 0082_notes_summaries.sql.';
const NOT_CONFIGURED = { ok: false as const, message: 'Cloud sign-in is not configured in this environment.' };
const missing = (m: string) => /account_note_summaries|schema cache|does not exist/i.test(m);
const fail = (m: string) => ({ ok: false as const, message: missing(m) ? MIGRATION_0082_MESSAGE : m, ...(missing(m) ? { missingMigration: true } : {}) });

export interface NoteSummary {
  accountId: string;
  summary: string;
  /** notesHash() of the notes it was made from. */
  notesHash: string;
  createdByName: string | null;
  createdAt: string;
}

interface Row {
  submission_id: string;
  summary: string;
  notes_hash: string;
  created_by_name: string | null;
  created_at: string;
}
const fromRow = (r: Row): NoteSummary => ({ accountId: r.submission_id, summary: r.summary, notesHash: r.notes_hash, createdByName: r.created_by_name, createdAt: r.created_at });

export async function fetchNoteSummaries(): Promise<RepoResult<NoteSummary[]>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.from('account_note_summaries').select('submission_id, summary, notes_hash, created_by_name, created_at');
  if (error) return fail(error.message);
  return { ok: true, data: ((data ?? []) as Row[]).map(fromRow) };
}

/** Asks the AI for a summary of the notes text and saves it for everyone who can see the account. */
export async function summarizeNotes(accountId: string, notesText: string, hash: string, byName: string): Promise<RepoResult<NoteSummary>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { ok: false, message: 'Sign in to summarize notes.' };
  const { data, error } = await supabase.functions.invoke('extract-document-vision', { body: { mode: 'notes_summary', notesText, context: { accountId } } });
  const summary = (data as { summary?: unknown } | null)?.summary;
  if (error || typeof summary !== 'string' || !summary.trim()) return { ok: false, message: 'Couldn’t summarize the notes right now. Try again in a moment.' };
  const row = { submission_id: accountId, summary: summary.trim().slice(0, 1000), notes_hash: hash, created_by: user.user.id, created_by_name: byName.slice(0, 120), created_at: new Date().toISOString() };
  const { error: saveError } = await supabase.from('account_note_summaries').upsert(row, { onConflict: 'submission_id' });
  if (saveError) return fail(saveError.message);
  return { ok: true, data: fromRow(row) };
}
