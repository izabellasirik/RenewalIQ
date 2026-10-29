import { useCallback, useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button, Card, CardBody, Skeleton } from '../ui';
import { fetchReferralSources, saveReferralSource, type ReferralSource } from '../../services/supabase/partnersRepo';
import { reloadReferralSources } from '../../hooks/useReferralSources';
import { centsInput, parseMoneyCents } from '../../services/workflow/policies';

const input = 'h-9 rounded-md border border-[var(--color-ink-200)] bg-white px-2.5 text-sm text-[var(--color-ink-900)]';

/**
 * Team and Partners → Partnerships (admins): where clients come from (the "Referral source" every new
 * submission asks for) and each partner's agreed amount — paid once per client, from the broker fee (0081).
 */
export function PartnershipsPanel() {
  const [list, setList] = useState<ReferralSource[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await fetchReferralSources();
    if (r.ok) setList(r.data);
    else {
      setList([]);
      setError(r.message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const saved = async () => {
    await load();
    void reloadReferralSources();
  };

  return (
    <div className="flex flex-col gap-4" data-testid="partnerships">
      <p className="text-sm text-[var(--color-ink-600)]">
        Where clients come from. Agents pick one on every new submission (“No referral” is always offered first). A partner’s agreed amount is paid <span className="font-medium text-[var(--color-ink-800)]">once per client</span>, from the broker fee on the client’s first policy — never from the carrier commission. Only admins see the amounts.
      </p>
      {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
      <Card>
        <CardBody className="pt-4">
          <NewPartnerRow onSaved={saved} />
          {list === null ? (
            <Skeleton variant="block" className="mt-3 h-16 w-full" />
          ) : list.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-500)]">No partners yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-ink-100)]">
              <li className="hidden grid-cols-[minmax(0,1fr)_10rem_6rem_6rem] gap-3 pb-2 text-xs font-medium text-[var(--color-ink-500)] sm:grid" aria-hidden>
                <span>Partner / referral source</span>
                <span>Agreed amount per client</span>
                <span>Active</span>
                <span />
              </li>
              {list.map((p) => (
                <PartnerRow key={p.id} partner={p} onSaved={saved} />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function NewPartnerRow({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    const cents = amount.trim() ? parseMoneyCents(amount) : null;
    if (!name.trim()) return setError('Enter the partner’s name.');
    if (cents !== null && (Number.isNaN(cents) || cents < 0)) return setError('Enter the agreed amount in dollars, e.g. 50.00.');
    setBusy(true);
    const r = await saveReferralSource(null, name, cents, true);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setName('');
    setAmount('');
    setError('');
    onSaved();
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Partner name, e.g. Safety" className={input} aria-label="New partner name" />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount, e.g. 50.00" inputMode="decimal" className={input} aria-label="Agreed amount per client" />
        <Button icon={<Plus size={14} />} onClick={() => void add()} disabled={busy}>
          Add partner
        </Button>
      </div>
      {error && <p className="text-xs text-[var(--color-danger-600)]">{error}</p>}
    </div>
  );
}

function PartnerRow({ partner, onSaved }: { partner: ReferralSource; onSaved: () => void }) {
  const [name, setName] = useState(partner.name);
  const [amount, setAmount] = useState(centsInput(partner.partnerFeeCents ?? undefined));
  const [active, setActive] = useState(partner.active);
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; error?: string }>({});
  const dirty = name.trim() !== partner.name || amount !== centsInput(partner.partnerFeeCents ?? undefined) || active !== partner.active;
  async function save() {
    const cents = amount.trim() ? parseMoneyCents(amount) : null;
    if (cents !== null && (Number.isNaN(cents) || cents < 0)) return setState({ error: 'Enter the amount in dollars.' });
    setState({ busy: true });
    const r = await saveReferralSource(partner.id, name, cents, active);
    if (!r.ok) return setState({ error: r.message });
    setState({ ok: true });
    onSaved();
  }
  return (
    <li className="grid grid-cols-1 items-center gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_10rem_6rem_6rem] sm:gap-3" data-testid="partner-row">
      <input value={name} onChange={(e) => setName(e.target.value)} className={input} aria-label="Partner name" />
      <span className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-[var(--color-ink-400)]">$</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="No amount" inputMode="decimal" className={`${input} w-full pl-6 tabular-nums`} aria-label={`Agreed amount for ${partner.name}`} />
      </span>
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-[var(--color-ink-700)]">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
      </label>
      <span className="flex items-center gap-1.5">
        {dirty ? (
          <Button size="sm" onClick={() => void save()} disabled={state.busy}>
            Save
          </Button>
        ) : (
          state.ok && <Check size={15} className="text-[var(--color-success-600)]" aria-label="Saved" />
        )}
        {state.error && <span className="text-xs text-[var(--color-danger-600)]">{state.error}</span>}
      </span>
    </li>
  );
}
