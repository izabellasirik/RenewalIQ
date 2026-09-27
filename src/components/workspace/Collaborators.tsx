import { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import type { Account } from '../../types';
import { useAccountsStore } from '../../state/useAccountsStore';
import { Button } from '../ui';

/**
 * Team members helping on an account besides its primary assigned broker, and who it was
 * originally assigned to. An agency admin or the primary broker can change the collaborators (the
 * database enforces it — 0026); everyone else sees them read-only. Agency accounts only.
 */
export function Collaborators({ account }: { account: Account }) {
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const members = useAccountsStore((s) => s.agencyMembers);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const setCollaborators = useAccountsStore((s) => s.setCollaborators);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!agencyAccess || !account.agencyId) return null;
  const ids = account.collaboratorIds ?? [];
  const nameOf = (id: string) => (id === currentUserId ? 'You' : (members.find((m) => m.userId === id)?.name ?? 'Team member'));
  const canEdit = agencyAccess.role === 'admin' || (!!currentUserId && account.assignedUserId === currentUserId);
  const original = account.originalAssignedUserId && account.originalAssignedUserId !== account.assignedUserId ? nameOf(account.originalAssignedUserId) : null;
  const choices = members.filter((m) => m.userId !== account.assignedUserId);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await setCollaborators(account.id, picked);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-ink-600)]">
      <span className="inline-flex items-center gap-1.5">
        <Users size={13} className="text-[var(--color-ink-400)]" />
        Collaborators:
        <span className="font-medium text-[var(--color-ink-900)]">{ids.length ? ids.map(nameOf).join(', ') : <span className="font-normal italic text-[var(--color-ink-400)]">none</span>}</span>
        {canEdit && (
          <button
            onClick={() => {
              setPicked(ids);
              setError(null);
              setOpen((v) => !v);
            }}
            className="rounded-md px-1.5 py-0.5 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer"
            aria-expanded={open}
          >
            {ids.length ? 'Edit' : 'Add'}
          </button>
        )}
      </span>
      {original && <span className="text-xs text-[var(--color-ink-500)]">Originally assigned: {original}</span>}
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-[var(--color-ink-100)] bg-white p-3 [box-shadow:var(--shadow-popover)]" role="dialog" aria-label="Collaborators">
          <p className="mb-2 text-xs text-[var(--color-ink-500)]">Team members helping on this account. They can see and work on it; the assigned broker stays the owner.</p>
          {choices.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-400)]">No other team members yet.</p>
          ) : (
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {choices.map((m) => (
                <li key={m.userId}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-[var(--color-ink-50)]">
                    <input type="checkbox" checked={picked.includes(m.userId)} onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, m.userId] : cur.filter((x) => x !== m.userId)))} />
                    {m.name}
                    {m.userId === currentUserId ? ' (you)' : m.role === 'admin' ? ' (admin)' : ''}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="mt-2 text-xs text-[var(--color-danger-600)]">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
