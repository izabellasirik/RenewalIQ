import { Link } from 'react-router-dom';
import { Mail, TriangleAlert } from 'lucide-react';
import { Button } from '../ui';
import { describeReasons, type AccountDuplicate, type AccountIdentity } from '../../services/accounts/duplicateCheck';

/**
 * "Possible existing account": what the check found, and the broker's choice. Never blocks or merges.
 * An account the broker can't open shows only its name, its assigned broker and why it matched.
 * "Contact" only where RenewalIQ already gives this user that broker's email (agency admins' member list).
 */
export function DuplicateAccountWarning({
  identity,
  matches,
  complete,
  currentUserId,
  memberEmail,
  onCreateAnyway,
  onCancel,
  busy,
}: {
  identity: AccountIdentity;
  matches: AccountDuplicate[];
  complete: boolean;
  currentUserId: string | null;
  memberEmail: (userId: string) => string | null;
  onCreateAnyway?: () => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-warning-500)] bg-[var(--color-warning-100)] p-3 text-sm" role="alert" data-testid="duplicate-warning">
      <p className="flex items-center gap-2 font-semibold text-[var(--color-ink-900)]">
        <TriangleAlert size={15} aria-hidden className="text-[var(--color-warning-600)]" />
        {matches.length ? 'This may already be an account in your agency' : 'Only some accounts could be checked'}
      </p>
      {!complete && (
        <p className="mt-1 text-xs text-[var(--color-ink-600)]">
          Only the accounts you can see were checked — your agency’s other accounts couldn’t be compared here.
        </p>
      )}
      {matches.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {matches.map((m) => {
            const mine = !!currentUserId && m.assignedUserId === currentUserId;
            const email = !mine && m.assignedUserId ? memberEmail(m.assignedUserId) : null;
            return (
              <li key={m.accountId ?? `${m.namedInsured}-${m.assignedUserId}`} className="rounded-md bg-white/70 p-2" data-duplicate-can-open={m.canOpen}>
                <p className="font-medium text-[var(--color-ink-900)]">
                  {m.namedInsured}
                  {m.archived && <span className="ml-1 text-xs font-normal text-[var(--color-ink-500)]">(archived)</span>}
                </p>
                <p className="text-xs text-[var(--color-ink-600)]">
                  {mine ? 'Assigned to you' : m.assignedName ? `Assigned to ${m.assignedName}` : 'Assigned broker unknown'}
                  {!m.canOpen && ' · You don’t have access to this account'}
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs text-[var(--color-ink-700)]">
                  {describeReasons(m, identity).map((r) => <li key={r}>{r}</li>)}
                </ul>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {m.canOpen && m.accountId && (
                    <Link to={`/accounts/${m.accountId}`} className="font-medium text-[var(--color-brand-700)] underline">
                      Review existing account
                    </Link>
                  )}
                  {email && (
                    <a
                      href={`mailto:${email}?subject=${encodeURIComponent(`Account in RenewalIQ: ${m.namedInsured}`)}`}
                      className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-700)] underline"
                    >
                      <Mail size={11} aria-hidden /> Contact {m.assignedName ?? 'assigned broker'}
                    </a>
                  )}
                  {!m.canOpen && !email && !mine && m.assignedName && <span className="text-[var(--color-ink-500)]">Ask {m.assignedName} or an agency admin before starting a new account.</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(onCreateAnyway || onCancel) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onCreateAnyway && (
            <Button size="sm" variant="secondary" onClick={onCreateAnyway} disabled={busy} data-testid="create-separate-account">
              {busy ? 'Checking…' : 'Create separate account'}
            </Button>
          )}
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>}
        </div>
      )}
    </div>
  );
}
