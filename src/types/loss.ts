import type { FieldSource, ReviewFlag } from './common';

export type LossStatus = 'open' | 'closed';

export interface LossEntry {
  id: string;
  lossDate: string;
  claimType: string;
  paid: number;
  reserved: number;
  incurred: number;
  status: LossStatus;
  /** Absent for a broker-added row (isManual: true) — there is no document to point to. */
  source?: FieldSource;
  /** Other documents that listed this same row (besides `source`) — see FieldValue.support. */
  support?: FieldSource[];
  /** Kept for review after its source document was removed — see ReviewFlag. */
  reviewFlag?: ReviewFlag;
  /** True for a row the broker added or edited directly, rather than one extracted from a document. Deleting a document never removes or alters a manual row. */
  isManual?: boolean;
  lastUpdatedAt?: string;
  /** The loss-run report this claim is listed on (LossRun.id). */
  lossRunId?: string;
  claimNumber?: string;
  description?: string;
  /** Transient: the loss-run record (LossRunDraft.key) this claim was read under, until it's settled into lossRunId. */
  lossRunKey?: string;
}

/**
 * One loss-run report: who issued it, for which policy and period, and when it was run. Claims are
 * LossEntry rows pointing here (lossRunId); the totals are theirs when itemized, otherwise what the
 * report states.
 */
export interface LossRun {
  id: string;
  carrier: string;
  policyNumber?: string;
  /** The date the report was run/issued, YYYY-MM-DD — freshness is measured from this. */
  reportDate?: string;
  coverageStart?: string;
  coverageEnd?: string;
  /** As stated on the report — used when the claims aren't itemized. */
  claimCount?: number;
  totalIncurred?: number;
  totalPaid?: number;
  totalReserve?: number;
  notes?: string;
  /** The uploaded document this came from, if any. */
  documentId?: string;
  /** Other documents that showed this same report (e.g. it was uploaded twice). */
  supportingDocumentIds?: string[];
  /** Fields a later document filled in (field → document id), so removing that document clears only those. */
  fieldSources?: Partial<Record<string, string>>;
  /** The broker changed this record by hand — removing its document keeps it (for review). */
  editedByBroker?: boolean;
  /** Kept for review after its document was removed — see ReviewFlag. */
  reviewFlag?: ReviewFlag;
  createdAt: string;
  updatedAt: string;
}
