import type { Account, Contact, FollowUp, MarketQuote, MissingItem } from '../../types';
import { AWAITING_CARRIER_STATUSES, QUOTE_STATUS_LABELS } from '../../types';
import { daysBetween, describeDue, formatShortDate, todayKey } from './dates';
import { carriersFor, forwardedAt } from './requirementKey';

/**
 * ACCOUNT STATE → NEXT ACTION. Everything on Today's Plate and every "what happens next" hint on
 * the Account Workspace is derived here from missing items, market quotes, and dates — there is no
 * separately stored task list to drift out of sync. Changing the underlying record (marking an
 * item received, logging a carrier status) is what clears or creates an action.
 */

export type ActionKind = 'client_follow_up' | 'carrier_follow_up' | 'action_required' | 'ready_to_send' | 'follow_up' | 'renewal';

export type WorkspaceTab = 'overview' | 'checklist' | 'quotes' | 'activity';

export interface ActionItem {
  /** Stable across renders — derived from the record it came from. */
  id: string;
  kind: ActionKind;
  accountId: string;
  accountName: string;
  title: string;
  detail: string;
  /** YYYY-MM-DD this action is due, when it's date-driven. */
  dueDate?: string;
  overdue: boolean;
  tab: WorkspaceTab;
  itemId?: string;
  /** Several requested items followed up together (one request email) — opens as one task. */
  itemIds?: string[];
  quoteId?: string;
  /** A broker-scheduled follow-up (FollowUp.id). */
  followUpId?: string;
}

export interface AccountWorkflowInput {
  account: Account;
  items: MissingItem[];
  quotes: MarketQuote[];
  contacts: Contact[];
  /** The Risk Profile's requested effective date (renewal date), if known. */
  effectiveDate?: string | null;
  /** Broker-scheduled follow-ups. */
  followUps?: FollowUp[];
}

export interface DerivedActions {
  /** Due today or overdue, or undated but actionable now. */
  now: ActionItem[];
  /** Date-driven actions due in the next UPCOMING_WINDOW_DAYS days. */
  upcoming: ActionItem[];
}

export const UPCOMING_WINDOW_DAYS = 7;
export const RENEWAL_WINDOW_DAYS = 45;

const KIND_PRIORITY: Record<ActionKind, number> = {
  ready_to_send: 0,
  action_required: 1,
  carrier_follow_up: 2,
  follow_up: 3,
  client_follow_up: 4,
  renewal: 5,
};

