import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, Copy, Mail, Send, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Button, Card, CardBody, EmptyState, Modal, Skeleton } from '../components/ui';
import { inputClass, labelClass } from '../components/workspace/formStyles';
import { useAccountsStore } from '../state/useAccountsStore';
import { trackEvent } from '../services/productAnalytics/trackEvent';
import { formatShortDate } from '../services/workflow/dates';
import {
  createInvitation,
  createMyAgency,
  fetchOpenInvitations,
  fetchTeam,
  invitationLink,
  removeMember,
  revokeInvitation,
  sendInvitationEmail,
  setMemberRole,
  type Invitation,
  type InvitationEmailResult,
  type TeamMember,
  type TeamRole,
} from '../services/supabase/teamRepo';

const ROLE_LABEL: Record<TeamRole, string> = { admin: 'Admin', agent: 'Agent' };

/**
 * The agency's team, for its admin: who's on it (name, work email/phone, job title, role, how many
 * accounts each has) and invitations. Invite someone by work email + role; they get a link to join
 * this agency with that role (emailed when the app's email is set up). An admin can change a
 * member's role or remove them — their accounts are handed to someone else first, never orphaned.
 * Everything here is enforced by the database, not this page.
 */
export function TeamPage() {
  const access = useAccountsStore((s) => s.agencyAccess);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const accounts = useAccountsStore((s) => s.accounts);
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const hydrate = useAccountsStore((s) => s.hydrateCloudSubmissions);

  const load = useCallback(async () => {
    if (!access || access.role !== 'admin') return;
    const [team, inv] = await Promise.all([fetchTeam(access.agencyId), fetchOpenInvitations()]);
    if (!team.ok) setError(team.message);
    else setMembers(team.data);
    if (inv.ok) setInvites(inv.data);
  }, [access]);

  useEffect(() => {
    load();
  }, [load]);

  const assignedCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of accounts) if (a.assignedUserId && !a.archived) counts.set(a.assignedUserId, (counts.get(a.assignedUserId) ?? 0) + 1);
    return counts;
  }, [accounts]);

  async function changeRole(m: TeamMember, role: TeamRole) {
    setRoleBusy(m.userId);
    setError(null);
    const res = await setMemberRole(m.userId, role);
    setRoleBusy(null);
    if (!res.ok) setError(res.message);
    await load();
    if (res.ok) hydrate();
  }

  if (!access && currentUserId) {
    return (
      <PageContainer title="Set up your agency">
        <CreateAgencyCard onCreated={hydrate} />
      </PageContainer>
    );
  }

  if (!access || access.role !== 'admin') {
    return (
      <PageContainer title="Team">
        <EmptyState icon={<Users size={26} strokeWidth={1.5} />} title="Only agency admins can see the team" description="Ask your agency admin if you need someone added." />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Team"
      description={access.agencyName ?? undefined}
      actions={
        <Button icon={<UserPlus size={15} />} onClick={() => setInviteOpen(true)}>
          Invite Team Member
        </Button>
      }
    >
      {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}

      <Card>
        <CardBody className="pt-4">
          {members === null ? (
            <Skeleton variant="block" className="h-24 w-full" />
          ) : (
            <ul className="divide-y divide-[var(--color-ink-100)]">
              {members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-sm font-semibold text-[var(--color-ink-900)]">
                      {m.name ?? m.email ?? 'Unnamed'}
                      {m.userId === currentUserId && <span className="font-normal text-[var(--color-ink-400)]"> (you)</span>}
                    </p>
                    {m.jobTitle && <p className="text-xs text-[var(--color-ink-500)]">{m.jobTitle}</p>}
                  </div>
                  <div className="min-w-0 basis-56 text-sm text-[var(--color-ink-600)]">
                    {m.email && <p className="truncate">{m.email}</p>}
                    {m.phone && <p className="text-xs text-[var(--color-ink-500)]">{m.phone}</p>}
                  </div>
                  {m.userId === currentUserId ? (
                    <Badge tone={m.role === 'admin' ? 'brand' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
                  ) : (
                    <select
                      value={m.role}
                      disabled={roleBusy === m.userId}
                      onChange={(e) => changeRole(m, e.target.value as TeamRole)}
                      className="rounded-md border border-[var(--color-ink-200)] bg-white px-2 py-1 text-xs font-medium text-[var(--color-ink-800)] cursor-pointer disabled:opacity-60"
                      aria-label={`Role for ${m.name ?? m.email ?? 'team member'}`}
                    >
                      <option value="agent">Agent</option>
                      <option value="admin">Admin</option>
                    </select>
                  )}
                  <p className="w-32 text-right text-sm text-[var(--color-ink-600)]">
                    <span className="font-semibold text-[var(--color-ink-900)]">{assignedCount.get(m.userId) ?? 0}</span> account{(assignedCount.get(m.userId) ?? 0) === 1 ? '' : 's'}
                  </p>
                  <span className="w-24 text-right">
                    {m.userId !== currentUserId && (
                      <Button size="sm" variant="ghost" icon={<UserMinus size={13} />} onClick={() => setRemoving(m)} aria-label={`Remove ${m.name ?? m.email ?? 'team member'}`}>
                        Remove
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardBody className="pt-4">
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-ink-900)]">Invitations waiting to be accepted</h3>
            <ul className="divide-y divide-[var(--color-ink-100)]">
              {invites.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-[var(--color-ink-800)]">{inv.email}</span>
                  <Badge tone="neutral">{ROLE_LABEL[inv.role]}</Badge>
                  <span className="text-xs text-[var(--color-ink-500)]">{new Date(inv.expiresAt) < new Date() ? 'Expired' : `Expires ${formatShortDate(inv.expiresAt)}`}</span>
                  <CopyLinkButton token={inv.token} />
                  <ResendEmailButton invitationId={inv.id} />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X size={13} />}
                    onClick={async () => {
                      const res = await revokeInvitation(inv.id);
                      if (!res.ok) setError(res.message);
                      load();
                    }}
                  >
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <InviteDialog
        open={inviteOpen}
        agencyName={access.agencyName ?? 'your agency'}
        onClose={() => setInviteOpen(false)}
        onCreated={load}
      />

      {members && (
        <RemoveMemberDialog
          member={removing}
          members={members}
          currentUserId={currentUserId}
          accountCount={removing ? accounts.filter((a) => a.assignedUserId === removing.userId).length : 0}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            setRemoving(null);
            await load();
            hydrate();
          }}
        />
      )}
    </PageContainer>
  );
}

function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={copied ? <Check size={13} /> : <Copy size={13} />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(invitationLink(token));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt('Copy this invitation link:', invitationLink(token));
        }
      }}
    >
      {copied ? 'Copied' : 'Copy invite link'}
    </Button>
  );
}

