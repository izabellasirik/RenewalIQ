import type { IntakeAnswers } from '../supabase/intakeRepo';

/**
 * The client's unfinished submission, kept in their browser so a reload, a crash or a closed tab
 * doesn't lose what they typed, and the same submission (same client token) is finished instead of
 * a second one being started. Files themselves can't be kept by a browser across a reload — the
 * draft remembers which ones already reached the server and which need to be added again.
 * Cleared once the server has verified the submission.
 */

export interface IntakeDraftFile {
  key: string;
  name: string;
  size: number;
  uploaded: boolean;
}

export interface IntakeDraft {
  version: 1;
  clientToken: string;
  answers: IntakeAnswers;
  files: IntakeDraftFile[];
  submissionId?: string;
  reference?: string;
  updatedAt: string;
}

/** A draft older than this isn't offered back (the server stops accepting its files after 7 days). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const keyFor = (linkToken: string) => `renewaliq.intakeDraft.${linkToken}`;

export function loadIntakeDraft(linkToken: string, now = Date.now()): IntakeDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(linkToken));
    if (!raw) return null;
    const d = JSON.parse(raw) as IntakeDraft;
    if (d?.version !== 1 || typeof d.clientToken !== 'string' || !d.answers || !Array.isArray(d.files)) return null;
    if (now - new Date(d.updatedAt).getTime() > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(linkToken));
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function saveIntakeDraft(linkToken: string, draft: Omit<IntakeDraft, 'version' | 'updatedAt'>): void {
  try {
    localStorage.setItem(keyFor(linkToken), JSON.stringify({ ...draft, version: 1, updatedAt: new Date().toISOString() }));
  } catch {
    // Storage full or blocked: the submission still works, it just can't be resumed after a reload.
  }
}

export function clearIntakeDraft(linkToken: string): void {
  try {
    localStorage.removeItem(keyFor(linkToken));
  } catch {
    // nothing to do
  }
}

/** Something worth offering back: answers typed or files chosen. */
export function draftHasContent(d: IntakeDraft): boolean {
  const a = d.answers as unknown as Record<string, unknown>;
  return d.files.length > 0 || Object.values(a).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== ''));
}
