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
 * Sends a password-reset email via Supabase Auth. Deliberately reports the same generic success
 * message whether or not the address belongs to an account — Supabase itself doesn't error for an
 * unknown email either, so this avoids turning "forgot password" into an account-existence oracle.
 * The redirect target is this same admin page; Supabase appends recovery tokens to the URL, and
 * useAdminSession picks up the resulting PASSWORD_RECOVERY auth event. The redirect URL must be
 * allow-listed in the Supabase dashboard (Authentication → URL Configuration) — see SUPABASE_SETUP.md.
 */
export async function requestPasswordReset(email: string): Promise<SignInResult> {
  if (!supabase) return { ok: false, message: 'Supabase is not configured in this environment. See SUPABASE_SETUP.md.' };
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/admin/appetite-updates`,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** Completes a password reset — only valid while a PASSWORD_RECOVERY session is active (i.e. the user arrived via the emailed link). */
export async function updateAdminPassword(newPassword: string): Promise<SignInResult> {
  if (!supabase) return { ok: false, message: 'Supabase is not configured in this environment. See SUPABASE_SETUP.md.' };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
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
