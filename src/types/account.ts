export type AccountStatus = 'new' | 'documents_uploaded' | 'profile_in_review' | 'ready_for_market';

import type { AccountStage, AssignedBroker, Contact } from './workflow';

export interface Account {
  id: string;
  namedInsured: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  status: AccountStatus;
  /** Soft-delete flag — archived accounts are hidden from the main Dashboard list but not destroyed. */
  archived: boolean;
  /** Set only for accounts created by importing an external intake submission (see types/intake.ts) — the applicant's own contact info, not underwriting data, so it lives on the account envelope rather than the Risk Profile. */
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Every person at the insured the broker may contact. Absent on accounts persisted before contacts existed — read through getAccountContacts(), which falls back to the legacy contactName/Email/Phone fields above. */
  contacts?: Contact[];
  assignedBroker?: AssignedBroker;
  /** Broker-set pipeline status. Absent = automatic (derived from checklist and quotes). */
  stage?: AccountStage;
  /** Agency this account belongs to (cloud accounts, 0011). Set by the database, read-only here. */
  agencyId?: string;
  /** Supabase Auth user id of the agent the account belongs to — what grants access (RLS). Set by the database; only an agency admin can change it (assignAccountToAgent). */
  assignedUserId?: string | null;
  /** Team members helping on the account besides the primary assigned broker (0026) — set by the database. */
  collaboratorIds?: string[];
  /** Who the account was first assigned to (0026) — kept when it's reassigned. */
  originalAssignedUserId?: string | null;
  /** Derived tasks the broker marked done: task key (see actionDoneKey) → when. */
  doneActions?: Record<string, string>;
  /** Human-written account notes (Workspace → Notes), newest last. Not part of Activity. */
  notes?: AccountNote[];
  /** Loss-run reports on file (0025) — claims link to them via LossEntry.lossRunId. */
  lossRuns?: import('./loss').LossRun[];
  /** New venture or renewal, chosen when the account is created (0054). Absent on accounts from before — they keep the original renewal reminder. */
  businessType?: AccountBusinessType;
  /** The renewals being tracked for this client (0054) — one per policy term. See services/workflow/renewals.ts. */
  renewals?: AccountRenewal[];
}

export type AccountBusinessType = 'new_venture' | 'renewal';
export const BUSINESS_TYPE_LABELS: Record<AccountBusinessType, string> = { new_venture: 'New venture', renewal: 'Renewal' };

export type RenewalStatus = 'open' | 'bound' | 'not_renewing';

/**
 * One renewal being tracked: a policy term coming up for renewal, with when to start working on it.
 *
 * The account's main renewal has no date of its own while open: it follows the account's Renewal /
 * effective date (the Risk Profile's), so the two can never disagree. A renewal for another policy (a
 * different line or carrier, renewing on another date) carries its own date. A renewal is closed only by a market
 * bound *for it* (or marked not renewing) — binding something else never dismisses it.
 */
export interface AccountRenewal {
  id: string;
  /** The account's main renewal: while open, its date is the account's Renewal / effective date. At most one open at a time. */
  main?: boolean;
  /** YYYY-MM-DD. Another policy's renewal: always set. The main renewal: set only once it closes, to keep the date it was for. */
  renewalDate?: string;
  /** Days before the renewal date to start working on it. Absent = the default (45). */
  leadDays?: number;
  /** Which policy, e.g. "Cargo" — only needed when a client has more than one renewal. */
  label?: string;
  /** The expiring policy this renewal is for, when policies are recorded on bound markets. */
  policyId?: string;
  status: RenewalStatus;
  /** The market bound for this renewal. */
  boundQuoteId?: string;
  closedAt?: string;
  /** The renewal this one follows (set up after that one was bound). */
  previousRenewalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountNote {
  id: string;
  text: string;
  createdAt: string;
  authorId?: string;
  authorName: string;
  /** Set when the note was edited. */
  updatedAt?: string;
  updatedByName?: string;
}
