import { supabase } from './client';

export type AuthResult = { ok: true } | { ok: false; message: string };

/**
 * Broker-facing Supabase Auth — deliberately a separate module from adminAuth.ts. A broker who
 * signs up here is a plain `authenticated` Supabase user with no row in `admin_users`; nothing in
 * this file ever reads or writes that table, so signing up can never grant admin access (see
 * supabase/migrations/0003_broker_workspaces.sql's security-model comment).
 */

export async function signUpBroker(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, message: 'Cloud sync is not configured in this environment. See SUPABASE_SETUP.md.' };
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function signInBroker(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, message: 'Cloud sync is not configured in this environment. See SUPABASE_SETUP.md.' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function signOutBroker(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * Same "never reveal whether the address has an account" behavior as the admin equivalent. The
 * redirect lands back on /login, where useBrokerSession's PASSWORD_RECOVERY handling shows the
 * "set a new password" form — the redirect URL must be allow-listed in the Supabase dashboard
 * (Authentication → URL Configuration), same one-time step as the admin flow. See SUPABASE_SETUP.md.
 */
export async function requestBrokerPasswordReset(email: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, message: 'Cloud sync is not configured in this environment. See SUPABASE_SETUP.md.' };
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/login`,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function updateBrokerPassword(newPassword: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, message: 'Cloud sync is not configured in this environment. See SUPABASE_SETUP.md.' };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
