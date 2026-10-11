import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs build script, no types
import { RELEASES, buildVerified } from '../../scripts/release/build-verified.mjs';

describe('supabase/release/*_verified.sql', () => {
  it.each(Object.keys(RELEASES))('%s: the committed wrapper matches the migration (rebuild with node scripts/release/build-verified.mjs)', (name: string) => {
    expect(readFileSync(new URL(`../../supabase/release/${name.slice(0, 4)}_verified.sql`, import.meta.url), 'utf8')).toBe(buildVerified(name));
  });

  it('contains the migration verbatim, between the two fingerprints, and refuses to commit on any change', () => {
    const migration = readFileSync(new URL('../../supabase/migrations/0047_requests_sent_quota_agencies.sql', import.meta.url), 'utf8').trimEnd();
    const wrapped = buildVerified('0047_requests_sent_quota_agencies');
    const at = wrapped.indexOf(migration);
    expect(at).toBeGreaterThan(wrapped.indexOf("'before'"));
    expect(at).toBeLessThan(wrapped.indexOf("'after'"));
    expect(wrapped).toMatch(/^begin isolation level repeatable read;/m);
    expect(wrapped).toMatch(/raise exception 'STOPPED/);
    expect(wrapped.indexOf('commit;')).toBeGreaterThan(wrapped.indexOf('$check$;'));
  });
});
