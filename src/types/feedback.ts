/**
 * General product feedback about Renewal IQ itself (bugs, ideas, UX problems, general comments) —
 * deliberately separate from an AppetiteUpdateRequest (a correction to carrier/MGA appetite data;
 * see types/appetiteUpdate.ts). Mirrors the `product_feedback` Supabase table — see
 * supabase/migrations/0002_product_feedback.sql.
 */
export type FeedbackType = 'general' | 'bug' | 'feature_request' | 'other';

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  general: 'General Feedback',
  bug: 'Bug',
  feature_request: 'Feature Request',
  other: 'Other',
};

export type FeedbackStatus = 'new' | 'reviewed' | 'resolved';

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  resolved: 'Resolved',
};

export interface ProductFeedback {
  id: string;
  feedbackType: FeedbackType;
  message: string;
  /** Optional, broker-provided — never required, never collected beyond this. */
  name: string | null;
  email: string | null;
  /** Captured automatically by the widget. */
  pagePath: string | null;
  /** Non-sensitive client-side ids for context — never submission/client business data. */
  accountId: string | null;
  appetiteRecordId: string | null;
  status: FeedbackStatus;
  createdAt: string;
}
