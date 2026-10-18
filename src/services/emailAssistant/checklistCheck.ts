import type { DocumentRequest, MissingItem } from '../../types';
import { isOpenRequest } from '../../types/documentRequest';
import { findRequirement } from '../workflow/requirementKey';
import { formatShortDate } from '../workflow/dates';
import type { ExtractedDocument } from './types';

/**
 * Each document the email names, against the account's own checklist and open client requests —
 * the same requirement identity the checklist uses, so a document already on the checklist (or
 * already asked for) is never added or requested twice.
 */
export type ChecklistOutcome = 'new' | 'on_checklist' | 'already_requested' | 'received_unverified' | 'received' | 'waived';

export interface DocumentCheck {
  doc: ExtractedDocument;
  item?: MissingItem;
  outcome: ChecklistOutcome;
  /** The open client request that already asks for it (follow up on that one — never a second request). */
  openRequest?: DocumentRequest;
  /** Received, but the email asks for a current/updated copy. */
  wantsNewerCopy: boolean;
  message: string;
}

const NEWER = /\b(?:updated|current(?:ly valued)?|new(?:er)?|recent|latest|refreshed|valued within)\b/i;

export function openRequestFor(item: MissingItem, requests: DocumentRequest[]): DocumentRequest | undefined {
  return requests.filter(isOpenRequest).find((r) => r.items.some((i) => i.missingItemId === item.id && i.status === 'requested'));
}

export function checkChecklist(docs: ExtractedDocument[], items: MissingItem[], requests: DocumentRequest[]): DocumentCheck[] {
  return docs.map((doc) => {
    const item = findRequirement(items, { label: doc.label, templateKey: doc.templateKey });
    if (!item) return { doc, outcome: 'new', wantsNewerCopy: false, message: 'Not on the checklist yet' };
    const openRequest = openRequestFor(item, requests);
    if (item.status === 'received') {
      const wantsNewerCopy = doc.stance === 'requested' && NEWER.test(doc.evidence);
      if (item.verification === 'pending') return { doc, item, outcome: 'received_unverified', wantsNewerCopy, message: 'Received but not verified yet — check it before sending it on' };
      return {
        doc,
        item,
        outcome: 'received',
        wantsNewerCopy,
        message: `Already received${item.receivedAt ? ` (${formatShortDate(item.receivedAt.slice(0, 10))})` : ''}${wantsNewerCopy ? ' — the email asks for a newer copy' : ''}`,
      };
    }
    if (item.status === 'waived') return { doc, item, outcome: 'waived', wantsNewerCopy: false, message: `Marked ${item.waiveKind === 'not_applicable' ? 'not applicable' : 'waived'} on this account${item.waiveReason ? ` (${item.waiveReason})` : ''}` };
    if (openRequest) {
      const when = openRequest.sentAt ?? openRequest.requestedAt;
      const prepared = openRequest.deliveryStatus === 'prepared';
      return {
        doc,
        item,
        outcome: 'already_requested',
        openRequest,
        wantsNewerCopy: false,
        message: prepared
          ? `A request link for it was prepared ${formatShortDate(when.slice(0, 10))} but not marked sent`
          : `Already requested from ${openRequest.contactName ?? 'the client'} on ${formatShortDate(when.slice(0, 10))}${openRequest.followUpCount ? ` (${openRequest.followUpCount} follow-up${openRequest.followUpCount === 1 ? '' : 's'})` : ''}`,
      };
    }
    if (item.status === 'requested') return { doc, item, outcome: 'already_requested', wantsNewerCopy: false, message: `Already requested${item.requestedAt ? ` on ${formatShortDate(item.requestedAt.slice(0, 10))}` : ''}` };
    return { doc, item, outcome: 'on_checklist', wantsNewerCopy: false, message: 'On the checklist, not requested yet' };
  });
}
