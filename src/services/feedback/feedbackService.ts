import type { FeedbackStatus, FeedbackType, ProductFeedback } from '../../types';
import { supabase, isSupabaseConfigured } from '../supabase/client';

export const NOT_CONFIGURED_MESSAGE = 'Supabase is not configured in this environment. See SUPABASE_SETUP.md — nothing was submitted or loaded.';

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; reason: 'not_configured' | 'error'; message: string };

function notConfigured<T>(): ServiceResult<T> {
  return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };
}

function errorResult<T>(message: string): ServiceResult<T> {
  return { ok: false, reason: 'error', message };
}

interface FeedbackRow {
  id: string;
  feedback_type: string;
  message: string;
  name: string | null;
  email: string | null;
  page_path: string | null;
  account_id: string | null;
  appetite_record_id: string | null;
  status: string;
  created_at: string;
}

function rowToFeedback(row: FeedbackRow): ProductFeedback {
  return {
    id: row.id,
    feedbackType: row.feedback_type as FeedbackType,
    message: row.message,
    name: row.name,
    email: row.email,
    pagePath: row.page_path,
    accountId: row.account_id,
    appetiteRecordId: row.appetite_record_id,
    status: row.status as FeedbackStatus,
    createdAt: row.created_at,
  };
}

export interface SubmitProductFeedbackInput {
  feedbackType: FeedbackType;
  message: string;
  name: string;
  email: string;
  pagePath: string;
  accountId?: string;
  appetiteRecordId?: string;
}

/** Inserts a new 'new'-status feedback row. Never touches anything else. Returns ok:false (never a false "saved") on any failure, including Supabase not being configured. */
export async function submitProductFeedback(input: SubmitProductFeedbackInput): Promise<ServiceResult<null>> {
  if (!supabase) return notConfigured();

  const { error } = await supabase.from('product_feedback').insert({
    feedback_type: input.feedbackType,
    message: input.message,
    name: input.name || null,
    email: input.email || null,
    page_path: input.pagePath || null,
    account_id: input.accountId || null,
    appetite_record_id: input.appetiteRecordId || null,
    status: 'new',
  });

  if (error) return errorResult(error.message);
  return { ok: true, data: null };
}

/** Every feedback entry regardless of status, newest first — the admin dashboard and the full feedback list both derive their counts and filtered views from this single fetch. RLS ("admin can read product feedback", see supabase/migrations) is the actual authorization boundary. */
export async function fetchAllProductFeedback(): Promise<ServiceResult<ProductFeedback[]>> {
  if (!supabase) return notConfigured();

  const { data, error } = await supabase.from('product_feedback').select('*').order('created_at', { ascending: false });

  if (error) return errorResult(error.message);
  return { ok: true, data: ((data ?? []) as FeedbackRow[]).map(rowToFeedback) };
}

/** Updates only the status of one feedback row — gated by the "admin can update product feedback status" RLS policy (is_admin()), which is the real authorization boundary here, not this client call. */
export async function updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<ServiceResult<null>> {
  if (!supabase) return notConfigured();

  const { error } = await supabase.from('product_feedback').update({ status }).eq('id', id);
  if (error) return errorResult(error.message);
  return { ok: true, data: null };
}

export { isSupabaseConfigured };
