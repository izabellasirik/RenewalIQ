import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Link as LinkIcon } from 'lucide-react';
import { Button } from '../components/ui';
import { AuthShell, authInputClass as inputClass } from '../components/auth/AuthShell';
import { signUpBroker } from '../services/supabase/brokerAuth';
import { useBrokerSession } from '../hooks/useBrokerSession';

export function SignupPage() {
  const navigate = useNavigate();
  const session = useBrokerSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);

  useEffect(() => {
    if (session.status === 'signed_in') navigate('/', { replace: true });
  }, [session.status, navigate]);

  async function handleSubmit() {
    if (!email.trim() || password.length < 6) return;
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await signUpBroker(email.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // If email confirmation is required by the project's Auth settings, Supabase returns success
    // but no session yet — useBrokerSession won't flip to signed_in until the link is clicked, so
    // tell the broker to check their inbox rather than silently doing nothing.
    setNeedsEmailConfirmation(true);
  }

  if (session.status === 'not_configured') {
    return (
      <AuthShell>
        <div className="rounded-xl border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] p-6 text-center text-sm text-[var(--color-warning-700)]">
          Cloud accounts aren't configured in this environment. Renewal IQ still works fully in this browser — see SUPABASE_SETUP.md to enable cross-device accounts.
        </div>
        <p className="mt-4 text-center text-sm">
          <Link to="/" className="font-medium text-[var(--color-brand-700)] hover:underline">
            Continue without an account
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (needsEmailConfirmation) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--color-success-100)] bg-[var(--color-success-50)] p-6 text-center">
          <LinkIcon size={20} className="text-[var(--color-success-600)]" />
          <p className="text-sm font-medium text-[var(--color-ink-800)]">Check your email to confirm your account, then sign in.</p>
          <Button size="sm" onClick={() => navigate('/login')}>
            Go to sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-ink-100)] bg-white p-6">
        <p className="text-sm font-semibold text-[var(--color-ink-900)]">Create your account</p>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Email</label>
          <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          <p className="mt-1 text-[11px] text-[var(--color-ink-400)]">At least 6 characters.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Confirm password</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        </div>
        {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
        <Button disabled={!email.trim() || password.length < 6 || !confirmPassword || submitting} onClick={handleSubmit}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </div>
      <p className="mt-4 text-center text-sm text-[var(--color-ink-500)]">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-[var(--color-brand-700)] hover:underline">
          Sign in
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
