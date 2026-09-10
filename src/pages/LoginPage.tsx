import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Button } from '../components/ui';
import { AuthShell, authInputClass as inputClass } from '../components/auth/AuthShell';
import { signInBroker, requestBrokerPasswordReset, updateBrokerPassword } from '../services/supabase/brokerAuth';
import { useBrokerSession } from '../hooks/useBrokerSession';

function ForgotPasswordForm({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    const result = await requestBrokerPasswordReset(email.trim());
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-ink-100)] bg-white p-6 text-center">
        <p className="text-sm font-medium text-[var(--color-ink-800)]">If an account exists for that email, a reset link has been sent.</p>
        <Button variant="secondary" size="sm" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-ink-100)] bg-white p-6">
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
  const navigate = useNavigate();
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
    const result = await updateBrokerPassword(password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-success-100)] bg-[var(--color-success-50)] p-6 text-center">
        <p className="text-sm font-medium text-[var(--color-ink-800)]">Password updated.</p>
        <Button size="sm" onClick={() => navigate('/')}>
          Continue to Renewal IQ
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-ink-100)] bg-white p-6">
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

export function LoginPage() {
  const navigate = useNavigate();
  const session = useBrokerSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  useEffect(() => {
    if (session.status === 'signed_in') navigate('/', { replace: true });
  }, [session.status, navigate]);

  async function handleSubmit() {
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    const result = await signInBroker(email.trim(), password);
    setSubmitting(false);
    if (!result.ok) setError(result.message);
    // On success, onAuthStateChange (inside useBrokerSession) picks up the new session and the
    // effect above redirects home.
  }

  if (session.status === 'not_configured') {
    return (
      <AuthShell>
        <div className="rounded-xl border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] p-6 text-center text-sm text-[var(--color-warning-700)]">
          Cloud sign-in isn't configured in this environment. Renewal IQ still works fully in this browser — see SUPABASE_SETUP.md to enable cross-device accounts.
        </div>
        <p className="mt-4 text-center text-sm">
          <Link to="/" className="font-medium text-[var(--color-brand-700)] hover:underline">
            Continue without an account
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (session.status === 'password_recovery') {
    return (
      <AuthShell>
        <ResetPasswordForm />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      {showForgotPassword ? (
        <ForgotPasswordForm initialEmail={email} onBack={() => setShowForgotPassword(false)} />
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-ink-100)] bg-white p-6">
          <p className="text-sm font-semibold text-[var(--color-ink-900)]">Sign in</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Email</label>
            <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
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
      )}
      <p className="mt-4 text-center text-sm text-[var(--color-ink-500)]">
        Don't have an account?{' '}
        <Link to="/signup" className="font-medium text-[var(--color-brand-700)] hover:underline">
          Sign up
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-[var(--color-ink-400)]">
        <Link to="/" className="hover:underline">
          Continue without an account
        </Link>
      </p>
    </AuthShell>
  );
}
