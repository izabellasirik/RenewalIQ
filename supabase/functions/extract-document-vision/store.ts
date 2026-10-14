// Database side of extract-document-vision: the read cache (one paid AI call per page, ever) and
// the usage log (tokens + cost per call). Talks to PostgREST with the service-role key, which
// Supabase injects into every Edge Function (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — never
// sent to the browser. Every method fails soft: a database hiccup never blocks the read itself.
//
// Plain TypeScript (fetch only, no Deno APIs) so the app's unit tests can exercise it.

export type Operation = 'structured_extraction' | 'transcription';
export type SourceKind = 'photo' | 'scanned_pdf_page';

export interface ReadContext {
  accountId?: string;
  documentId?: string;
  page?: number;
  sourceKind?: SourceKind;
  /** SHA-256 (hex) of the original file — with `page`, identifies the image without hashing it. */
  sourceHash?: string;
}

export interface UsageRow {
  organization_id: string | null;
  user_id: string | null;
  account_id: string | null;
  document_id: string | null;
  file_name: string | null;
  page_number: number | null;
  operation: Operation;
  source_kind: SourceKind | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number;
  succeeded: boolean;
  from_cache: boolean;
  error_code: string | null;
}

export type ClaimState = { state: 'hit'; result: unknown; model: string | null } | { state: 'claimed' } | { state: 'busy' };

const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

/** Only well-formed identifiers from the browser are kept — never free text. */
export function sanitizeContext(raw: unknown): ReadContext {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const ctx: ReadContext = {};
  if (typeof r.accountId === 'string' && ID_RE.test(r.accountId)) ctx.accountId = r.accountId;
  if (typeof r.documentId === 'string' && ID_RE.test(r.documentId)) ctx.documentId = r.documentId;
  if (typeof r.page === 'number' && Number.isInteger(r.page) && r.page >= 1 && r.page <= 10000) ctx.page = r.page;
  if (r.sourceKind === 'photo' || r.sourceKind === 'scanned_pdf_page') ctx.sourceKind = r.sourceKind;
  if (typeof r.sourceHash === 'string' && HASH_RE.test(r.sourceHash)) ctx.sourceHash = r.sourceHash;
  return ctx;
}

/**
 * The user id a token claims, when it is a signed-in user's (role authenticated). Only a first, offline
 * gate: verify_jwt proves the signature, and auth.ts confirms the user with Supabase Auth.
 */
export function userIdFromJwt(authorization: string | null): string | null {
  const token = authorization?.replace(/^Bearer\s+/i, '');
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')));
    return typeof json.sub === 'string' && /^[0-9a-f-]{36}$/i.test(json.sub) && json.role === 'authenticated' ? json.sub : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Bumped when a prompt or output schema changes, so old cached reads aren't reused for the new shape. */
export const PROMPT_VERSIONS: Record<Operation, string> = {
  structured_extraction: 'x2',
  transcription: 't1',
};

/**
 * The cache key: who may reuse it (the brokerage, or the broker without one), the operation and its
 * prompt version, and the image (the original file's hash + page, else the image's own hash).
 */
export async function cacheKeyFor(scope: string, operation: Operation, ctx: ReadContext, imageBase64: string): Promise<string> {
  const image = ctx.sourceHash ? `file:${ctx.sourceHash}:${ctx.page ?? 0}` : `img:${await sha256Hex(imageBase64)}`;
  return sha256Hex(`${scope}|${operation}|${PROMPT_VERSIONS[operation]}|${image}`);
}

export interface Store {
  agencyOf(userId: string): Promise<string | null>;
  claim(key: string, scope: string, operation: Operation): Promise<ClaimState | null>;
  complete(key: string, result: unknown, model: string | null): Promise<void>;
  release(key: string): Promise<void>;
  logUsage(row: UsageRow): Promise<void>;
  /** Paid reads so far today (UTC), platform-wide — same rule as 0047's quota. null = couldn't count. */
  paidReadsToday?(): Promise<number | null>;
}

export function restStore(url: string, serviceKey: string, fetchImpl: typeof fetch = fetch): Store {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const res = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`${fn}: ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  return {
    async agencyOf(userId) {
      try {
        const res = await fetchImpl(`${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=agency_id`, { headers });
        if (!res.ok) return null;
        const rows = (await res.json()) as { agency_id?: string | null }[];
        return rows[0]?.agency_id ?? null;
      } catch {
        return null;
      }
    },
    async claim(key, scope, operation) {
      try {
        return (await rpc('ai_read_claim', { p_key: key, p_scope: scope, p_operation: operation })) as ClaimState;
      } catch (err) {
        console.error('extract-document-vision: cache claim failed', String(err));
        return null;
      }
    },
    async complete(key, result, model) {
      try {
        await rpc('ai_read_complete', { p_key: key, p_result: result, p_model: model });
      } catch (err) {
        console.error('extract-document-vision: cache save failed', String(err));
      }
    },
    async release(key) {
      try {
        await rpc('ai_read_release', { p_key: key });
      } catch {
        // a stale claim is taken over after a few minutes anyway
      }
    },
    async paidReadsToday() {
      try {
        const day = new Date();
        day.setUTCHours(0, 0, 0, 0);
        const q = `select=id&from_cache=is.false&occurred_at=gte.${encodeURIComponent(day.toISOString())}&or=(succeeded.is.true,cost_usd.gt.0)`;
        const res = await fetchImpl(`${url}/rest/v1/ai_usage_events?${q}`, { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' } });
        const total = res.ok ? /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] : undefined;
        if (total === undefined) {
          console.error('extract-document-vision: daily count failed (read allowed)', res.status);
          return null;
        }
        return Number(total);
      } catch (err) {
        console.error('extract-document-vision: daily count failed (read allowed)', String(err));
        return null;
      }
    },
    async logUsage(row) {
      try {
        const res = await fetchImpl(`${url}/rest/v1/ai_usage_events`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
        if (!res.ok) console.error('extract-document-vision: usage log failed', res.status);
      } catch (err) {
        console.error('extract-document-vision: usage log failed', String(err));
      }
    },
  };
}
