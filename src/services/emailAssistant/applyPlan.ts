import type { Account, MissingItem, MissingItemStatus, UploadedDocument } from '../../types';
import type { MissingItemSeed } from '../../state/useAccountsStore';
import { findRequirement } from '../workflow/requirementKey';
import { isSameAgency } from './matchAccount';
import type { Suggestion } from './suggestActions';

/**
 * Carries out ONLY the suggestions the agent approved, through the app's existing store actions
 * (the same ones the account workspace uses — the same access rules, activity log and cloud save).
 * Deliberately absent: marking anything received, verifying, marking a request sent, and sending
 * email. Those stay manual steps on the account. An approved attachment goes through the account's
 * normal upload (the same file checks), and a file already on the account is never imported twice.
 */
export interface EmailActionStore {
  accounts: Account[];
  missingItems: Record<string, MissingItem[]>;
  documents: Record<string, UploadedDocument[]>;
  addFiles: (accountId: string, files: File[]) => string[];
  addMissingItems: (accountId: string, seeds: MissingItemSeed[]) => string[];
  updateMissingItem: (accountId: string, itemId: string, patch: Partial<Pick<MissingItem, 'instructions'>>) => void;
  setItemStatus: (accountId: string, itemId: string, status: MissingItemStatus) => void;
  recordCarrierRequest: (accountId: string, quoteId: string, input: { label: string; type: MissingItem['type']; notes?: string }) => string;
  createClientRequest: (accountId: string, input: { clientKey: string; itemIds: string[]; contactId?: string; followUpDate?: string; token?: string }) => Promise<{ ok: true; requestId: string; link: string } | { ok: false; message: string }>;
  followUpClientRequest: (requestId: string, nextFollowUp: string) => Promise<{ ok: boolean; message?: string }>;
  setItemsFollowUp: (accountId: string, itemIds: string[], followUpDate: string) => void;
  addFollowUp: (accountId: string, input: { subject: string; dueDate: string; notes?: string }) => string;
  addAccountNote: (accountId: string, text: string) => void;
}

export interface ApplyOutcome {
  suggestionId: string;
  ok: boolean;
  message: string;
  /** For a created request: the secure link, to put in the email. */
  link?: string;
  requestId?: string;
  /** For imported attachments: the new documents, and which attachments they came from. */
  importedDocumentIds?: string[];
  importedIndexes?: number[];
}

export interface ImportDeps {
  /** The attachment's file (null if it can't be rebuilt). */
  fileFor: (index: number) => File | null;
  /** The account's normal upload check. */
  precheck: (file: File) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** SHA-256 of a file, to refuse one already on the account. */
  hash: (file: File) => Promise<string | undefined>;
}

