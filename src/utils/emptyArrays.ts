import type { ActivityEvent, MatchResult, UploadedDocument } from '../types';

/**
 * Stable empty-array fallbacks for store selectors like `s.documents[id] ?? EMPTY_DOCUMENTS`.
 * A fresh `[]` literal in the fallback position creates a new reference every render, which
 * defeats memoization (useMemo/useEffect deps) downstream — these give a single stable identity.
 */
export const EMPTY_DOCUMENTS: UploadedDocument[] = [];
export const EMPTY_MATCH_RESULTS: MatchResult[] = [];
export const EMPTY_ACTIVITY_EVENTS: ActivityEvent[] = [];
