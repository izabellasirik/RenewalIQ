import { supabase } from '../supabase/client';
import type { FounderSnapshot } from './founderMetrics';

/**
 * Founder Analytics reads (0043). The database decides who the founder is (is_founder()) and refuses
 * the snapshot to anyone else — the sidebar link and page gate are only conveniences on top.
 */
export async function checkIsFounder(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.rpc('is_founder');
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function fetchFounderSnapshot(from: Date, to: Date): Promise<{ ok: true; data: FounderSnapshot } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'Cloud is not configured.' };
  try {
    const { data, error } = await supabase.rpc('founder_analytics_snapshot', { p_from: from.toISOString(), p_to: to.toISOString() });
    if (error) return { ok: false, message: error.message };
    return { ok: true, data: data as FounderSnapshot };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not load Founder Analytics.' };
  }
}

export async function setAccountAnalyticsMode(accountId: string, mode: 'auto' | 'real' | 'test'): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: 'Cloud is not configured.' };
  const { error } = await supabase.rpc('set_account_analytics_mode', { p_account_id: accountId, p_mode: mode });
  return error ? { ok: false, message: error.message } : { ok: true };
}

/** AI Usage & Cost (0046) — founder only; the database refuses everyone else. */
export interface FounderAiUsage {
  timezone: string;
  costToday: number;
  costWeek: number;
  costMonth: number;
  documentsMonth: number;
  scannedPagesMonth: number;
  paidCallsMonth: number;
  failedCallsMonth: number;
  cachedReadsMonth: number;
  tokensMonth: number;
  avgCostPerDocumentMonth: number | null;
  topDocumentMonth: { documentId: string; fileName: string | null; accountId: string | null; cost: number; calls: number } | null;
  byModel: { model: string; calls: number; inputTokens: number; outputTokens: number; cost: number }[];
  byOperation: { operation: string; calls: number; cached: number; cost: number }[];
  bySource: { source: string; calls: number; cost: number }[];
  byBrokerage: { orgId: string | null; name: string; calls: number; documents: number; cost: number }[];
  daily: { day: string; cost: number; calls: number }[];
}

export async function fetchFounderAiUsage(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): Promise<{ ok: true; data: FounderAiUsage } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'Cloud is not configured.' };
  try {
    const { data, error } = await supabase.rpc('founder_ai_usage', { p_tz: timeZone });
    if (error) return { ok: false, message: error.message };
    return { ok: true, data: data as FounderAiUsage };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not load AI usage.' };
  }
}