export async function applyPlan(
  store: () => EmailActionStore,
  accountId: string,
  approved: Suggestion[],
  opts: { agencyId?: string | null; verifiedOutsideEmail: boolean; requiresVerification: boolean; clientKey: () => string; emailSubject: string; imports?: ImportDeps }
): Promise<ApplyOutcome[]> {
  const account = store().accounts.find((a) => a.id === accountId);
  if (!account) return [{ suggestionId: '*', ok: false, message: 'That account isn’t available to you.' }];
  if (account.archived) return [{ suggestionId: '*', ok: false, message: 'That account is archived. Restore it first.' }];
  if (!isSameAgency(account, opts.agencyId)) return [{ suggestionId: '*', ok: false, message: 'That account belongs to another agency.' }];
  const changing = approved.filter((s) => s.changesAccount);
  if (changing.length && opts.requiresVerification && !opts.verifiedOutsideEmail) {
    return [{ suggestionId: '*', ok: false, message: 'This email has warning signs. Confirm you verified it outside email before changing the account.' }];
  }

  const out: ApplyOutcome[] = [];
  const itemFor: Record<string, string> = {};
  const items = () => store().missingItems[accountId] ?? [];
  const source = `From email “${opts.emailSubject || '(no subject)'}”`;

  // Checklist first — the request below needs the item ids.
  for (const s of approved) {
    if (s.kind !== 'add_to_checklist') continue;
    const done: string[] = [];
    for (const a of s.additions) {
      const { doc } = a;
      if (s.quoteId) {
        // Creates the requirement, or links the carrier to the existing one (a waived one reopens).
        const id = store().recordCarrierRequest(accountId, s.quoteId, { label: doc.label, type: doc.type, notes: source });
        if (id) itemFor[doc.requirementKey] = id;
      } else if (a.action === 'reopen' && a.itemId) {
        store().setItemStatus(accountId, a.itemId, 'missing');
        itemFor[doc.requirementKey] = a.itemId;
      } else if (a.action === 'add') {
        const [id] = store().addMissingItems(accountId, [{ label: doc.label, type: doc.type, templateKey: doc.templateKey, notes: source }]);
        if (id) itemFor[doc.requirementKey] = id;
      }
      const id = itemFor[doc.requirementKey];
      if (id && doc.instructions && !items().find((i) => i.id === id)?.instructions) store().updateMissingItem(accountId, id, { instructions: doc.instructions });
      if (id) done.push(doc.label);
    }
    out.push({ suggestionId: s.id, ok: done.length === s.additions.length, message: done.length ? `Checklist updated: ${done.join(', ')}.` : 'Nothing was added.' });
  }

  for (const s of approved) {
    if (s.kind === 'request_from_client') {
      if (s.blocked) {
        out.push({ suggestionId: s.id, ok: false, message: s.blocked });
        continue;
      }
      const ids: string[] = [];
      for (const doc of s.docs) {
        let id: string | undefined = itemFor[doc.requirementKey] ?? s.existingItemIds[doc.requirementKey];
        if (!id || !items().some((i) => i.id === id)) {
          id = findRequirement(items(), { label: doc.label, templateKey: doc.templateKey })?.id ?? store().addMissingItems(accountId, [{ label: doc.label, type: doc.type, templateKey: doc.templateKey, notes: source }])[0];
        }
        const item = items().find((i) => i.id === id);
        if (item?.status === 'waived') store().setItemStatus(accountId, item.id, 'missing');
        if (item && doc.instructions && !item.instructions) store().updateMissingItem(accountId, item.id, { instructions: doc.instructions });
        if (id && !ids.includes(id)) ids.push(id);
      }
      const res = await store().createClientRequest(accountId, { clientKey: opts.clientKey(), itemIds: ids, contactId: s.contactId, followUpDate: s.followUpDate, token: s.token });
      out.push(
        res.ok
          ? { suggestionId: s.id, ok: true, message: 'Upload link created (Prepared). Open the draft in Gmail, send it, then mark the request sent on the account.', link: res.link, requestId: res.requestId }
          : { suggestionId: s.id, ok: false, message: res.message }
      );
    } else if (s.kind === 'follow_up_request') {
      if (s.blocked) {
        out.push({ suggestionId: s.id, ok: false, message: s.blocked });
        continue;
      }
      if (s.requestId) {
        const res = await store().followUpClientRequest(s.requestId, s.nextFollowUp);
        out.push({ suggestionId: s.id, ok: res.ok, message: res.ok ? 'Reminder recorded on the existing request.' : (res.message ?? 'Couldn’t record the reminder.') });
      } else {
        store().setItemsFollowUp(accountId, s.itemIds, s.nextFollowUp);
        out.push({ suggestionId: s.id, ok: true, message: 'Follow-up date moved.' });
      }
    } else if (s.kind === 'schedule_follow_up') {
      const id = store().addFollowUp(accountId, { subject: s.subject, dueDate: s.dueDate, notes: s.notes });
      out.push({ suggestionId: s.id, ok: !!id, message: id ? 'Follow-up scheduled — it will show on Today’s Plate.' : 'Couldn’t schedule the follow-up.' });
    }
  }

  // Approved attachments → the account's documents (each through the normal upload check).
  for (const s of approved) {
    if (s.kind !== 'import_attachments' || !s.changesAccount) continue;
    const chosen = s.attachments.filter((a) => a.importable && s.selected.includes(a.index));
    if (!chosen.length) continue;
    if (!opts.imports) {
      out.push({ suggestionId: s.id, ok: false, message: 'Attachments can’t be imported here.' });
      continue;
    }
    const onAccount = new Set((store().documents[accountId] ?? []).map((d) => d.contentSha256).filter(Boolean));
    const files: File[] = [];
    const indexes: number[] = [];
    const skipped: string[] = [];
    for (const a of chosen) {
      const file = opts.imports.fileFor(a.index);
      if (!file) {
        skipped.push(`${a.name} (couldn’t be read)`);
        continue;
      }
      const check = await opts.imports.precheck(file);
      if (!check.ok) {
        skipped.push(check.reason);
        continue;
      }
      const hash = await opts.imports.hash(file);
      if (hash && onAccount.has(hash)) {
        skipped.push(`${a.name} (already on the account)`);
        continue;
      }
      if (hash) onAccount.add(hash);
      files.push(file);
      indexes.push(a.index);
    }
    const ids = files.length ? store().addFiles(accountId, files) : [];
    const imported = files.map((f) => f.name);
    out.push({
      suggestionId: s.id,
      ok: ids.length === files.length && skipped.length === 0,
      message: [imported.length ? `Imported ${imported.join(', ')} — check ${imported.length === 1 ? 'it' : 'them'} on Documents, then verify on the checklist.` : '', skipped.length ? `Not imported: ${skipped.join('; ')}.` : ''].filter(Boolean).join(' '),
      importedDocumentIds: ids,
      importedIndexes: indexes,
    });
  }

  // The note last, so it's only written once the rest went through.
  for (const s of approved) {
    if (s.kind !== 'record_note') continue;
    store().addAccountNote(accountId, s.text);
    out.push({ suggestionId: s.id, ok: true, message: 'Note added to the account.' });
  }
  return out;
}
