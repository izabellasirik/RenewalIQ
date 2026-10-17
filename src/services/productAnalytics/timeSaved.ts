import { supabase } from '../supabase/client';

/**
 * The occasional, optional "How long would this normally have taken without Renewal IQ?" question
 * (Founder Analytics, 0043). Asked right after an important workflow is completed — never more than
 * once a week, never twice for the same account + workflow — and only one tap to answer or skip.
 */
export type TimeSavedWorkflow = 'application' | 'market_research' | 'intake_import';
export type TimeSavedAnswer = 'lt5' | '5to15' | '15to30' | '30to60' | '60plus' | 'skipped';

export const TIME_SAVED_OPTIONS: { value: Exclude<TimeSavedAnswer, 'skipped'>; label: string }[] = [
  { value: 'lt5', label: '<5 minutes' },
  { value: '5to15', label: '5–15 minutes' },
  { value: '15to30', label: '15–30 minutes' },
  { value: '30to60', label: '30–60 minutes' },
  { value: '60plus', label: '60+ minutes' },
];

export const WORKFLOW_LABELS: Record<TimeSavedWorkflow, string> = {
  application: 'Preparing this application',
  market_research: 'Finding markets for this account',
  intake_import: 'Getting this new submission into an account',
};

export interface TimeSavedAsk {
  workflow: TimeSavedWorkflow;
  accountId?: string;
  /** How long the Renewal IQ workflow itself took, when measurable (minutes), else undefined. */
  rqMinutes?: number;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
const LAST_KEY = 'riq.timeSaved.lastAsked';
const ASKED_KEY = 'riq.timeSaved.asked';

type Listener = (ask: TimeSavedAsk | null) => void;
let listener: Listener | null = null;
export function onTimeSavedAsk(l: Listener | null): void {
  listener = l;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // per-browser convenience only
  }
}

/** Whether to ask now: at most once a week, never twice for the same account + workflow. */
export function shouldAsk(ask: Pick<TimeSavedAsk, 'workflow' | 'accountId'>, now = Date.now()): boolean {
  const last = read<number>(LAST_KEY, 0);
  if (now - last < WEEK_MS) return false;
  const asked = read<string[]>(ASKED_KEY, []);
  return !asked.includes(`${ask.workflow}:${ask.accountId ?? ''}`);
}

/**
 * Renewal IQ's own time for a workflow — only when it is reliable: the work happened in one sitting
 * (started less than 4 hours ago, on the same day). Otherwise unknown, never guessed.
 */
export function measuredMinutes(startedAt: string | undefined, now = new Date()): number | undefined {
  if (!startedAt) return undefined;
  const start = new Date(startedAt);
  const minutes = (now.getTime() - start.getTime()) / 60000;
  if (!(minutes > 0) || minutes > 240 || start.toDateString() !== now.toDateString()) return undefined;
  return Math.round(minutes * 10) / 10;
}

export function offerTimeSavedQuestion(input: { workflow: TimeSavedWorkflow; accountId?: string; startedAt?: string }): void {
  try {
    if (!supabase || !listener) return;
    const ask: TimeSavedAsk = { workflow: input.workflow, accountId: input.accountId, rqMinutes: measuredMinutes(input.startedAt) };
    if (!shouldAsk(ask)) return;
    write(LAST_KEY, Date.now());
    write(ASKED_KEY, [...read<string[]>(ASKED_KEY, []), `${ask.workflow}:${ask.accountId ?? ''}`].slice(-200));
    listener(ask);
  } catch {
    // optional — never in the way
  }
}

export function recordTimeSaved(ask: TimeSavedAsk, answer: TimeSavedAnswer): void {
  try {
    if (!supabase) return;
    void Promise.resolve(
      supabase.rpc('record_time_saved', { p_workflow: ask.workflow, p_account_id: ask.accountId ?? null, p_answer: answer, p_rq_minutes: ask.rqMinutes ?? null })
    ).catch(() => undefined);
  } catch {
    // never blocks
  }
}
