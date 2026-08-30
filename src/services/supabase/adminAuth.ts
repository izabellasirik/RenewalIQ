import { supabase } from './client';

export type SignInResult = { ok: true } | { ok: false; message: string };

/** Sign-in only — there is deliberately no sign-up path in this app. An admin account is created via the Supabase dashboard (Authentication → Users) and granted access via the admin_users table; see SUPABASE_SETUP.md. */
export async function signInAdmin(email: string, password: string): Promise<SignInResult> {
  if (!supabase) return { ok: false, message: 'Supabase is not configured in this environment. See SUPABASE_SETUP.md.' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function signOutAdmin(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * Calls the is_admin() database function (see supabase/migrations) rather than checking any
 * client-held flag — RLS/the database is the actual authority on who is an admin, this just asks
 * it. Returns false (never throws) if Supabase isn't configured or the call fails, so the caller
 * always defaults to the least-privileged state.
 */
export async function checkIsAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return data === true;
}
