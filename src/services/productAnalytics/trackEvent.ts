import { supabase } from '../supabase/client';

/**
 * Meaningful product-usage events for Founder Analytics (0043) — the ONE place the app records them.
 * Not clicks: an account created, a document processed, an application downloaded, a market added…
 *
 * Fire-and-forget: never awaited by a caller, never throws, never slows or blocks the broker's work.
 * The database stamps who did it, their brokerage and whether the account is Real or Test, and keeps
 * only a few whitelisted metadata keys (source, count, method, status, workflow, fields, stage) —
 * never client names, documents, drivers or DOT numbers.
 */
export type ProductEventName =
  | 'account_created'
  | 'account_imported'
  | 'account_opened_on_later_day'
  | 'intake_link_created'
  | 'intake_submitted'
  | 'intake_imported'
  | 'document_uploaded'
  | 'document_processed'
  | 'ai_extraction_completed'
  | 'risk_profile_generated'
  | 'risk_profile_reviewed'
  | 'risk_profile_completed'
  | 'application_reviewed'
  | 'application_downloaded'
  | 'market_search_completed'
  | 'carrier_appetite_generated'
  | 'carrier_match_opened'
  | 'market_added_to_account'
  | 'market_added'
  | 'market_status_changed'
  | 'quote_added'
  | 'quote_updated'
  | 'follow_up_created'
  | 'follow_up_completed'
  // 0047 — before it runs, these are refused quietly by the database (never an error in the app).
  | 'requirements_added'
  | 'document_request_prepared'
  | 'document_request_sent'
  | 'requested_document_received'
  | 'requirement_verified'
  | 'requirement_not_applicable'
  | 'agency_created';

export type ProductEventMetadata = Partial<Record<'source' | 'count' | 'method' | 'status' | 'workflow' | 'fields' | 'stage', string | number | boolean>>;

export interface TrackOptions {
  accountId?: string | null;
  metadata?: ProductEventMetadata;
  /** Counts once (per user) — e.g. `opened:${accountId}:${day}`. Also skipped locally after the first send. */
  dedupeKey?: string;
}

const sentKeys = new Set<string>();

export function trackEvent(eventName: ProductEventName, opts: TrackOptions = {}): void {
  try {
    if (!supabase) return;
    if (opts.dedupeKey) {
      if (sentKeys.has(opts.dedupeKey)) return;
      sentKeys.add(opts.dedupeKey);
    }
    void Promise.resolve(
      supabase.rpc('track_product_event', {
        p_event_name: eventName,
        p_account_id: opts.accountId ?? null,
        p_metadata: opts.metadata ?? {},
        p_dedupe_key: opts.dedupeKey ?? null,
      })
    ).catch(() => undefined);
  } catch {
    // analytics must never get in the way
  }
}

/** Today in the broker's own calendar, for "once per day" keys. */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Marks an account as a demo (sample documents loaded) for Founder Analytics only. */
export function markAccountDemo(accountId: string): void {
  try {
    if (!supabase) return;
    void Promise.resolve(supabase.rpc('mark_account_demo', { p_account_id: accountId })).catch(() => undefined);
  } catch {
    // never blocks
  }
}
