import { useState } from 'react';
import { Building2, Pencil, UserCheck } from 'lucide-react';
import { Button, Card, CardBody } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { useBrokerSession } from '../../hooks/useBrokerSession';
import { formatShortDate } from '../../services/workflow/dates';
import { US_STATES } from '../../utils/usStates';
import { agentLabel } from '../../services/agency/agentLabel';
import { inputClass, labelClass } from './formStyles';

/**
 * Account basics. DOT # and effective date are the Risk Profile's own fields (edited through the
 * same updateField action), not copies — so the Submission Assistant, appetite matching, and this
 * card can never disagree.
 */
export function AccountInfoCard({ accountId }: { accountId: string }) {
  const { account, profile, dotNumber, effectiveDate } = useAccountWorkflow(accountId);
  const updateAccountInfo = useAccountsStore((s) => s.updateAccountInfo);
  const updateField = useAccountsStore((s) => s.updateField);
  const setAssignedBroker = useAccountsStore((s) => s.setAssignedBroker);
  const session = useBrokerSession();
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const agencyMembers = useAccountsStore((s) => s.agencyMembers);
  const assignAccountToAgent = useAccountsStore((s) => s.assignAccountToAgent);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [dot, setDot] = useState('');
  const [eff, setEff] = useState('');
  const [brokerName, setBrokerName] = useState('');
  const [brokerEmail, setBrokerEmail] = useState('');

  if (!account || !profile) return null;
  const rawEffective = (profile.business?.effectiveDate?.value as string | null | undefined) ?? null;

  function startEdit() {
    if (!account) return;
    setName(account.namedInsured);
    setState(account.state);
    setDot(dotNumber ?? '');
    setEff(effectiveDate ?? '');
    setBrokerName(account.assignedBroker?.name ?? '');
    setBrokerEmail(account.assignedBroker?.email ?? '');
    setEditing(true);
  }

  function save() {
    if (!account) return;
    updateAccountInfo(accountId, { namedInsured: name, state });
    if (dot.trim() !== (dotNumber ?? '')) updateField(accountId, 'transportation', 'dotNumber', dot.trim() || null);
    if (eff !== (effectiveDate ?? '')) updateField(accountId, 'business', 'effectiveDate', eff || null);
    // In an agency the assignment is the database's (admin → Agent dropdown), not this free-text label.
    if (agencyAccess) {
      setEditing(false);
      return;
    }
    const nextBroker = brokerName.trim() ? { name: brokerName.trim(), email: brokerEmail.trim() || undefined, userId: account.assignedBroker?.name === brokerName.trim() ? account.assignedBroker.userId : undefined } : null;
    if ((nextBroker?.name ?? '') !== (account.assignedBroker?.name ?? '') || (nextBroker?.email ?? '') !== (account.assignedBroker?.email ?? '')) setAssignedBroker(accountId, nextBroker);
    setEditing(false);
  }

  function assignToMe() {
    if (session.status !== 'signed_in' || !session.email) return;
    setAssignedBroker(accountId, { name: session.email, email: session.email, userId: session.userId ?? undefined });
  }

  const canAssignSelf = !agencyAccess && session.status === 'signed_in' && !!session.email && account.assignedBroker?.email !== session.email;
  const isAdmin = agencyAccess?.role === 'admin';
  const agent = agentLabel(account, agencyMembers, currentUserId);

  async function reassign(userId: string) {
    setAssigning(true);
    setAssignError(null);
    const res = await assignAccountToAgent(accountId, userId || null);
    setAssigning(false);
    if (!res.ok) setAssignError(res.message);
  }

  return (
    <Card>
      <CardBody className="pt-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
            <Building2 size={16} className="text-[var(--color-ink-500)]" />
            Account
          </h3>
          {!editing && (
            <button onClick={startEdit} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer">
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>Named insured</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>DOT #</label>
              <input value={dot} onChange={(e) => setDot(e.target.value)} className={inputClass} inputMode="numeric" placeholder="e.g. 1234567" />
            </div>
            <div>
              <label className={labelClass}>State</label>
              <select value={state} onChange={(e) => setState(e.target.value)} className={inputClass}>
                <option value="">—</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Renewal / effective date</label>
              <input type="date" value={eff} onChange={(e) => setEff(e.target.value)} className={inputClass} />
            </div>
            <div />
            {!agencyAccess && (
              <>
                <div>
                  <label className={labelClass}>Assigned broker</label>
                  <input value={brokerName} onChange={(e) => setBrokerName(e.target.value)} className={inputClass} placeholder="Name" />
                </div>
                <div>
                  <label className={labelClass}>Broker email</label>
                  <input value={brokerEmail} onChange={(e) => setBrokerEmail(e.target.value)} className={inputClass} placeholder="Optional" />
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={!name.trim()}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div className="col-span-2">
              <dt className="text-xs text-[var(--color-ink-500)]">Named insured</dt>
              <dd className="font-medium text-[var(--color-ink-900)]">{account.namedInsured}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-ink-500)]">DOT #</dt>
              <dd className={dotNumber ? 'font-semibold text-[var(--color-ink-900)]' : 'italic text-[var(--color-ink-400)]'}>{dotNumber || 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-ink-500)]">State</dt>
              <dd className="font-semibold text-[var(--color-ink-900)]">{account.state || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-ink-500)]">Renewal / effective</dt>
              <dd className={rawEffective ? 'font-medium text-[var(--color-ink-900)]' : 'italic text-[var(--color-ink-400)]'}>
                {effectiveDate ? formatShortDate(effectiveDate) : rawEffective || 'Not set'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-ink-500)]">{agencyAccess ? 'Assigned agent' : 'Assigned broker'}</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {isAdmin ? (
                  <select
                    value={account.assignedUserId ?? ''}
                    onChange={(e) => void reassign(e.target.value)}
                    disabled={assigning}
                    className="rounded-md border border-[var(--color-ink-200)] bg-white px-2 py-1 text-sm font-medium text-[var(--color-ink-900)] outline-none focus:border-[var(--color-brand-500)] disabled:opacity-60"
                    aria-label="Assigned agent"
                  >
                    <option value="">Unassigned</option>
                    {agencyMembers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                        {m.role === 'admin' ? ' (admin)' : ''}
                      </option>
                    ))}
                  </select>
                ) : agent ? (
                  <span className="font-medium text-[var(--color-ink-900)]" title={agencyAccess ? undefined : account.assignedBroker?.email}>
                    {agent}
                  </span>
                ) : (
                  <span className="italic text-[var(--color-ink-400)]">Unassigned</span>
                )}
                {assignError && <span className="basis-full text-xs text-[var(--color-danger-600)]">{assignError}</span>}
                {canAssignSelf && (
                  <button onClick={assignToMe} className="inline-flex items-center gap-0.5 text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
                    <UserCheck size={12} /> Assign to me
                  </button>
                )}
              </dd>
            </div>
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

