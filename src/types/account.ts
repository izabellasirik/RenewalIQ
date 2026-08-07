export type AccountStatus = 'new' | 'documents_uploaded' | 'profile_in_review' | 'ready_for_market';

export interface Account {
  id: string;
  namedInsured: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  status: AccountStatus;
}
