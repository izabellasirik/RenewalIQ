import { supabase } from './client';

/**
 * Agency team + invitations (0011 profiles, 0017 phone/job title, 0018 invitations). Everything is
 * enforced by the database: only an agency admin can read the team or invitations beyond their own
 * row, create or revoke invitations; accepting checks the invited email against the signed-in login.
 */

export type RepoResult<T = void> = { ok: true; data: T } | { ok: false; message: string };
export type TeamRole = 'agent' | 'admin';

export interface TeamMember {
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  role: TeamRole;
}

export interface Invitation {
  id: string;
  email: string;
  role: TeamRole;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export interface InvitationInfo {
  agencyName: string;
  email: string;
  role: TeamRole;
  status: 'open' | 'accepted' | 'revoked' | 'expired';
}

const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sign-in is not configured in this environment.' };
const fail = (err: unknown, fallback: string): RepoResult<never> => ({ ok: false, message: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? fallback) });

export function invitationLink(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

/** The agency's members (an admin gets everyone; RLS gives anyone else only themselves). */
export async function fetchTeam(agencyId: string): Promise<RepoResult<TeamMember[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    let res = await supabase.from('profiles').select('user_id, role, display_name, email, phone, job_title').eq('agency_id', agencyId);
    // Before 0017 there's no phone / job title yet.
    if (res.error) res = (await supabase.from('profiles').select('user_id, role, display_name, email').eq('agency_id', agencyId)) as typeof res;
    if (res.error) return fail(res.error, 'Could not load your team.');
    const rows = (res.data ?? []) as { user_id: string; role: TeamRole; display_name: string | null; email: string | null; phone?: string | null; job_title?: string | null }[];
    return {
      ok: true,
      data: rows
        .map((r) => ({ userId: r.user_id, role: r.role, name: r.display_name?.trim() || null, email: r.email, phone: r.phone?.trim() || null, jobTitle: r.job_title?.trim() || null }))
        .sort((a, b) => (a.role === b.role ? (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? '') : a.role === 'admin' ? -1 : 1)),
    };
  } catch (err) {
    return fail(err, 'Could not load your team.');
  }
}

/** Open (not accepted, not revoked) invitations for the admin's agency. Empty before 0018. */
export async function fetchOpenInvitations(): Promise<RepoResult<Invitation[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase
      .from('agency_invitations')
      .select('id, email, role, token, created_at, expires_at')
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    if (error) return error.code === '42P01' || error.code === 'PGRST205' ? { ok: true, data: [] } : fail(error, 'Could not load invitations.');
    return { ok: true, data: (data ?? []).map((r) => ({ id: r.id, email: r.email, role: r.role, token: r.token, createdAt: r.created_at, expiresAt: r.expires_at })) };
  } catch (err) {
    return fail(err, 'Could not load invitations.');
  }
}

export async function createInvitation(email: string, role: TeamRole): Promise<RepoResult<Invitation>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.rpc('create_agency_invitation', { p_email: email, p_role: role });
    if (error) return fail(error.code === 'PGRST202' ? { message: 'Invitations need migration 0018_agency_invitations.sql in Supabase.' } : error, 'Could not create the invitation.');
    const row = (Array.isArray(data) ? data[0] : data) as { id: string; token: string; email: string; role: TeamRole; expires_at: string };
    return { ok: true, data: { id: row.id, email: row.email, role: row.role, token: row.token, createdAt: new Date().toISOString(), expiresAt: row.expires_at } };
  } catch (err) {
    return fail(err, 'Could not create the invitation.');
  }
}

export async function revokeInvitation(id: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.rpc('revoke_agency_invitation', { p_id: id });
  return error ? fail(error, 'Could not cancel the invitation.') : { ok: true, data: undefined };
}

/** 0027 not applied yet → a clear message instead of PostgREST's "function not found". */
const needs0027 = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST202' || /set_agency_member_role|remove_agency_member/.test(error.message ?? '') ? { message: 'Team management needs migration 0027_team_management.sql in Supabase.' } : error;

