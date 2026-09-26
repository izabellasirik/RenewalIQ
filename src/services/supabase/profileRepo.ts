import { supabase } from './client';

/**
 * The signed-in user's professional profile: full name (required), work phone and job title
 * (optional). Work email is the login email and isn't editable here.
 *
 * Stored in two places that already exist, so it works for everyone and across devices:
 *   - Supabase Auth user metadata (full_name / work_phone / job_title) — every user has this,
 *     including users who aren't in an agency yet;
 *   - the agency member profile (public.profiles: display_name / phone / job_title, 0011 + 0017),
 *     written only through save_my_profile(), which can change nothing but the caller's own name,
 *     phone and title — this is what agency admins (and a future Team page) read.
 */

export interface MyProfile {
  fullName: string;
  phone: string;
  jobTitle: string;
}

export type RepoResult<T = void> = { ok: true; data: T } | { ok: false; message: string };

interface ProfileRow {
  display_name: string | null;
  phone?: string | null;
  job_title?: string | null;
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The agency profile row (null when not in an agency, or 0011 isn't applied). Works before 0017 too. */
async function fetchOwnRow(userId: string): Promise<ProfileRow | null> {
  if (!supabase) return null;
  const full = await supabase.from('profiles').select('display_name, phone, job_title').eq('user_id', userId).maybeSingle();
  if (!full.error) return (full.data as ProfileRow | null) ?? null;
  const basic = await supabase.from('profiles').select('display_name').eq('user_id', userId).maybeSingle();
  return basic.error ? null : ((basic.data as ProfileRow | null) ?? null);
}

/** null = couldn't be read (offline, not configured) — callers must not treat that as "no name yet". */
export async function loadMyProfile(userId: string): Promise<MyProfile | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    const row = await fetchOwnRow(userId);
    const profile: MyProfile = {
      fullName: clean(meta.full_name) || clean(row?.display_name),
      phone: clean(meta.work_phone) || clean(row?.phone),
      jobTitle: clean(meta.job_title) || clean(row?.job_title),
    };
    // Named before joining an agency (or before 0017): copy it onto the agency profile so admins see it.
    if (row && !clean(row.display_name) && profile.fullName) void saveToAgencyProfile(profile);
    return profile;
  } catch {
    return null;
  }
}

async function saveToAgencyProfile(p: MyProfile): Promise<{ error: { code?: string; message: string } | null }> {
  if (!supabase) return { error: null };
  const { error } = await supabase.rpc('save_my_profile', { p_full_name: p.fullName, p_phone: p.phone, p_job_title: p.jobTitle });
  return { error };
}

export async function saveMyProfile(input: MyProfile): Promise<RepoResult<MyProfile>> {
  if (!supabase) return { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
  const profile: MyProfile = { fullName: input.fullName.trim(), phone: input.phone.trim(), jobTitle: input.jobTitle.trim() };
  if (!profile.fullName) return { ok: false, message: 'Full name is required.' };
  try {
    const { error } = await supabase.auth.updateUser({ data: { full_name: profile.fullName, work_phone: profile.phone || null, job_title: profile.jobTitle || null } });
    if (error) return { ok: false, message: error.message };
    const { error: rpcError } = await saveToAgencyProfile(profile);
    // Before migration 0017 the function doesn't exist yet — the profile is still saved on the login.
    if (rpcError && rpcError.code !== 'PGRST202' && rpcError.code !== '42883') return { ok: false, message: rpcError.message };
    return { ok: true, data: profile };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not save your profile.' };
  }
}
