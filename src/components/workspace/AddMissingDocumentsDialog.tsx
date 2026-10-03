import { useMemo, useState, type FormEvent } from 'react';
import { Check, Plus, Send, X } from 'lucide-react';
import { Button, Modal } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { CHECKLIST_TEMPLATES, expandTemplate } from '../../services/workflow/checklistTemplates';
import { RequestItemsDialog } from './RequestItemsDialog';
import { inputClass, labelClass } from './formStyles';
import { cn } from '../../utils/cn';

interface Pick {
  label: string;
  templateKey?: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * "Add missing documents" (Workspace → Overview → Action required): the broker picks or names the
 * documents this account still needs, then either just adds them to the checklist (they show up in
 * Action required as "not yet requested") or adds them and goes straight to requesting them from
 * the client — the same request flow as everywhere else (email, secure upload link, follow-up date).
 */
export function AddMissingDocumentsDialog({ accountId, open, onClose }: { accountId: string; open: boolean; onClose: () => void }) {
  const { profile, items } = useAccountWorkflow(accountId);
  const addMissingItems = useAccountsStore((s) => s.addMissingItems);
  const [picked, setPicked] = useState<Pick[]>([]);
  const [custom, setCustom] = useState('');
  const [requestIds, setRequestIds] = useState<string[] | null>(null);

  // Common documents not already on the checklist (MVRs one per driver on the Risk Profile).
  const suggestions = useMemo(() => {
    const onChecklist = new Set(items.filter((i) => i.status !== 'waived').flatMap((i) => [i.templateKey, norm(i.label)]).filter(Boolean));
    return CHECKLIST_TEMPLATES.flatMap((t) => expandTemplate(t, profile)).filter((s) => !onChecklist.has(s.templateKey) && !onChecklist.has(norm(s.label)));
  }, [items, profile]);

  const isPicked = (label: string) => picked.some((p) => norm(p.label) === norm(label));
  const toggle = (p: Pick) => setPicked((all) => (isPicked(p.label) ? all.filter((x) => norm(x.label) !== norm(p.label)) : [...all, p]));

  function addCustom(e?: FormEvent) {
    e?.preventDefault();
    const label = custom.trim();
    if (!label) return;
    if (!isPicked(label)) setPicked((all) => [...all, { label }]);
    setCustom('');
  }

  function close() {
    setPicked([]);
    setCustom('');
    onClose();
  }

  /** Adds what's picked (plus anything still typed in the box) and returns the new checklist item ids. */
  function addPicked(): string[] {
    const typed = custom.trim();
    const all = typed && !isPicked(typed) ? [...picked, { label: typed }] : picked;
    if (all.length === 0) return [];
    return addMissingItems(
      accountId,
      all.map((p) => ({ label: p.label, type: 'document' as const, ...(p.templateKey ? { templateKey: p.templateKey } : {}) }))
    );
  }

  const count = picked.length + (custom.trim() && !isPicked(custom) ? 1 : 0);

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="Add missing documents"
        subtitle="Pick what this account still needs. You can request them from the client now, or add them to the checklist and request later."
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus size={14} />}
              disabled={count === 0}
              onClick={() => {
                addPicked();
                close();
              }}
            >
              Add to checklist
            </Button>
            <Button
              size="sm"
              icon={<Send size={14} />}
              disabled={count === 0}
              onClick={() => {
                const ids = addPicked();
                close();
                if (ids.length) setRequestIds(ids);
              }}
            >
              {count > 1 ? `Add & request ${count} from client` : 'Add & request from client'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4" data-testid="add-missing-documents">
          {suggestions.length > 0 && (
            <div>
              <p className={labelClass}>Common documents</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {suggestions.map((s) => {
                  const on = isPicked(s.label);
                  return (
                    <button
                      key={s.templateKey}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle({ label: s.label, templateKey: s.templateKey })}
                      className={cn(
                        'flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        on
                          ? 'border-[var(--color-brand-700)] bg-[var(--color-brand-700)] text-white'
                          : 'border-[var(--color-ink-200)] bg-white text-[var(--color-ink-700)] hover:border-[var(--color-ink-300)]'
                      )}
                    >
                      {on ? <Check size={12} /> : <Plus size={12} />}
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <form onSubmit={addCustom}>
            <label className={labelClass} htmlFor="missing-doc-name">
              Other document
            </label>
            <div className="mt-1 flex gap-2">
              <input id="missing-doc-name" value={custom} onChange={(e) => setCustom(e.target.value)} className={inputClass} placeholder="e.g. 2025 IFTA, signed W-9, lease agreement" autoFocus />
              <Button type="submit" variant="secondary" size="sm" icon={<Plus size={14} />} disabled={!custom.trim()}>
                Add
              </Button>
            </div>
          </form>

          {picked.length > 0 && (
            <div>
              <p className={labelClass}>Adding</p>
              <ul className="mt-1 flex flex-col gap-1" data-testid="missing-documents-picked">
                {picked.map((p) => (
                  <li key={norm(p.label)} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-1.5 text-sm text-[var(--color-ink-800)]">
                    <span className="truncate">{p.label}</span>
                    <button type="button" onClick={() => toggle(p)} aria-label={`Remove ${p.label}`} className="cursor-pointer text-[var(--color-ink-400)] hover:text-[var(--color-ink-700)]">
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
      <RequestItemsDialog accountId={accountId} itemIds={requestIds ?? []} open={!!requestIds} onClose={() => setRequestIds(null)} />
    </>
  );
}