/** Admin only (the database checks): makes a member an agent or an admin. The agency always keeps an admin. */
export async function setMemberRole(userId: string, role: TeamRole): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { error } = await supabase.rpc('set_agency_member_role', { p_user_id: userId, p_role: role });
    return error ? fail(needs0027(error), 'Could not change the role.') : { ok: true, data: undefined };
  } catch (err) {
    return fail(err, 'Could not change the role.');
  }
}

/**
 * Admin only (the database checks): removes someone from the agency. Their agency accounts go to
 * `reassignTo` (required when they have any) and they're taken off every account's collaborators.
 * Returns how many accounts moved.
 */
export async function removeMember(userId: string, reassignTo: string | null): Promise<RepoResult<number>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.rpc('remove_agency_member', { p_user_id: userId, p_reassign_to: reassignTo });
    return error ? fail(needs0027(error), 'Could not remove this team member.') : { ok: true, data: Number(data) || 0 };
  } catch (err) {
    return fail(err, 'Could not remove this team member.');
  }
}

/**
 * Asks RenewalIQ's server (api/send-invitation.ts) to email an invitation. `sent` only when the
 * email provider accepted the message; `notConfigured` when no provider is set up for this
 * deployment (the link still works — copy it and send it yourself).
 */
export type InvitationEmailResult = { status: 'sent' } | { status: 'notConfigured'; message: string } | { status: 'failed'; message: string };

export async function sendInvitationEmail(invitationId: string): Promise<InvitationEmailResult> {
  const notConfigured: InvitationEmailResult = { status: 'notConfigured', message: 'Invitation emails aren’t set up for this app yet. Copy the invitation link and send it to the new user.' };
  if (!supabase) return notConfigured;
  let token: string | undefined;
  try {
    token = (await supabase.auth.getSession()).data.session?.access_token;
  } catch {
    token = undefined;
  }
  if (!token) return { status: 'failed', message: 'Sign in again to send the invitation email.' };
  let res: Response;
  try {
    res = await fetch('/api/send-invitation', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ invitationId }) });
  } catch {
    return { status: 'failed', message: 'Could not reach the email service. Copy the invitation link and send it to the new user.' };
  }
  // Anything that isn't the server's own JSON answer (e.g. the app page itself, where the server
  // isn't deployed) means no email went out.
  const body = (res.headers.get('content-type') ?? '').includes('application/json') ? ((await res.json().catch(() => null)) as { sent?: boolean; notConfigured?: boolean; error?: string } | null) : null;
  if (!body) return notConfigured;
  if (res.ok && body.sent === true) return { status: 'sent' };
  if (body.notConfigured) return notConfigured;
  return { status: 'failed', message: body.error ?? 'The invitation email could not be sent. Copy the invitation link and send it to the new user.' };
}

/** What an invitation link is for — callable signed out. null = no such invitation. */
export async function getInvitation(token: string): Promise<RepoResult<InvitationInfo | null>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.rpc('get_agency_invitation', { p_token: token });
    if (error) return fail(error, 'Could not open this invitation.');
    const row = (Array.isArray(data) ? data[0] : data) as { agency_name: string; email: string; role: TeamRole; status: InvitationInfo['status'] } | undefined;
    return { ok: true, data: row ? { agencyName: row.agency_name, email: row.email, role: row.role, status: row.status } : null };
  } catch (err) {
    return fail(err, 'Could not open this invitation.');
  }
}

/** Joins the invitation's agency with its role. Returns the agency name. */
export async function acceptInvitation(token: string): Promise<RepoResult<string>> {
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.rpc('accept_agency_invitation', { p_token: token });
  return error ? fail(error, 'Could not accept the invitation.') : { ok: true, data: data as string };
}

// An invitation opened before signing up / in is remembered in this browser, so the person comes
// back to it after confirming their email or signing in.
const PENDING_KEY = 'renewaliq.pendingInvite';

export function rememberPendingInvite(token: string): void {
  try {
    localStorage.setItem(PENDING_KEY, token);
  } catch {
    // convenience only
  }
}

export function pendingInvite(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // convenience only
  }
}
