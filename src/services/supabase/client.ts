import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * True only when both env vars are present. Every caller in this app must check this (or handle a
 * null `supabase`) before touching the appetite-update workflow — this environment may not have
 * Supabase configured, and the app must degrade to a clear "not configured" state rather than
 * throwing or silently pretending a request was saved.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Only the public anon key is ever used here — this file runs in the browser. The service-role key
 * must never appear in frontend code, an env var read by Vite, or any file in this repo; see
 * SUPABASE_SETUP.md.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url as string, anonKey as string) : null;
