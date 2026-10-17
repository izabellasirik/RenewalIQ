import { useState, type FormEvent } from 'react';
import { Pencil, StickyNote } from 'lucide-react';
import type { AccountNote } from '../../types';
import { Button, Card, CardBody } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { inputClass } from './formStyles';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Human-written notes about the account — newest first, each with its date/time and author, and
 * editable. Kept apart from Activity (the automatic log): adding or editing a note isn't an event.
 */
export function NotesPanel({ accountId, notes }: { accountId: string; notes: AccountNote[] }) {
  const addAccountNote = useAccountsStore((s) => s.addAccountNote);
  const [draft, setDraft] = useState('');
  const sorted = [...notes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    addAccountNote(accountId, draft);
    setDraft('');
  }

  return (
    <Card>
      <CardBody className="pt-5">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Add a note about this account…"
            aria-label="New note"
            className={inputClass}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
            }}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!draft.trim()}>
              Add note
            </Button>
          </div>
        </form>

        {sorted.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-1.5 py-6 text-center">
            <StickyNote size={22} className="text-[var(--color-ink-300)]" />
            <p className="text-sm text-[var(--color-ink-500)]">No notes yet.</p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-[var(--color-ink-100)]">
            {sorted.map((n) => (
              <NoteRow key={n.id} accountId={accountId} note={n} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function NoteRow({ accountId, note }: { accountId: string; note: AccountNote }) {
  const updateAccountNote = useAccountsStore((s) => s.updateAccountNote);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);

  function save() {
    if (text.trim()) updateAccountNote(accountId, note.id, text);
    setEditing(false);
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-[var(--color-ink-500)]">
          <span className="font-medium text-[var(--color-ink-700)]">{note.authorName}</span> · {when(note.createdAt)}
          {note.updatedAt && (
            <span className="text-[var(--color-ink-400)]">
              {' '}
              · edited {when(note.updatedAt)}
              {note.updatedByName && note.updatedByName !== note.authorName ? ` by ${note.updatedByName}` : ''}
            </span>
          )}
        </p>
        {!editing && (
          <button
            onClick={() => {
              setText(note.text);
              setEditing(true);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer"
            aria-label="Edit note"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-1.5 flex flex-col gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus className={inputClass} aria-label="Edit note" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={!text.trim()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-line text-sm text-[var(--color-ink-800)]">{note.text}</p>
      )}
    </li>
  );
}
