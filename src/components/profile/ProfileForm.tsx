import { useState, type FormEvent } from 'react';
import { Button } from '../ui';
import { authInputClass as inputClass } from '../auth/AuthShell';
import { saveMyProfile, type MyProfile } from '../../services/supabase/profileRepo';
import { useAccountsStore } from '../../state/useAccountsStore';

const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-ink-600)]';

/** Full name (required), work email (the login — read-only), work phone and job title (optional). */
export function ProfileForm({ email, initial, submitLabel, onSaved }: { email: string; initial: MyProfile | null; submitLabel: string; onSaved: () => void }) {
  const setMyProfile = useAccountsStore((s) => s.setMyProfile);
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveMyProfile({ fullName, phone, jobTitle });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMyProfile(result.data);
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <label className={labelClass} htmlFor="profile-name">
          Full name <span className="text-[var(--color-danger-600)]">*</span>
        </label>
        <input id="profile-name" autoFocus autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} placeholder="e.g. John Smith" />
      </div>
      <div>
        <label className={labelClass} htmlFor="profile-email">
          Work email
        </label>
        <input id="profile-email" value={email} readOnly disabled className={`${inputClass} bg-[var(--color-ink-50)] text-[var(--color-ink-500)]`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="profile-phone">
          Work phone number <span className="font-normal text-[var(--color-ink-400)]">(optional)</span>
        </label>
        <input id="profile-phone" type="tel" autoComplete="work tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="profile-title">
          Job title <span className="font-normal text-[var(--color-ink-400)]">(optional)</span>
        </label>
        <input id="profile-title" autoComplete="organization-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className={inputClass} placeholder="e.g. Commercial Lines Broker" />
      </div>
      {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
      <Button type="submit" disabled={!fullName.trim() || saving}>
        {saving ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
