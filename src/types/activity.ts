export type ActivityEventType =
  | 'account_created'
  | 'account_duplicated'
  | 'document_uploaded'
  | 'document_processed'
  | 'field_completed'
  | 'field_corrected'
  | 'conflict_resolved'
  | 'coverage_edited'
  | 'matching_run';

export interface ActivityEvent {
  id: string;
  accountId: string;
  type: ActivityEventType;
  message: string;
  timestamp: string;
}
