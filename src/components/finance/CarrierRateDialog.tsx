import { useState, type FormEvent } from 'react';
import { Button, Modal } from '../ui';
import { inputClass, labelClass } from '../workspace/formStyles';
import { setCarrierCommissionRate } from '../../services/supabase/commissionRepo';
import { reloadCarrierRates } from '../../hooks/useCarrierRates';
import { useAccountsStore } from '../../state/useAccountsStore';

/**
 * An admin sets a carrier's commission % from a date, with the evidence for it (the agreement or
 * statement — separate from any policy's proof). Commissions already recorded keep the rate they were
 * recorded with; policies and endorsements recorded from now on, bound on or after the date, use it.
 */
export function CarrierRateDialog({ carrier: initialCarrier, effectiveFrom, onClose, onSaved }: { carrier?: string; effectiveFrom?: string; onClose: () => void; onSaved?: () => void }) {
  const userId = useAccountsStore((s) => s.currentUserId);
  const [carrier, setCarrier] = useState(initialCarrier ?? '');
  const [pct, setPct] = useState('');
  const [date, setDate] = useState(effectiveFrom ?? '');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(pct.trim().replace('%', ''));
    if (!carrier.trim()) return setError('Name the carrier.');
    if (!pct.trim() || !Number.isFinite(n) || n < 0 || n > 100) return setError('Enter the carrier’s commission % (0–100).');
    if (!date) return setError('Choose the date the rate applies from.');
    setSaving(true);
    const res = await setCarrierCommissionRate(carrier.trim(), Math.round(n * 1e4) / 1e6, date, evidence);
    setSaving(false);
    if (!res.ok) return setError(res.message);
    await reloadCarrierRates(userId);
    onSaved?.();
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initialCarrier ? `Carrier commission — ${initialCarrier}` : 'Set a carrier commission'}
      subtitle="What the carrier pays the agency, from a date. Commissions already recorded keep their rate; the agent commission never depends on it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="carrier-rate-form" disabled={saving}>Save rate</Button>
        </>
      }
    >
      <form id="carrier-rate-form" onSubmit={submit} noValidate className="flex flex-col gap-3" data-testid="carrier-rate-form">
        {error && <p className="rounded-lg border border-[var(--color-danger-600)]/25 bg-[var(--color-danger-100)] px-3 py-2 text-sm text-[var(--color-danger-600)]" role="alert">{error}</p>}
        {!initialCarrier && (
          <div>
            <label className={labelClass} htmlFor="rate-carrier">Carrier (writing company)</label>
            <input id="rate-carrier" className={inputClass} value={carrier} onChange={(e) => setCarrier(e.target.value)} list="market-name-options" />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="rate-pct">Carrier commission (%)</label>
            <input id="rate-pct" inputMode="decimal" className={inputClass} value={pct} onChange={(e) => setPct(e.target.value)} placeholder="e.g. 12.5" autoFocus />
          </div>
          <div>
            <label className={labelClass} htmlFor="rate-from">Applies from</label>
            <input id="rate-from" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="rate-evidence">Evidence (optional)</label>
          <input id="rate-evidence" className={inputClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={500} placeholder="e.g. Agency agreement dated 2026-01-15, schedule A" />
        </div>
        <p className="text-xs text-[var(--color-ink-500)]">Policies and endorsements bound on or after this date, and recorded from now on, use this rate. A rate entered for the same date replaces the earlier one; both stay in the history.</p>
      </form>
    </Modal>
  );
}
