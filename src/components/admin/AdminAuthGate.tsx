import { useEffect, useState, type ReactNode } from 'react';
import { ShieldAlert, ShieldCheck, LogOut, KeyRound } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '../ui';
import { signInAdmin, signOutAdmin, requestPasswordReset, updateAdminPassword } from '../../services/supabase/adminAuth';
import { useAdminSession } from '../../hooks/useAdminSession';

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

function ForgotPasswordForm({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    const result = await requestPasswordReset(email.trim());
    setSubmitting(false);
    // Same message whether or not the address has an account — never confirm/deny existence.
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-3 rounded-xl border border-[var(--color-ink-100)] bg-white p-6 text-center">
        <p className="text-sm font-medium text-[var(--color-ink-800)]">If an admin account exists for that email, a reset link has been sent.</p>
        <Button variant="secondary" size="sm" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3 rounded-xl border border-[var(--color-ink-100)] bg-white p-6">
      <p className="text-sm font-semibold text-[var(--color-ink-900)]">Reset password</p>
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
      </div>
      {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
      <div className="flex gap-2">
        <Button disabled={!email.trim() || submitting} onClick={handleSubmit}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    </div>
  );
}

function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await updateAdminPassword(password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-3 rounded-xl border border-[var(--color-success-100)] bg-[var(--color-success-50)] p-6 text-center">
        <p className="text-sm font-medium text-[var(--color-ink-800)]">Password updated. Reloading…</p>
        <Button size="sm" onClick={() => window.location.assign('/admin')}>
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3 rounded-xl border border-[var(--color-ink-100)] bg-white p-6">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
        <KeyRound size={15} /> Set a new password
      </p>
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">New password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Confirm new password</label>
        <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
      </div>
      {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
      <Button disabled={!password || !confirmPassword || submitting} onClick={handleSubmit}>
        {submitting ? 'Saving…' : 'Update password'}
      </Button>
    </div>
  );
}

function AdminLoginForm({ justSignedOut }: { justSignedOut: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    const result = await signInAdmin(email.trim(), password);
    setSubmitting(false);
    if (!result.ok) setError(result.message);
    // On success, onAuthStateChange (inside useAdminSession) picks up the new session automatically.
  }

  if (showForgotPassword) {
    return <ForgotPasswordForm initialEmail={email} onBack={() => setShowForgotPassword(false)} />;
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3">
      {justSignedOut && (
        <p className="rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] px-3 py-2 text-center text-xs text-[var(--color-ink-600)]">
          You've been signed out. Sign in with the same or a different admin account below.
        </p>
      )}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-ink-100)] bg-white p-6">
        <p className="text-sm font-semibold text-[var(--color-ink-900)]">Admin sign-in</p>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        </div>
        {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
        <Button disabled={!email.trim() || !password || submitting} onClick={handleSubmit}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <button onClick={() => setShowForgotPassword(true)} className="text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
          Forgot password?
        </button>
      </div>
    </div>
  );
}

/**
 * The single admin authorization gate, shared by every /admin* page. Renders the appropriate
 * sign-in/loading/unauthorized state and never renders `children` until the database (is_admin(),
 * backed by RLS — see supabase/migrations) has confirmed the current session is an admin. Pages
 * using this gate must not fetch admin-only data themselves outside of `children` — the gate only
 * controls what's rendered, real authorization still happens server-side on every request.
 */
export function AdminAuthGate({ children }: { children: ReactNode }) {
  const session = useAdminSession();
  const [justSignedOut, setJustSignedOut] = useState(false);

  function handleSignOut() {
    setJustSignedOut(true);
    signOutAdmin();
  }

  // Clear the "you've been signed out" notice once a new sign-in attempt actually lands somewhere.
  useEffect(() => {
    if (session.status !== 'signed_out') setJustSignedOut(false);
  }, [session.status]);

  if (session.status === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} variant="block" className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (session.status === 'not_configured') {
    return (
      <EmptyState
        icon={<ShieldAlert size={26} strokeWidth={1.5} />}
        title="Supabase is not configured"
        description="See SUPABASE_SETUP.md — sign-in and the request queue can't be loaded without VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
      />
    );
  }

  if (session.status === 'signed_out') {
    return <AdminLoginForm justSignedOut={justSignedOut} />;
  }

  if (session.status === 'password_recovery') {
    return <ResetPasswordForm />;
  }

  if (session.status === 'unauthorized') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-6 py-10 text-center">
        <ShieldAlert size={26} className="text-[var(--color-danger-600)]" strokeWidth={1.5} />
        <p className="text-sm font-medium text-[var(--color-ink-800)]">You are signed in, but this account does not have admin access.</p>
        <p className="text-xs text-[var(--color-ink-500)]">Signed in as {session.email}</p>
        <p className="max-w-sm text-sm text-[var(--color-ink-500)]">No request data was fetched. Ask an existing admin to add your user id to the admin_users table — see SUPABASE_SETUP.md.</p>
        <Button size="sm" variant="secondary" icon={<LogOut size={13} />} onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    );
  }

  // session.status === 'admin'
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2.5 rounded-lg border border-[var(--color-success-100)] bg-[var(--color-success-50)] px-4 py-3 text-sm text-[var(--color-success-800)]">
        <span className="flex items-center gap-2">
          <ShieldCheck size={16} className="shrink-0" />
          Signed in as {session.email}
        </span>
        <Button size="sm" variant="ghost" icon={<LogOut size={13} />} onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
      {children}
    </div>
  );
}
