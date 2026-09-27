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
// Small chevron for the borderless dropdown inside the chip (ink-400).
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

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
      className={cn(
        'text-sm font-medium text-[var(--color-ink-900)] outline-none disabled:opacity-60 cursor-pointer',
        // Inside the chip it's just the chip's text (the chip is the box); on its own it gets a border.
        variant === 'chip'
          ? '-my-0.5 appearance-none rounded-full bg-transparent py-0.5 pl-1 pr-5 hover:bg-[var(--color-ink-100)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/20'
          : 'w-full min-w-0 max-w-full truncate rounded-md border border-[var(--color-ink-200)] bg-white px-2 py-0.5 focus:border-[var(--color-brand-500)]'
      )}
      style={variant === 'chip' ? { backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.3rem center', backgroundSize: '0.75rem', fieldSizing: 'content' } as React.CSSProperties : undefined}
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
      <span className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-1.5">
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
