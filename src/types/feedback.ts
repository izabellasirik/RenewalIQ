export type FeedbackSeverity = 'bug' | 'idea' | 'question' | 'other';

export interface FeedbackEntry {
  id: string;
  submittedAt: string;
  page: string;
  accountId?: string;
  severity: FeedbackSeverity;
  message: string;
}
