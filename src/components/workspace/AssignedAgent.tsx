import { useState } from 'react';
import { UserRound } from 'lucide-react';
import type { Account } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { agentLabel } from '../../services/agency/agentLabel';
import { cn } from '../../utils/cn';

/**
 * Who the account is assigned to — the one assignment control, used on the Workspace header, the
 * Account card and the Risk Profile. In an agency the database's assigned agent (a user id, enforced
 * by RLS) is what's shown and changed; an admin gets the dropdown (assignAccountToAgent, which also
 * logs it to Activity), an agent sees it read-only, highlighted when it's theirs. Outside an agency
 * it falls back to the display-only "assigned broker" label, as before.
 */
export function AssignedAgent({ account, variant = 'chip' }: { account: Account; variant?: 'chip' | 'plain' }) {
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const members = useAccountsStore((s) => s.agencyMembers);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const assignAccountToAgent = useAccountsStore((s) => s.assignAccountToAgent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = agentLabel(account, members, currentUserId);
  const mine = !!account.assignedUserId && account.assignedUserId === currentUserId;
  const isAdmin = agencyAccess?.role === 'admin';

  async function reassign(userId: string) {
    setBusy(true);
    setError(null);
    const res = await assignAccountToAgent(account.id, userId || null);
    setBusy(false);
    if (!res.ok) setError(res.message);
  }

  const control = isAdmin ? (
    <select
      value={account.assignedUserId ?? ''}
      onChange={(e) => void reassign(e.target.value)}
      disabled={busy}
      className="rounded-md border border-[var(--color-ink-200)] bg-white px-2 py-0.5 text-sm font-medium text-[var(--color-ink-900)] outline-none focus:border-[var(--color-brand-500)] disabled:opacity-60 cursor-pointer"
      aria-label="Assigned agent"
    >
      <option value="">Unassigned</option>
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
          {m.userId === currentUserId ? ' (you)' : m.role === 'admin' ? ' (admin)' : ''}
        </option>
      ))}
    </select>
  ) : label ? (
    <span className="min-w-0 font-semibold text-[var(--color-ink-900)] [overflow-wrap:anywhere]" title={agencyAccess ? undefined : account.assignedBroker?.email}>
      {mine ? 'You' : breakableEmail(label)}
    </span>
  ) : (
    <span className="italic text-[var(--color-ink-400)]">Unassigned</span>
  );

  if (variant === 'plain') {
    return (
      <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
        {control}
        {error && <span className="basis-full text-xs text-[var(--color-danger-600)]">{error}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm',
          mine ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]' : 'border-[var(--color-ink-200)] bg-white text-[var(--color-ink-600)]'
        )}
      >
        <UserRound size={13} />
        {mine && !isAdmin ? 'Assigned to you' : <>Assigned to {control}</>}
      </span>
      {error && <span className="basis-full text-xs text-[var(--color-danger-600)]">{error}</span>}
    </span>
  );
}

/** An email wraps before the "@" (not mid-word) when it doesn't fit, e.g. in the narrow Account card. */
function breakableEmail(text: string) {
  const at = text.indexOf('@');
  if (at <= 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <wbr />
      {text.slice(at)}
    </>
  );
}
