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
  | 'account_archived'
  | 'account_restored'
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
  | 'action_reopened'
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
  | 'policy_bound'
  // Client document requests (0030)
  | 'request_follow_up'
  | 'request_completed'
  | 'request_cancelled'
  // 0047: the broker said the request was actually sent (or confirmed an older one was)
  | 'request_sent'
  // Missing documents: marked not applicable (with a reason) / a received document checked by the broker
  | 'item_not_applicable'
  | 'item_verified'
  // A client's submission, as recorded by the database (0042) — facts only, see ClientSubmissionDetails.
  | 'client_submitted'
  // The broker opened an RQ-drafted email in Gmail's compose window. Not "sent": RQ can't see that.
  | 'email_draft_opened';

export const WORKFLOW_EVENT_TYPES: ReadonlySet<ActivityEventType> = new Set<ActivityEventType>([
  'account_created',
  'account_updated',
  'account_archived',
  'account_restored',
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
  'action_reopened',
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
  'request_follow_up',
  'request_completed',
  'request_cancelled',
  'request_sent',
  'item_not_applicable',
  'item_verified',
  'client_submitted',
  'email_draft_opened',
]);

/**
 * What a client submission event records (activity_events.details, 0042): only what Renewal IQ knows
 * for certain — never a document type read by extraction.
 */
export interface ClientSubmissionDetails {
  source: 'intake' | 'document_request';
  /** False for an intake the client didn't finish (imported with what arrived). */
  complete: boolean;
  submittedAt: string;
  accountName?: string | null;
  /** Original file names, as uploaded. */
  files: string[];
  /** Intake: the email the client typed on the form. */
  clientEmail?: string | null;
  clientName?: string | null;
  /** Document request: the contact the secure link was sent to. */
  linkSentTo?: string | null;
  reference?: string | null;
}

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
  /** Structured facts for some events (client_submitted). */
  details?: ClientSubmissionDetails;
}
