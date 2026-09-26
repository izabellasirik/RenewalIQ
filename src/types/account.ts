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
  /** Derived tasks the broker marked done: task key (see actionDoneKey) → when. */
  doneActions?: Record<string, string>;
}
