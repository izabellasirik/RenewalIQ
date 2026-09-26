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
  | 'matching_run'
  // Account workflow events (see types/workflow.ts) — the broker-meaningful history.
  | 'account_updated'
  | 'stage_changed'
  | 'broker_assigned'
  | 'contact_added'
  | 'contact_updated'
  | 'contact_removed'
  | 'item_added'
  | 'item_requested'
  | 'follow_up_scheduled'
  | 'follow_up_completed'
  | 'action_done'
  | 'item_received'
  | 'item_waived'
  | 'item_removed'
  | 'item_sent_to_carrier'
  | 'market_added'
  | 'market_removed'
  | 'submission_sent'
  | 'carrier_requested_item'
  | 'carrier_note_added'
  | 'quote_received'
  | 'carrier_declined'
  | 'quote_status_changed'
  | 'policy_bound';

export const WORKFLOW_EVENT_TYPES: ReadonlySet<ActivityEventType> = new Set<ActivityEventType>([
  'account_created',
  'account_updated',
  'stage_changed',
  'broker_assigned',
  'contact_added',
  'contact_updated',
  'contact_removed',
  'item_added',
  'item_requested',
  'follow_up_scheduled',
  'follow_up_completed',
  'action_done',
  'item_received',
  'item_waived',
  'item_removed',
  'item_sent_to_carrier',
  'market_added',
  'market_removed',
  'submission_sent',
  'carrier_requested_item',
  'carrier_note_added',
  'quote_received',
  'carrier_declined',
  'quote_status_changed',
  'policy_bound',
]);

export interface ActivityEvent {
  id: string;
  accountId: string;
  type: ActivityEventType;
  message: string;
  timestamp: string;
  /** Supabase user id of whoever did it (cloud: activity_events.user_id, checked by RLS). Absent on events from before this was recorded, or made while signed out. */
  actorId?: string;
  /** Their display name when it happened (agency name, else email). */
  actorName?: string;
}
