export type AccountStatus = 'new' | 'documents_uploaded' | 'profile_in_review' | 'ready_for_market';

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
}
