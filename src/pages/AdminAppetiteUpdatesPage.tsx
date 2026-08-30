import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck, LogOut, CircleCheck, CircleX, CircleHelp, ExternalLink, KeyRound } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Badge, EmptyState, Skeleton } from '../components/ui';
import type { AppetiteFieldKey, AppetiteUpdateRequest, AppetiteUpdateStatus, VerificationStatus } from '../types';
import { APPETITE_FIELD_KEY_LABELS } from '../types';
import { fetchOpenAppetiteUpdateRequests, reviewAppetiteUpdateRequest } from '../services/appetiteUpdates/appetiteUpdateService';
import { signInAdmin, signOutAdmin, requestPasswordReset, updateAdminPassword } from '../services/supabase/adminAuth';
import { useAdminSession } from '../hooks/useAdminSession';

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not on file';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

type ExpandedAction = 'none' | Exclude<AppetiteUpdateStatus, 'pending'>;

function RequestReviewCard({ request, onReviewed }: { request: AppetiteUpdateRequest; onReviewed: () => void }) {
  const [expanded, setExpanded] = useState<ExpandedAction>('none');
  const [reviewNotes, setReviewNotes] = useState('');
  const [approveValue, setApproveValue] = useState(request.proposedValue);
  const [approveStatus, setApproveStatus] = useState<Extract<VerificationStatus, 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NEEDS_CONFIRMATION'>>('NEEDS_CONFIRMATION');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(decision: Exclude<AppetiteUpdateStatus, 'pending'>) {
    setSubmitting(true);
    setError(null);
    let approvedValue: unknown = undefined;
    if (decision === 'approved') {
      try {
        approvedValue = JSON.parse(approveValue);
      } catch {
        approvedValue = approveValue; // plain string/number-as-text is fine for string-typed criteria
      }
    }
    const result = await reviewAppetiteUpdateRequest({
      request,
      decision,
      reviewNotes: reviewNotes.trim(),
      approvedValue,
      approvedVerificationStatus: decision === 'approved' ? approveStatus : undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onReviewed();
  }

  return (
    <div className="rounded-xl border border-[var(--color-ink-100)] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink-900)]">{request.marketName}</p>
          <Badge tone="neutral" className="mt-1">
            {APPETITE_FIELD_KEY_LABELS[request.fieldKey as AppetiteFieldKey] ?? request.fieldKey}
          </Badge>
          {request.status === 'needs_more_information' && (
            <Badge tone="warning" className="ml-1.5 mt-1">
              Needs More Information
            </Badge>
          )}
        </div>
        <p className="text-xs text-[var(--color-ink-400)]">
          {request.submitterName} · {request.submitterEmail}
          <br />
          Submitted {new Date(request.createdAt).toLocaleString('en-US')}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-dashed border-[var(--color-ink-200)] bg-[var(--color-ink-50)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-400)]">Current Value</p>
          <p className="mt-0.5 text-sm text-[var(--color-ink-700)]">{displayValue(request.currentValue)}</p>
        </div>
        <div className="rounded-lg border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-500)]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-700)]">Proposed Value</p>
          <p className="mt-0.5 text-sm font-medium text-[var(--color-ink-900)]">{request.proposedValue}</p>
        </div>
      </div>

      {request.notes && <p className="mt-3 text-sm text-[var(--color-ink-600)]">{request.notes}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-ink-500)]">
        {request.sourceUrl && (
          <a href={request.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-700)] hover:underline">
            Source <ExternalLink size={11} />
          </a>
        )}
        {request.sourceReference && <span>Reference: {request.sourceReference}</span>}
      </div>

      {expanded === 'none' && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" icon={<CircleCheck size={14} />} onClick={() => setExpanded('approved')}>
            Approve
          </Button>
          <Button size="sm" variant="danger" icon={<CircleX size={14} />} onClick={() => setExpanded('rejected')}>
            Reject
          </Button>
          <Button size="sm" variant="secondary" icon={<CircleHelp size={14} />} onClick={() => setExpanded('needs_more_information')}>
            Needs More Information
          </Button>
        </div>
      )}

      {expanded !== 'none' && (
        <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-ink-100)] pt-3">
          {expanded === 'approved' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">
                  Value to write live — confirm/edit before approving. Plain text/number/true-false for simple fields; JSON for States or Fleet Size (e.g. {'{"min":5,"max":40}'}).
                </label>
                <input value={approveValue} onChange={(e) => setApproveValue(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">
                  Verification status — never defaults to Verified. Choose Verified only if you've confirmed this against official carrier documentation.
                </label>
                <select value={approveStatus} onChange={(e) => setApproveStatus(e.target.value as typeof approveStatus)} className={inputClass}>
                  <option value="NEEDS_CONFIRMATION">Needs Confirmation — broker/underwriter said so, not independently confirmed</option>
                  <option value="PARTIALLY_VERIFIED">Partially Verified — part of this is confirmed</option>
                  <option value="VERIFIED">Verified — confirmed against official carrier documentation</option>
                </select>
              </div>
            </>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Review notes (optional)</label>
            <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={2} className={inputClass} />
          </div>
          {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={submitting} onClick={() => confirm(expanded)}>
              {submitting ? 'Saving…' : `Confirm ${expanded === 'needs_more_information' ? 'Needs More Information' : expanded === 'approved' ? 'Approval' : 'Rejection'}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExpanded('none')}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

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
        <Button size="sm" onClick={() => window.location.assign('/admin/appetite-updates')}>
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
        <p className="text-xs text-[var(--color-ink-500)]">
          There is no self-service sign-up — an admin account is created directly in the Supabase dashboard. See SUPABASE_SETUP.md.
        </p>
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

export function AdminAppetiteUpdatesPage() {
  const session = useAdminSession();
  const [requests, setRequests] = useState<AppetiteUpdateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [justSignedOut, setJustSignedOut] = useState(false);

  function handleSignOut() {
    setJustSignedOut(true);
    signOutAdmin();
  }

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchOpenAppetiteUpdateRequests();
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.message);
      setRequests([]);
      return;
    }
    setLoadError(null);
    setRequests(result.data);
  }, []);

  // Only ever fetch request data once the database has confirmed this session is an admin — never
  // on 'loading'/'signed_out'/'unauthorized'. The database (RLS + is_admin()) is still the actual
  // authorization boundary regardless; this just avoids firing a request that would return nothing.
  useEffect(() => {
    if (session.status === 'admin') load();
  }, [session.status, load]);

  // Clear the "you've been signed out" notice once a new sign-in attempt actually lands somewhere.
  useEffect(() => {
    if (session.status !== 'signed_out') setJustSignedOut(false);
  }, [session.status]);

  return (
    <PageContainer title="Pending Appetite Updates" description="Review broker-submitted appetite corrections before anything goes live.">
      {session.status === 'admin' && (
        <div className="mb-5 flex items-center justify-between gap-2.5 rounded-lg border border-[var(--color-success-100)] bg-[var(--color-success-50)] px-4 py-3 text-sm text-[var(--color-success-800)]">
          <span className="flex items-center gap-2">
            <ShieldCheck size={16} className="shrink-0" />
            Signed in as {session.email}
          </span>
          <Button size="sm" variant="ghost" icon={<LogOut size={13} />} onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      )}

      {session.status === 'loading' && (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} variant="block" className="h-16 w-full" />
          ))}
        </div>
      )}

      {session.status === 'not_configured' && (
        <EmptyState icon={<ShieldAlert size={26} strokeWidth={1.5} />} title="Supabase is not configured" description="See SUPABASE_SETUP.md — sign-in and the pending-request queue can't be loaded without VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY." />
      )}

      {session.status === 'signed_out' && <AdminLoginForm justSignedOut={justSignedOut} />}

      {session.status === 'password_recovery' && <ResetPasswordForm />}

      {session.status === 'unauthorized' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-6 py-10 text-center">
          <ShieldAlert size={26} className="text-[var(--color-danger-600)]" strokeWidth={1.5} />
          <p className="text-sm font-medium text-[var(--color-ink-800)]">You are signed in, but this account does not have admin access.</p>
          <p className="text-xs text-[var(--color-ink-500)]">Signed in as {session.email}</p>
          <p className="max-w-sm text-sm text-[var(--color-ink-500)]">No request data was fetched. Ask an existing admin to add your user id to the admin_users table — see SUPABASE_SETUP.md.</p>
          <Button size="sm" variant="secondary" icon={<LogOut size={13} />} onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      )}

      {session.status === 'admin' &&
        (loading ? (
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} variant="block" className="h-40 w-full" />
            ))}
          </div>
        ) : loadError ? (
          <EmptyState icon={<ShieldAlert size={26} strokeWidth={1.5} />} title="Couldn't load pending requests" description={loadError} />
        ) : requests.length === 0 ? (
          <EmptyState icon={<CircleCheck size={26} strokeWidth={1.5} />} title="Nothing pending" description="No appetite update requests are waiting for review." />
        ) : (
          <div className="flex flex-col gap-4">
            {requests.map((r) => (
              <RequestReviewCard key={r.id} request={r} onReviewed={load} />
            ))}
          </div>
        ))}
    </PageContainer>
  );
}
