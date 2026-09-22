/**
 * Account workflow — the "keep the account moving" layer on top of the Risk Profile. Deliberately
 * NOT a generic task system: every actionable item on Today's Plate is derived from the state of
 * these records (see services/workflow/nextActions.ts), so the broker never has to duplicate
 * account state into a separate to-do list.
 */

export interface Contact {
  id: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  primary?: boolean;
}

/** Lightweight assignment — a name/email label, optionally tied to a signed-in broker's auth id. No agency permissions model yet (see 0003's reserved organization_id). */
export interface AssignedBroker {
  name: string;
  email?: string;
  userId?: string;
}

/**
 * Where the account stands in the pipeline. Set by the broker by hand, or — when never set —
 * derived from the checklist and quotes (see deriveAccountStage in services/workflow/accountStage.ts).
 */
export type AccountStage = 'new' | 'collecting_info' | 'ready_to_submit' | 'submitted' | 'quoted' | 'bound' | 'on_hold' | 'lost';

export const ACCOUNT_STAGE_LABELS: Record<AccountStage, string> = {
  new: 'New',
  collecting_info: 'Collecting info',
  ready_to_submit: 'Ready to submit',
  submitted: 'Out to market',
  quoted: 'Quoted',
  bound: 'Bound',
  on_hold: 'On hold',
  lost: 'Lost / not renewing',
};

export const ACCOUNT_STAGE_ORDER: AccountStage[] = ['new', 'collecting_info', 'ready_to_submit', 'submitted', 'quoted', 'bound', 'on_hold', 'lost'];

export type MissingItemType = 'document' | 'information';

export type MissingItemStatus = 'missing' | 'requested' | 'received' | 'waived';

export const MISSING_ITEM_STATUS_LABELS: Record<MissingItemStatus, string> = {
  missing: 'Missing',
  requested: 'Waiting on client',
  received: 'Received',
  waived: 'Waived',
};

export interface MissingItem {
  id: string;
  accountId: string;
  type: MissingItemType;
  label: string;
  status: MissingItemStatus;
  requestedFromContactId?: string;
  /** ISO timestamp the request was marked sent to the client. */
  requestedAt?: string;
  /** Local calendar date, YYYY-MM-DD. */
  followUpDate?: string;
  receivedAt?: string;
  notes?: string;
  /** Which checklist template entry created this item, if any (e.g. "loss_runs") — lets requirements vary by line/carrier later without changing the item shape. */
  templateKey?: string;
  /**
   * Every carrier/MGA (MarketQuote id) waiting on this requirement. One logical requirement per
   * account (see services/workflow/requirementKey.ts) — a second carrier asking for the same
   * document is linked here rather than creating another row.
   */
  neededByQuoteIds?: string[];
  /** When the received item was passed on to each carrier, keyed by quote id. Received + in neededByQuoteIds + no entry here = "Ready to send" to that carrier. */
  forwardedTo?: Record<string, string>;
  /** @deprecated Single-carrier link from before requirements could be shared — read only, folded into neededByQuoteIds by normalizeMissingItems. */
  neededByQuoteId?: string;
  /** @deprecated Paired with neededByQuoteId — folded into forwardedTo by normalizeMissingItems. */
  forwardedToCarrierAt?: string;
  /** An uploaded document (UploadedDocument.id) that satisfies this item. */
  documentId?: string;
  createdAt: string;
  updatedAt: string;
}

export type QuoteStatus = 'preparing' | 'submitted' | 'waiting_on_carrier' | 'additional_info_requested' | 'quoted' | 'declined' | 'bound';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  preparing: 'Preparing',
  submitted: 'Submitted',
  waiting_on_carrier: 'Waiting on carrier',
  additional_info_requested: 'Additional info requested',
  quoted: 'Quoted',
  declined: 'Declined',
  bound: 'Bound',
};

export const QUOTE_STATUS_ORDER: QuoteStatus[] = ['preparing', 'submitted', 'waiting_on_carrier', 'additional_info_requested', 'quoted', 'declined', 'bound'];

/** Statuses where the ball is in the carrier's court and a follow-up date is meaningful. */
export const AWAITING_CARRIER_STATUSES: QuoteStatus[] = ['submitted', 'waiting_on_carrier', 'additional_info_requested'];

export interface QuoteNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface MarketQuote {
  id: string;
  accountId: string;
  marketName: string;
  /** Appetite record this market came from (Market Finder / Carrier Appetite), if any. */
  appetiteRecordId?: string;
  /** Local calendar date the submission / quote request was sent, YYYY-MM-DD. */
  submittedAt?: string;
  status: QuoteStatus;
  followUpDate?: string;
  premium?: number;
  declineReason?: string;
  notes: QuoteNote[];
  createdAt: string;
  updatedAt: string;
}
