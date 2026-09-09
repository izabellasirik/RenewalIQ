export type ActivityEventType =
  | 'account_created'
  | 'account_duplicated'
  | 'document_uploaded'
  | 'document_processed'
  | 'document_deleted'
  | 'field_completed'
  | 'field_corrected'
  | 'conflict_resolved'
  | 'coverage_edited'
  | 'coverage_added'
  | 'coverage_deleted'
  | 'record_added'
  | 'record_edited'
  | 'record_deleted'
  | 'matching_run';

export interface ActivityEvent {
  id: string;
  accountId: string;
  type: ActivityEventType;
  message: string;
  timestamp: string;
}
