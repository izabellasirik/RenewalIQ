import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useAccountsStore } from '../../state/useAccountsStore';

/** The workspace header's client name, editable in place (Enter or click away saves, Esc cancels). */
export function EditableAccountName({ accountId, name }: { accountId: string; name: string }) {
  const updateAccountInfo = useAccountsStore((s) => s.updateAccountInfo);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  function start() {
    setDraft(name);
    setEditing(true);
  }

  function save() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) updateAccountInfo(accountId, { namedInsured: trimmed });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          aria-label="Client name"
          className="w-full min-w-0 max-w-xl rounded-lg border border-[var(--color-brand-500)] px-2 py-1 text-2xl font-semibold tracking-tight text-[var(--color-ink-900)] outline-none ring-2 ring-[var(--color-brand-500)]/15"
        />
        {/* onMouseDown so these fire before the input's blur-save. */}
        <button onMouseDown={(e) => { e.preventDefault(); save(); }} className="shrink-0 rounded-md bg-[var(--color-brand-800)] p-1.5 text-white cursor-pointer" aria-label="Save name">
          <Check size={16} />
        </button>
        <button onMouseDown={(e) => { e.preventDefault(); setEditing(false); }} className="shrink-0 rounded-md bg-[var(--color-ink-100)] p-1.5 text-[var(--color-ink-500)] cursor-pointer" aria-label="Cancel">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <button onClick={start} className="group flex min-w-0 items-center gap-2 text-left cursor-pointer" title="Edit client name">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink-900)]">{name}</h1>
      <Pencil size={15} className="shrink-0 text-[var(--color-ink-300)] group-hover:text-[var(--color-brand-700)]" />
    </button>
  );
}