export function deriveAccountActions(input: AccountWorkflowInput, today = todayKey()): DerivedActions {
  const { account, items, quotes, contacts, effectiveDate, followUps = [] } = input;
  const now: ActionItem[] = [];
  const upcoming: ActionItem[] = [];
  if (account.archived) return { now, upcoming };

  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const contactName = (id?: string) => contacts.find((c) => c.id === id)?.name;
  const base = { accountId: account.id, accountName: account.namedInsured };

  function placeDated(action: Omit<ActionItem, 'overdue'> & { dueDate: string }) {
    const diff = daysBetween(today, action.dueDate);
    if (diff <= 0) now.push({ ...action, overdue: diff < 0 });
    else if (diff <= UPCOMING_WINDOW_DAYS) upcoming.push({ ...action, overdue: false });
  }

  let unrequestedChecklist = 0;
  const clientGroups = new Map<string, { item: MissingItem; neededBy: string }[]>();

  for (const item of items) {
    // Every carrier still in play that is waiting on this requirement (one row can serve several).
    const openCarriers = carriersFor(item)
      .map((id) => quoteById.get(id))
      .filter((q): q is MarketQuote => !!q && q.status !== 'declined' && q.status !== 'bound');
    const linkedCarriers = carriersFor(item).map((id) => quoteById.get(id)).filter((q): q is MarketQuote => !!q);
    const names = (qs: MarketQuote[]) => qs.map((q) => q.marketName).join(', ');
    const neededBy = linkedCarriers.length ? ` · Needed by ${names(linkedCarriers)}` : '';

    if (item.status === 'requested' && item.followUpDate) {
      // Grouped below: everything asked of the same person with the same follow-up date is one task.
      const key = `${item.requestedFromContactId ?? ''}|${item.followUpDate}`;
      const g = clientGroups.get(key);
      if (g) g.push({ item, neededBy });
      else clientGroups.set(key, [{ item, neededBy }]);
    } else if (item.status === 'missing') {
      if (openCarriers.length > 0) {
        now.push({
          ...base,
          id: `carrier-req-${item.id}`,
          kind: 'action_required',
          title: `${names(openCarriers)} requested ${item.label}`,
          detail: 'Not yet requested from the client',
          overdue: false,
          tab: 'checklist',
          itemId: item.id,
          quoteId: openCarriers[0].id,
        });
      } else if (linkedCarriers.length === 0) {
        unrequestedChecklist++;
      }
    } else if (item.status === 'received') {
      // One "send" action per carrier that asked for it and hasn't been sent it yet.
      for (const quote of openCarriers) {
        if (forwardedAt(item, quote.id)) continue;
        now.push({
          ...base,
          id: `ready-${item.id}-${quote.id}`,
          kind: 'ready_to_send',
          title: `Send ${item.label} to ${quote.marketName}`,
          detail: `Received${item.receivedAt ? ` ${formatShortDate(item.receivedAt)}` : ''} · ${quote.marketName} is waiting for it`,
          overdue: false,
          tab: 'quotes',
          itemId: item.id,
          quoteId: quote.id,
        });
      }
    }
  }

  for (const [key, group] of clientGroups) {
    const first = group[0].item;
    const who = contactName(first.requestedFromContactId);
    const from = who ? ` from ${who}` : ' from client';
    const requestedAt = group.map((g) => g.item.requestedAt).filter(Boolean).sort()[0];
    const requested = requestedAt ? ` · Requested ${formatShortDate(requestedAt)}` : '';
    if (group.length === 1) {
      placeDated({
        ...base,
        id: `client-fu-${first.id}`,
        kind: 'client_follow_up',
        title: `${first.label} requested${from}`,
        detail: `${describeDue(first.followUpDate!, today)}${requested}${group[0].neededBy}`,
        dueDate: first.followUpDate!,
        tab: 'checklist',
        itemId: first.id,
      });
    } else {
      const labels = group.map((g) => g.item.label);
      placeDated({
        ...base,
        id: `client-fu-group-${key}`,
        kind: 'client_follow_up',
        title: `${group.length} documents requested${from}`,
        detail: `${describeDue(first.followUpDate!, today)}${requested} · ${labels.slice(0, 2).join(', ')}${labels.length > 2 ? ` +${labels.length - 2} more` : ''}`,
        dueDate: first.followUpDate!,
        tab: 'checklist',
        itemIds: group.map((g) => g.item.id),
      });
    }
  }

  for (const f of followUps) {
    if (f.doneAt) continue;
    placeDated({
      ...base,
      id: `followup-${f.id}`,
      kind: 'follow_up',
      title: `Follow up with ${f.subject}`,
      detail: `${describeDue(f.dueDate, today)}${f.notes ? ` · ${f.notes}` : ''}`,
      dueDate: f.dueDate,
      tab: 'overview',
      followUpId: f.id,
    });
  }

  if (unrequestedChecklist > 0) {
    now.push({
      ...base,
      id: `checklist-${account.id}`,
      kind: 'action_required',
      title: `${unrequestedChecklist} checklist item${unrequestedChecklist === 1 ? '' : 's'} not yet requested`,
      detail: 'Request from the client or mark received',
      overdue: false,
      tab: 'checklist',
    });
  }

  const anyBound = quotes.some((q) => q.status === 'bound');

  for (const quote of quotes) {
    if (quote.status === 'preparing') {
      const prep = {
        ...base,
        id: `prep-${quote.id}`,
        kind: 'action_required' as const,
        title: `Submission to ${quote.marketName} not sent yet`,
        tab: 'quotes' as const,
        quoteId: quote.id,
      };
      // With a follow-up date it's scheduled (shows up on that day); without one it needs doing now.
      if (quote.followUpDate) placeDated({ ...prep, detail: describeDue(quote.followUpDate, today), dueDate: quote.followUpDate });
      else now.push({ ...prep, detail: 'Send the submission, then record it as submitted', overdue: false });
    } else if (AWAITING_CARRIER_STATUSES.includes(quote.status)) {
      const sent = quote.submittedAt ? `Submitted ${formatShortDate(quote.submittedAt)} · ` : '';
      if (quote.followUpDate) {
        placeDated({
          ...base,
          id: `carrier-fu-${quote.id}`,
          kind: 'carrier_follow_up',
          title: `${quote.marketName} — ${QUOTE_STATUS_LABELS[quote.status].toLowerCase()}`,
          detail: `${sent}${describeDue(quote.followUpDate, today)}`,
          dueDate: quote.followUpDate,
          tab: 'quotes',
          quoteId: quote.id,
        });
      } else {
        now.push({
          ...base,
          id: `carrier-nofu-${quote.id}`,
          kind: 'carrier_follow_up',
          title: `${quote.marketName} — ${QUOTE_STATUS_LABELS[quote.status].toLowerCase()}`,
          detail: `${sent}No follow-up date set`,
          overdue: false,
          tab: 'quotes',
          quoteId: quote.id,
        });
      }
    } else if (quote.status === 'quoted' && !anyBound) {
      const quoted = {
        ...base,
        id: `quoted-${quote.id}`,
        kind: 'action_required' as const,
        title: `Quote from ${quote.marketName}${quote.premium ? ` — $${quote.premium.toLocaleString('en-US')}` : ''}`,
        tab: 'quotes' as const,
        quoteId: quote.id,
      };
      if (quote.followUpDate) placeDated({ ...quoted, detail: `${describeDue(quote.followUpDate, today)} · present to client`, dueDate: quote.followUpDate });
      else now.push({ ...quoted, detail: 'Present to client, then mark bound or declined', overdue: false });
    }
  }

  if (effectiveDate && !anyBound) {
    const days = daysBetween(today, effectiveDate);
    if (days >= 0 && days <= RENEWAL_WINDOW_DAYS) {
      now.push({
        ...base,
        id: `renewal-${account.id}`,
        kind: 'renewal',
        title: `Renewal effective ${formatShortDate(effectiveDate)}`,
        detail: days === 0 ? 'Effective today — not bound yet' : `${days} day${days === 1 ? '' : 's'} out · not bound yet`,
        dueDate: effectiveDate,
        overdue: false,
        tab: 'overview',
      });
    }
  }

  return { now: sortActions(now), upcoming: sortActions(upcoming) };
}

export function sortActions(actions: ActionItem[]): ActionItem[] {
  return [...actions].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const p = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    if (p !== 0) return p;
    return (a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : (a.dueDate ?? '') > (b.dueDate ?? '') ? 1 : 0;
  });
}

/** Who the account is waiting on right now — for the Workspace header and the Accounts list. */
export function summarizeWaiting(items: MissingItem[], quotes: MarketQuote[]): { onClient: number; onCarriers: string[]; missing: number; received: number; total: number } {
  const active = items.filter((i) => i.status !== 'waived');
  return {
    onClient: items.filter((i) => i.status === 'requested').length,
    onCarriers: quotes.filter((q) => AWAITING_CARRIER_STATUSES.includes(q.status)).map((q) => q.marketName),
    missing: items.filter((i) => i.status === 'missing').length,
    received: items.filter((i) => i.status === 'received').length,
    total: active.length,
  };
}
