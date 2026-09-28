/**
 * A client document request (0030): the broker asks a client for specific checklist items and
 * shares a secure upload link. The checklist item (MissingItem) stays the one canonical
 * requirement — a request only references it (missingItemId).
 */
export type DocumentRequestStatus = 'waiting' | 'partial' | 'complete' | 'cancelled';
export type DocumentRequestItemStatus = 'requested' | 'uploaded' | 'needs_review' | 'satisfied' | 'waived';
export type DocumentRequestFileMatch = 'pending' | 'satisfied' | 'needs_review' | 'rejected' | 'reassigned';

export const DOCUMENT_REQUEST_STATUS_LABELS: Record<DocumentRequestStatus, string> = {
  waiting: 'Waiting on client',
  partial: 'Partly received',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

export interface DocumentRequestItem {
  id: string;
  /** The checklist item (MissingItem.id) this asks for. */
  missingItemId: string;
  /** What the client sees (a snapshot of the checklist label when requested). */
  label: string;
  instructions?: string;
  status: DocumentRequestItemStatus;
  uploadedAt?: string;
  satisfiedAt?: string;
  position: number;
}

export interface DocumentRequestFile {
  id: string;
  requestItemId: string;
  fileName: string;
  storagePath: string;
  sizeBytes?: number;
  uploadedAt: string;
  /** The account document (UploadedDocument.id) it was imported as. */
  importedDocumentId?: string;
  importedAt?: string;
  matchStatus: DocumentRequestFileMatch;
  /** Why it needs review. */
  matchNote?: string;
}

export interface DocumentRequest {
  id: string;
  accountId: string;
  token: string;
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
  channel: 'email' | 'text' | 'phone' | 'other';
  status: DocumentRequestStatus;
  requestedAt: string;
  lastFollowUpAt?: string;
  followUpCount: number;
  /** YYYY-MM-DD */
  nextFollowUp?: string;
  expiresAt: string;
  closedAt?: string;
  createdByName?: string;
  items: DocumentRequestItem[];
  files: DocumentRequestFile[];
}

/** Items the client still has to send (never ones already uploaded, received or waived). */
export function outstandingRequestItems(r: Pick<DocumentRequest, 'items'>): DocumentRequestItem[] {
  return r.items.filter((i) => i.status === 'requested').sort((a, b) => a.position - b.position);
}

export function isOpenRequest(r: Pick<DocumentRequest, 'status'>): boolean {
  return r.status === 'waiting' || r.status === 'partial';
}
