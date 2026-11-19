import { describe, expect, it, vi } from 'vitest';

// Fictional rows for two accounts, as the database returns them (one table per request, paged by 1000).
const tables: Record<string, Record<string, unknown>[]> = {
  submissions: [
    { id: 's1', named_insured: 'Prairie Line Freight LLC', state: 'TX', status: 'new', archived: false, created_at: '2026-10-01', updated_at: '2026-10-02' },
    { id: 's2', named_insured: 'Atlas Freight LLC', state: 'OH', status: 'new', archived: false, created_at: '2026-10-01', updated_at: '2026-10-02' },
  ],
  field_values: [
    { id: 's1::business.fein', submission_id: 's1', section: 'business', field_key: 'fein', value: '12-3456789', status: 'auto_filled', confidence: 'high' },
    { id: 's2::business.fein', submission_id: 's2', section: 'business', field_key: 'fein', value: '98-7654321', status: 'auto_filled', confidence: 'high' },
  ],
  field_alternates: [{ id: 'a1', field_value_id: 's2::business.fein', value: '98-7654320' }],
  coverage_lines: [{ id: 'c1', submission_id: 's2', coverage_type: 'auto_liability' }],
  vehicles: [
    { id: 'v1', submission_id: 's1', vin: '1FUJGLDR0CLBP0001' },
    { id: 'v2', submission_id: 's1', vin: '4V4NC9EH0MN000001' },
    { id: 'v3', submission_id: 's2', vin: '3AKJHHDR5NSM00003' },
  ],
  drivers: [{ id: 'd1', submission_id: 's2', name: 'Jordan Avery' }],
  losses: [],
  documents: [{ id: 'doc1', submission_id: 's1', name: 'units.pdf' }],
  activity_events: [
    { id: 'e2', submission_id: 's1', type: 'note', message: 'b', occurred_at: '2026-10-02T00:00:00Z' },
    { id: 'e1', submission_id: 's1', type: 'note', message: 'a', occurred_at: '2026-10-01T00:00:00Z' },
  ],
};

const calls: { table: string; after: string | null }[] = [];
function query(table: string) {
  let after: string | null = null;
  let limit = Infinity;
  const q = {
    select: () => q,
    eq: () => q,
    like: () => q,
    neq: () => q,
    order: () => q,
    gt: (_col: string, v: string) => ((after = v), q),
    limit: (n: number) => ((limit = n), q),
    abortSignal: () => {
      calls.push({ table, after });
      const rows = [...(tables[table] ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id))).filter((r) => after === null || String(r.id) > after);
      return Promise.resolve({ data: rows.slice(0, limit), error: null });
    },
  };
  return q;
}
vi.mock('../client', () => ({ isSupabaseConfigured: true, supabase: { from: (t: string) => query(t) } }));
const { fetchUserSubmissions } = await import('../submissionsRepo');

describe('loading every account at sign-in', () => {
  it('a big table comes in full, page by page after the last id (never by position)', async () => {
    const before = tables.activity_events;
    tables.activity_events = Array.from({ length: 2500 }, (_, i) => ({ id: `e${String(i).padStart(5, '0')}`, submission_id: 's1', type: 'note', message: String(i), occurred_at: '2026-10-01T00:00:00Z' }));
    calls.length = 0;
    const res = await fetchUserSubmissions('u1');
    tables.activity_events = before;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.data[0].activity.map((e) => e.id);
    expect(ids).toHaveLength(2500);
    expect(new Set(ids).size).toBe(2500);
    expect(calls.filter((c) => c.table === 'activity_events').map((c) => c.after)).toEqual([null, 'e00999', 'e01999']);
  });

  it('each account gets exactly its own rows', async () => {
    const res = await fetchUserSubmissions('u1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [a, b] = res.data;
    expect(a.account.namedInsured).toBe('Prairie Line Freight LLC');
    expect(a.profile.vehicles.map((v) => v.vin)).toEqual(['1FUJGLDR0CLBP0001', '4V4NC9EH0MN000001']);
    expect(b.profile.vehicles.map((v) => v.vin)).toEqual(['3AKJHHDR5NSM00003']);
    expect(a.profile.drivers).toHaveLength(0);
    expect(b.profile.drivers.map((d) => d.name)).toEqual(['Jordan Avery']);
    expect(a.documents.map((d) => d.id)).toEqual(['doc1']);
    expect(b.documents).toHaveLength(0);
    expect(a.activity.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(b.activity).toHaveLength(0);
    expect(b.profile.coverage.map((c) => c.type)).toEqual(['auto_liability']);
    expect(String(a.profile.business.fein?.value)).toBe('12-3456789');
    expect((b.profile.business.fein as { alternateValues?: unknown[] } | undefined)?.alternateValues?.length ?? 0).toBe(1);
    expect((a.profile.business.fein as { alternateValues?: unknown[] } | undefined)?.alternateValues?.length ?? 0).toBe(0);
  });
});
