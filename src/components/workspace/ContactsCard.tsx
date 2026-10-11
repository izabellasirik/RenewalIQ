import { useState, type FormEvent } from 'react';
import { Mail, Phone, Plus, Star, Trash2, Pencil, Users } from 'lucide-react';
import type { Contact } from '../../types';
import { Button, Card, CardBody, OverflowMenu } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { inputClass, labelClass } from './formStyles';

type Draft = Omit<Contact, 'id'>;
const EMPTY: Draft = { name: '', role: '', email: '', phone: '', primary: false };

export function ContactsCard({ accountId }: { accountId: string }) {
  const { contacts } = useAccountWorkflow(accountId);
  const addContact = useAccountsStore((s) => s.addContact);
  const updateContact = useAccountsStore((s) => s.updateContact);
  const deleteContact = useAccountsStore((s) => s.deleteContact);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  function startNew() {
    setDraft(EMPTY);
    setEditingId('new');
  }

  function startEdit(c: Contact) {
    setDraft({ name: c.name, role: c.role ?? '', email: c.email ?? '', phone: c.phone ?? '', primary: c.primary });
    setEditingId(c.id);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const clean: Draft = {
      name: draft.name.trim(),
      role: draft.role?.trim() || undefined,
      email: draft.email?.trim() || undefined,
      phone: draft.phone?.trim() || undefined,
      primary: draft.primary || undefined,
    };
    if (editingId === 'new') addContact(accountId, clean);
    else if (editingId) updateContact(accountId, editingId, clean);
    setEditingId(null);
  }

  const form = (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2 rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 sm:grid-cols-2">
      <div>
        <label className={labelClass}>Name *</label>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} autoFocus />
      </div>
      <div>
        <label className={labelClass}>Role / title</label>
        <input value={draft.role ?? ''} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className={inputClass} placeholder="Owner, Safety manager…" />
      </div>
      <div>
        <label className={labelClass}>Email</label>
        <input type="email" value={draft.email ?? ''} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Phone</label>
        <input value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={inputClass} />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-600)]">
        <input type="checkbox" checked={!!draft.primary} onChange={(e) => setDraft({ ...draft, primary: e.target.checked })} />
        Primary contact
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!draft.name.trim()}>
          Save
        </Button>
      </div>
    </form>
  );

  return (
    <Card>
      <CardBody className="pt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
            <Users size={16} className="text-[var(--color-ink-500)]" />
            Contacts
          </h3>
          {editingId === null && (
            <button onClick={startNew} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer">
              <Plus size={12} /> Add contact
            </button>
          )}
        </div>

        <ul className="mt-3 flex flex-col gap-2">
          {contacts.length === 0 && editingId !== 'new' && <li className="text-sm italic text-[var(--color-ink-400)]">No contacts yet. Add who you'll be requesting documents from.</li>}
          {contacts.map((c) =>
            editingId === c.id ? (
              <li key={c.id}>{form}</li>
            ) : (
              <li key={c.id} className="flex items-start justify-between gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-[var(--color-ink-800)]">
                    {c.name}
                    {c.role && <span className="font-normal text-[var(--color-ink-500)]">· {c.role}</span>}
                    {c.primary && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-accent-100)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent-600)]">
                        <Star size={9} /> Primary
                      </span>
                    )}
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--color-ink-500)]">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="inline-flex min-w-0 items-center gap-1 hover:text-[var(--color-brand-700)]">
                        <Mail size={11} className="shrink-0" />
                        <span className="truncate">{c.email}</span>
                      </a>
                    )}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-[var(--color-brand-700)]">
                        <Phone size={11} /> {c.phone}
                      </a>
                    )}
                  </div>
                </div>
                <OverflowMenu
                  items={[
                    { key: 'edit', label: 'Edit', icon: <Pencil size={14} />, onSelect: () => startEdit(c) },
                    ...(!c.primary ? [{ key: 'primary', label: 'Make primary', icon: <Star size={14} />, onSelect: () => updateContact(accountId, c.id, { primary: true }) }] : []),
                    { key: 'delete', label: 'Remove', icon: <Trash2 size={14} />, tone: 'danger' as const, onSelect: () => deleteContact(accountId, c.id) },
                  ]}
                />
              </li>
            )
          )}
          {editingId === 'new' && <li>{form}</li>}
        </ul>
      </CardBody>
    </Card>
  );
}