const memberLabel = (m: TeamMember) => m.name ?? m.email ?? 'Unnamed';

/**
 * Remove someone from the agency. Their accounts go to the person picked here (the database
 * requires it and moves them in one step, with an Activity entry on each), so nothing is orphaned.
 */
function RemoveMemberDialog({
  member,
  members,
  currentUserId,
  accountCount,
  onClose,
  onRemoved,
}: {
  member: TeamMember | null;
  members: TeamMember[];
  currentUserId: string | null;
  accountCount: number;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const others = members.filter((m) => m.userId !== member?.userId);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    setTo(currentUserId && currentUserId !== member.userId ? currentUserId : (others[0]?.userId ?? ''));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  if (!member) return null;
  const name = memberLabel(member);
  const target = others.find((m) => m.userId === to);

  async function confirm() {
    if (!member || busy) return;
    setBusy(true);
    setError(null);
    const res = await removeMember(member.userId, to || null);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    onRemoved();
  }

  return (
    <Modal open onClose={onClose} title={`Remove ${name} from the team?`}>
      <div className="flex flex-col gap-3 text-sm text-[var(--color-ink-700)]">
        <p>
          {name} will lose access to the agency’s accounts right away. Their login and any personal accounts of their own stay; you can invite them back later.
        </p>
        <div>
          <label className={labelClass} htmlFor="reassign-to">
            {accountCount > 0 ? `Reassign their ${accountCount} account${accountCount === 1 ? '' : 's'} to` : 'Reassign any accounts they have to'}
          </label>
          <select id="reassign-to" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
            {others.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberLabel(m)}
                {m.userId === currentUserId ? ' (you)' : ''} — {ROLE_LABEL[m.role]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--color-ink-500)]">
            Each account’s Activity will say it was reassigned{target ? ` to ${memberLabel(target)}` : ''}. They’re also taken off any accounts they were collaborating on.
          </p>
        </div>
        {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" icon={<UserMinus size={13} />} onClick={confirm} disabled={busy || !to}>
            {busy ? 'Removing…' : 'Remove from team'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** One-line outcome of an email attempt — "sent" only when the email service accepted it. */
function EmailStatus({ result }: { result: InvitationEmailResult | 'sending' | null }) {
  if (!result) return null;
  if (result === 'sending') return <p className="text-xs text-[var(--color-ink-500)]">Sending the invitation email…</p>;
  if (result.status === 'sent') return <p className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-success-600)]"><Check size={13} /> Invitation email sent.</p>;
  return <p className={`text-xs ${result.status === 'notConfigured' ? 'text-[var(--color-ink-600)]' : 'text-[var(--color-danger-600)]'}`}>{result.message}</p>;
}

function ResendEmailButton({ invitationId }: { invitationId: string }) {
  const [result, setResult] = useState<InvitationEmailResult | 'sending' | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        icon={<Send size={13} />}
        disabled={result === 'sending'}
        onClick={async () => {
          setResult('sending');
          setResult(await sendInvitationEmail(invitationId));
        }}
      >
        Send email
      </Button>
      {result && result !== 'sending' && (
        <span className={result.status === 'sent' ? 'text-xs font-medium text-[var(--color-success-600)]' : 'max-w-56 text-xs text-[var(--color-ink-500)]'}>
          {result.status === 'sent' ? 'Sent' : result.message}
        </span>
      )}
    </span>
  );
}

function InviteDialog({ open, agencyName, onClose, onCreated }: { open: boolean; agencyName: string; onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('agent');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Invitation | null>(null);
  const [emailResult, setEmailResult] = useState<InvitationEmailResult | 'sending' | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('agent');
    setError(null);
    setCreated(null);
    setEmailResult(null);
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || saving) return;
    setSaving(true);
    setError(null);
    const res = await createInvitation(email, role);
    setSaving(false);
    if (!res.ok) return setError(res.message);
    setCreated(res.data);
    onCreated();
    setEmailResult('sending');
    setEmailResult(await sendInvitationEmail(res.data.id));
  }

  const link = created ? invitationLink(created.token) : '';
  const mailto = created
    ? `mailto:${created.email}?subject=${encodeURIComponent(`Join ${agencyName} on Renewal IQ`)}&body=${encodeURIComponent(
        `You've been invited to join ${agencyName} on Renewal IQ as ${ROLE_LABEL[created.role]}.\n\nOpen this link to create your account (or sign in) with ${created.email} and join:\n${link}\n\nThe link expires in 14 days.`
      )}`
    : '';

  return (
    <Modal open={open} onClose={onClose} title="Invite Team Member">
      {created ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-ink-700)]">
            {emailResult && emailResult !== 'sending' && emailResult.status === 'sent' ? (
              <>
                We emailed the invitation to <span className="font-medium">{created.email}</span>.
              </>
            ) : (
              <>
                Send this link to <span className="font-medium">{created.email}</span>.
              </>
            )}{' '}
            They’ll join {agencyName} as {ROLE_LABEL[created.role]} after signing up or signing in with that email.
          </p>
          <EmailStatus result={emailResult} />
          <input readOnly value={link} className={`${inputClass} bg-[var(--color-ink-50)] text-xs`} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
          <div className="flex flex-wrap justify-end gap-2">
            <CopyLinkButton token={created.token} />
            <a href={mailto} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-800)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-brand-700)]">
              <Mail size={13} /> Open in my email app
            </a>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className={labelClass} htmlFor="invite-email">
              Work email
            </label>
            <input id="invite-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="name@agency.com" />
          </div>
          <div>
            <label className={labelClass} htmlFor="invite-role">
              Role
            </label>
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as TeamRole)} className={inputClass}>
              <option value="agent">Agent — sees accounts assigned to them</option>
              <option value="admin">Admin — sees all agency accounts and manages the team</option>
            </select>
          </div>
          {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!email.trim() || saving}>
              {saving ? 'Creating…' : 'Create invitation'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/**
 * For an agency owner who signed up on their own: create the agency's workspace and become its
 * admin, then invite brokers. Brokers don't create agencies — they join by invitation.
 */
function CreateAgencyCard({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    const res = await createMyAgency(name.trim());
    if (!res.ok) {
      setBusy(false);
      return setError(res.message);
    }
    trackEvent('agency_created');
    await onCreated();
    setBusy(false);
  }

  return (
    <Card className="max-w-xl" data-testid="create-agency">
      <CardBody className="flex flex-col gap-4 pt-5">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Create your agency’s workspace</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-600)]">
            You’ll be its admin: you invite your brokers, choose their roles and see the agency’s accounts. Accounts you already created stay yours — you can share any of them with the agency later.
          </p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className={labelClass} htmlFor="agency-name">
              Agency name
            </label>
            <input id="agency-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. DXP Services" maxLength={120} autoFocus />
          </div>
          {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
          <div>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? 'Creating…' : 'Create agency'}
            </Button>
          </div>
        </form>
        <p className="rounded-lg bg-[var(--color-ink-50)] px-3 py-2 text-xs text-[var(--color-ink-600)]">
          Is your agency already on Renewal IQ? Don’t create a new one — ask its admin to invite you. Brokers join an agency only through an invitation.
        </p>
      </CardBody>
    </Card>
  );
}
