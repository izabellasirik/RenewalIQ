import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Copy, Mail, Send, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Button, Card, CardBody, EmptyState, Modal, Skeleton, Tabs } from '../components/ui';
import { PartnershipsPanel } from '../components/team/PartnershipsPanel';
import { fetchBrokerFeeShares, setAgentBrokerFeeShare, type BrokerFeeShare } from '../services/supabase/partnersRepo';
import { centsInput, parseMoneyCents } from '../services/workflow/policies';
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
import { setAgentCommissionRate } from '../services/supabase/commissionRepo';
import { useAgentCommissionRates } from '../hooks/useAgentCommission';
import { formatRate } from '../components/workspace/PoliciesSection';

const ROLE_LABEL: Record<TeamRole, string> = { admin: 'Admin', agent: 'Agent' };

/**
 * The agency's team, for its admin: who's on it (name, work email/phone, job title, role, how many
 * accounts each has) and invitations. Invite someone by work email + role; they get a link to join
 * this agency with that role (emailed when the app's email is set up). An admin can change a
 * member's role or remove them — their accounts are handed to someone else first, never orphaned.
 * The admin also sets each member's agent commission % (net amount × % on the policies and
 * endorsements of the accounts assigned to them); an agent sees only their own.
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

  // Team and Partners: the team, or Partnerships (?tab=partners).
  const [params, setParams] = useSearchParams();
  const tab: 'team' | 'partners' = params.get('tab') === 'partners' ? 'partners' : 'team';
  const setTab = (t: 'team' | 'partners') => setParams(t === 'partners' ? { tab: 'partners' } : {}, { replace: true });
  // Each member's broker fee share (0081), set by an admin.
  const [shares, setShares] = useState<Record<string, BrokerFeeShare>>({});
  const reloadShares = useCallback(async () => {
    const r = await fetchBrokerFeeShares();
    if (r.ok) setShares(r.data);
  }, []);
  useEffect(() => {
    void reloadShares();
  }, [reloadShares]);

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
        {access && currentUserId && <MyCommission userId={currentUserId} />}
        <EmptyState icon={<Users size={26} strokeWidth={1.5} />} title="Only agency admins can see the team" description="Ask your agency admin if you need someone added." />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Team and Partners"
      description={access.agencyName ?? undefined}
      actions={
        tab === 'team' ? (
          <Button icon={<UserPlus size={15} />} onClick={() => setInviteOpen(true)}>
            Invite Team Member
          </Button>
        ) : undefined
      }
    >
      {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}

      <Tabs items={[{ key: 'team', label: 'Team' }, { key: 'partners', label: 'Partnerships' }]} active={tab} onChange={(k) => setTab(k === 'partners' ? 'partners' : 'team')} />

      {tab === 'partners' ? (
        <PartnershipsPanel />
      ) : (
      <>
      <Card>
        <CardBody className="pt-4">
          {members === null ? (
            <Skeleton variant="block" className="h-24 w-full" />
          ) : (
            <>
            {/* Column names on wide screens; narrower screens label each box instead. */}
            <div className={`hidden gap-x-6 border-b border-[var(--color-ink-100)] pb-2 text-xs font-medium text-[var(--color-ink-500)] xl:grid ${MEMBER_COLS}`} aria-hidden>
              <span>Name</span>
              <span>Contact</span>
              <span>Role</span>
              <span>Agent commission</span>
              <span>Broker fee share</span>
              <span className="text-right">Accounts</span>
              <span />
            </div>
            <ul className="divide-y divide-[var(--color-ink-100)]">
              {members.map((m) => (
                <li key={m.userId} className={`grid grid-cols-2 gap-x-6 gap-y-3 py-3 xl:items-center ${MEMBER_COLS}`}>
                  <div className="col-span-2 min-w-0 sm:col-span-1 xl:col-span-1">
                    <p className="text-sm font-semibold text-[var(--color-ink-900)]">
                      {m.name ?? m.email ?? 'Unnamed'}
                      {m.userId === currentUserId && <span className="font-normal text-[var(--color-ink-400)]"> (you)</span>}
                    </p>
                    {m.jobTitle && <p className="text-xs text-[var(--color-ink-500)]">{m.jobTitle}</p>}
                  </div>
                  <div className="col-span-2 min-w-0 text-sm text-[var(--color-ink-600)] sm:col-span-1 xl:col-span-1">
                    {m.email && <p className="truncate">{m.email}</p>}
                    {m.phone && <p className="text-xs text-[var(--color-ink-500)]">{m.phone}</p>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--color-ink-500)] xl:hidden">Role</span>
                    {m.userId === currentUserId ? (
                      // Your own role can't be changed here: shown in the same box shape, not editable.
                      <span className={`${CONTROL} bg-[var(--color-ink-50)] text-[var(--color-ink-700)]`} title="You can't change your own role">{ROLE_LABEL[m.role]}</span>
                    ) : (
                      <select
                        value={m.role}
                        disabled={roleBusy === m.userId}
                        onChange={(e) => changeRole(m, e.target.value as TeamRole)}
                        className={`${CONTROL} cursor-pointer bg-white text-[var(--color-ink-900)] disabled:opacity-60`}
                        aria-label={`Role for ${m.name ?? m.email ?? 'team member'}`}
                      >
                        <option value="agent">Agent</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </div>
                  <CommissionRateInput member={m} />
                  <BrokerFeeShareInput member={m} share={shares[m.userId]} onSaved={reloadShares} />
                  <p className="self-center text-sm text-[var(--color-ink-600)] xl:text-right">
                    <span className="font-semibold text-[var(--color-ink-900)]">{assignedCount.get(m.userId) ?? 0}</span> account{(assignedCount.get(m.userId) ?? 0) === 1 ? '' : 's'}
                  </p>
                  <span className="self-center justify-self-start xl:justify-self-end">
                    {m.userId !== currentUserId && (
                      <Button size="sm" variant="ghost" icon={<UserMinus size={13} />} onClick={() => setRemoving(m)} aria-label={`Remove ${m.name ?? m.email ?? 'team member'}`}>
                        Remove
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            </>
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
      </>
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

// The team list's columns on wide screens, and the shared shape of its Role and commission boxes.
const MEMBER_COLS = 'xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_7rem_7rem_10rem_6.5rem_6.5rem]';
const CONTROL = 'inline-flex h-8 w-24 items-center rounded-md border border-[var(--color-ink-200)] px-2 text-sm';

/** An agent's share of the broker fee (0081): a fixed $ or a % of what's left after the partner. Saved on Enter or leaving the box; blank clears it. */
function BrokerFeeShareInput({ member, share, onSaved }: { member: TeamMember; share?: BrokerFeeShare; onSaved: () => void }) {
  const shownValue = !share ? '' : share.mode === 'percent' ? String(Math.round(share.value * 1e6) / 1e4) : centsInput(share.value) || '0.00';
  const [mode, setMode] = useState<'amount' | 'percent'>(share?.mode ?? 'amount');
  const [value, setValue] = useState<string | null>(null);
  const [state, setState] = useState<{ busy?: boolean; error?: string; ok?: boolean }>({});
  const who = member.name ?? member.email ?? 'team member';
  useEffect(() => setMode(share?.mode ?? 'amount'), [share?.mode]);

  async function save(raw = value ?? shownValue) {
    const text = raw.trim().replace(/[%$]/g, '');
    if (text === '' && !share) return setValue(null);
    // Switched $ / % but typed nothing: nothing changes.
    if (text === '' && share && mode !== share.mode) {
      setMode(share.mode);
      return setValue(null);
    }
    let next: BrokerFeeShare | null = null;
    if (text !== '') {
      if (mode === 'percent') {
        const pct = Number(text);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setState({ error: 'Enter 0–100' });
        next = { mode: 'percent', value: Math.round(pct * 1e4) / 1e6 };
      } else {
        const cents = parseMoneyCents(text);
        if (cents === null || Number.isNaN(cents) || cents < 0) return setState({ error: 'Enter an amount' });
        next = { mode: 'amount', value: cents };
      }
    }
    if (next && share && next.mode === share.mode && next.value === share.value) return setValue(null);
    setState({ busy: true });
    const res = await setAgentBrokerFeeShare(member.userId, next);
    if (!res.ok) return setState({ error: res.message });
    onSaved();
    setValue(null);
    setState({ ok: true });
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-[var(--color-ink-500)] xl:hidden">Broker fee share</span>
      <span className="flex items-center gap-1">
        <select
          value={mode}
          onChange={(e) => {
            // A new type means a new number: the box is emptied to type it (saved on Enter / leaving the box).
            setMode(e.target.value as 'amount' | 'percent');
            setValue('');
            setState({});
          }}
          className="h-8 w-16 cursor-pointer rounded-md border border-[var(--color-ink-200)] bg-white px-2 text-sm text-[var(--color-ink-900)]"
          aria-label={`Broker fee share type for ${who}`}
        >
          <option value="amount">$</option>
          <option value="percent">%</option>
        </select>
        <input
          inputMode="decimal"
          value={value ?? shownValue}
          placeholder="Not set"
          disabled={state.busy}
          onChange={(e) => {
            setValue(e.target.value);
            setState({});
          }}
          onBlur={() => void save()}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          className="h-8 w-[4.5rem] rounded-md border border-[var(--color-ink-200)] bg-white px-2 text-sm tabular-nums text-[var(--color-ink-900)] disabled:opacity-60"
          aria-label={`Broker fee share for ${who}`}
        />
        {state.ok && <Check size={14} className="text-[var(--color-success-600)]" aria-label="Saved" />}
      </span>
      {state.error && <span className="text-[var(--color-danger-600)]">{state.error}</span>}
    </div>
  );
}

/** "Agent commission %" for one member — admins only (the database refuses anyone else). Saved on Enter or leaving the box; blank clears it. */
function CommissionRateInput({ member }: { member: TeamMember }) {
  const rates = useAgentCommissionRates();
  const saved = rates.rates[member.userId];
  const shown = saved === undefined ? '' : String(Math.round(saved * 1e6) / 1e4);
  const [value, setValue] = useState<string | null>(null);
  const [state, setState] = useState<{ busy?: boolean; error?: string; ok?: boolean }>({});
  const who = member.name ?? member.email ?? 'team member';
  if (rates.status === 'unavailable') return <p className="text-xs text-[var(--color-ink-400)]" title={rates.message}>Commission %: not available</p>;

  async function save() {
    if (value === null || value.trim() === shown) return setValue(null);
    const raw = value.trim().replace('%', '');
    const pct = raw === '' ? null : Number(raw);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return setState({ error: 'Enter 0–100' });
    setState({ busy: true });
    const res = await setAgentCommissionRate(member.userId, pct === null ? null : Math.round(pct * 1e4) / 1e6);
    if (!res.ok) return setState({ error: res.message });
    await rates.reload();
    setValue(null);
    setState({ ok: true });
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-[var(--color-ink-500)] xl:hidden">Agent commission</span>
      <span className="flex items-center gap-1.5">
        <span className="relative">
          <input
            inputMode="decimal"
            value={value ?? shown}
            placeholder="Not set"
            disabled={state.busy}
            onChange={(e) => {
              setValue(e.target.value);
              setState({});
            }}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            className={`${CONTROL} bg-white pr-6 tabular-nums text-[var(--color-ink-900)] disabled:opacity-60`}
            aria-label={`Agent commission % for ${who}`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-[var(--color-ink-400)]" aria-hidden>%</span>
        </span>
        {state.ok && <Check size={14} className="text-[var(--color-success-600)]" aria-label="Saved" />}
      </span>
      {state.error && <span className="text-[var(--color-danger-600)]">{state.error}</span>}
    </div>
  );
}

/** An agent's own commission %, read-only (set by the agency's admin). */
function MyCommission({ userId }: { userId: string }) {
  const rates = useAgentCommissionRates();
  if (rates.status !== 'ready') return null;
  const rate = rates.rates[userId];
  return (
    <Card>
      <CardBody className="pt-4 text-sm text-[var(--color-ink-700)]" data-testid="my-commission">
        Your agent commission: <strong className="text-[var(--color-ink-900)]">{rate === undefined ? 'not set yet' : formatRate(rate)}</strong>
        <span className="text-[var(--color-ink-500)]"> of the carrier commission (net × the carrier’s %) on the policies and endorsements of accounts assigned to you. Set by your agency admin.</span>
      </CardBody>
    </Card>
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
            You’ll be its admin: you invite your agents, choose their roles and see the agency’s accounts. Accounts you already created stay yours — you can share any of them with the agency later.
          </p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className={labelClass} htmlFor="agency-name">
              Agency name
            </label>
            <input id="agency-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Summit Trucking Insurance" maxLength={120} autoFocus />
          </div>
          {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
          <div>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? 'Creating…' : 'Create agency'}
            </Button>
          </div>
        </form>
        <p className="rounded-lg bg-[var(--color-ink-50)] px-3 py-2 text-xs text-[var(--color-ink-600)]">
          Is your agency already on Renewal IQ? Don’t create a new one — ask its admin to invite you. Agents join an agency only through an invitation.
        </p>
      </CardBody>
    </Card>
  );
}
