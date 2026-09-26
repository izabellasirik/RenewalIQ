import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, Copy, Mail, UserPlus, Users, X } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Button, Card, CardBody, EmptyState, Modal, Skeleton } from '../components/ui';
import { inputClass, labelClass } from '../components/workspace/formStyles';
import { useAccountsStore } from '../state/useAccountsStore';
import { formatShortDate } from '../services/workflow/dates';
import { createInvitation, fetchOpenInvitations, fetchTeam, invitationLink, revokeInvitation, type Invitation, type TeamMember, type TeamRole } from '../services/supabase/teamRepo';

const ROLE_LABEL: Record<TeamRole, string> = { admin: 'Admin', agent: 'Agent' };

/**
 * The agency's team, for its admin: who's on it (name, work email/phone, job title, role, how many
 * accounts each has) and invitations. Invite someone by work email + role; they get a link to join
 * this agency with that role. Everything here is enforced by the database, not this page.
 */
export function TeamPage() {
  const access = useAccountsStore((s) => s.agencyAccess);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const accounts = useAccountsStore((s) => s.accounts);
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

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
                  <Badge tone={m.role === 'admin' ? 'brand' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
                  <p className="w-32 text-right text-sm text-[var(--color-ink-600)]">
                    <span className="font-semibold text-[var(--color-ink-900)]">{assignedCount.get(m.userId) ?? 0}</span> account{(assignedCount.get(m.userId) ?? 0) === 1 ? '' : 's'}
                  </p>
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
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

function InviteDialog({ open, agencyName, onClose, onCreated }: { open: boolean; agencyName: string; onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('agent');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Invitation | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('agent');
    setError(null);
    setCreated(null);
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
            Send this link to <span className="font-medium">{created.email}</span>. They’ll join {agencyName} as {ROLE_LABEL[created.role]} after signing up or signing in with that email.
          </p>
          <input readOnly value={link} className={`${inputClass} bg-[var(--color-ink-50)] text-xs`} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
          <div className="flex flex-wrap justify-end gap-2">
            <CopyLinkButton token={created.token} />
            <a href={mailto} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-800)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-brand-700)]">
              <Mail size={13} /> Email the invitation
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
