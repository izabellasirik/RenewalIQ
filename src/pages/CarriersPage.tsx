import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive as ArchiveIcon, ArchiveRestore, ArrowLeft, Building2, Pencil, Plus, Search } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Button, Card, CardBody, ConfirmDialog, Drawer, EmptyState, Tabs } from '../components/ui';
import { inputClass, labelClass, linkButtonClass } from '../components/workspace/formStyles';
import { useAccountsStore } from '../state/useAccountsStore';
import { sampleAppetiteRecords } from '../data/carriers';
import { formatShortDate } from '../services/workflow/dates';
import {
  OPERATION_TYPE_LABELS,
  formToSavedCriteria,
  recordToForm,
  unknownStateCodes,
  type AgencyCarrier,
  type CriteriaForm,
  type OperationType,
  type RuleStrictness,
} from '../services/appetite/agencyCarriers';
import { saveAgencyCarrier, setAgencyCarrierArchived } from '../services/supabase/carriersRepo';
import type { AppetiteRecord, MarketType } from '../types';

const BUILT_IN = new Map(sampleAppetiteRecords.map((r) => [r.id, r]));

/** One row on the page: a carrier Market Finder uses now (a built-in, the agency's version of one, or the agency's own). */
interface Row {
  key: string;
  name: string;
  record?: AppetiteRecord;
  carrier?: AgencyCarrier;
  builtIn?: AppetiteRecord;
}

function summary(r: AppetiteRecord): string {
  const f = recordToForm(r);
  const parts: string[] = [];
  if (f.statesAdmitted) parts.push(`States: ${f.statesAdmitted.split(', ').length > 6 ? `${f.statesAdmitted.split(', ').length} states` : f.statesAdmitted}`);
  else if (f.statesExcluded) parts.push(`All states except ${f.statesExcluded}`);
  if (f.fleetMin || f.fleetMax) parts.push(`Fleet ${f.fleetMin || '1'}–${f.fleetMax || '∞'}`);
  if (f.yearsMin) parts.push(`${f.yearsMin}+ yrs in business`);
  if (f.yearsMax) parts.push(`new ventures under ${f.yearsMax} yrs`);
  if (f.driverExperienceMin) parts.push(`drivers ${f.driverExperienceMin}+ yrs exp`);
  if (f.driverAgeMin) parts.push(`drivers ${f.driverAgeMin}+ years old`);
  if (f.maxRadiusMiles) parts.push(`radius up to ${f.maxRadiusMiles} mi`);
  if (f.operationTypes.length) parts.push(f.operationTypes.map((o) => OPERATION_TYPE_LABELS[o]).join('/'));
  return parts.join(' · ') || 'No appetite criteria on file';
}

/**
 * Carrier Appetite, for agency admins: the carriers the agency writes with and their appetite.
 * Market Finder matches every account in the agency against this list right after a change.
 * Everyone in the agency uses it; only admins change it — the database enforces that
 * (0023_agency_carriers.sql), this page just doesn't offer it to anyone else.
 */
export function CarriersPage() {
  const navigate = useNavigate();
  const access = useAccountsStore((s) => s.agencyAccess);
  const cloudHydratedFor = useAccountsStore((s) => s.cloudHydratedFor);
  const records = useAccountsStore((s) => s.effectiveAppetiteRecords);
  const carriers = useAccountsStore((s) => s.agencyCarriers);
  const reload = useAccountsStore((s) => s.reloadCarrierAppetite);
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    reload().then((r) => setLoadError(r.ok ? null : r.message ?? null));
  }, [reload]);

  const rows = useMemo(() => {
    const byCarrier = new Map(carriers.map((c) => [c.id, c]));
    const active: Row[] = records.map((r) => {
      const carrier = r.agencyCarrier ? byCarrier.get(r.agencyCarrier.carrierId) : undefined;
      return { key: r.id, name: r.marketName, record: r, carrier, builtIn: BUILT_IN.get(carrier?.baseRecordId ?? r.id) };
    });
    const archived: Row[] = carriers
      .filter((c) => c.archivedAt)
      .map((c) => ({ key: c.id, name: c.name, carrier: c, builtIn: c.baseRecordId ? BUILT_IN.get(c.baseRecordId) : undefined }));
    return { active, archived };
  }, [records, carriers]);

  const isAdmin = access?.role === 'admin';
  // Brokers only see the Market Finder itself; agency data isn't known until roles have loaded.
  if (!access || !isAdmin) {
    return access || cloudHydratedFor ? <Navigate to="/market-finder" replace /> : null;
  }

  const q = search.trim().toLowerCase();
  const list = (view === 'active' ? rows.active : rows.archived).filter((r) => !q || r.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));

  async function archive(row: Row, archived: boolean) {
    setBusy(true);
    let res: { ok: boolean; message?: string };
    if (row.carrier) {
      res = await setAgencyCarrierArchived(row.carrier.id, archived);
    } else {
      // A built-in the agency hasn't edited: record the agency's (unchanged) version, then archive it.
      const created = await saveAgencyCarrier({ baseRecordId: row.key, name: row.name, marketType: row.record!.marketType, availableThrough: null, website: null, contactName: null, contactEmail: null, contactPhone: null, criteria: {}, strictness: 'hard', notes: null });
      res = created.ok ? await setAgencyCarrierArchived(created.data.id, true) : created;
    }
    const after = await reload();
    setBusy(false);
    setArchiving(null);
    setNotice(res.ok ? `${row.name} ${archived ? 'archived — Market Finder no longer suggests it' : 'restored'}.` : res.message ?? "Couldn't update the carrier.");
    if (!after.ok) setLoadError(after.message ?? null);
  }

  return (
    <PageContainer
      title="Manage Carrier Appetite"
      description="Your agency's carriers and what they write. Market Finder matches every account against this list as soon as you save."
      actions={
        <>
          <Button variant="secondary" icon={<ArrowLeft size={15} />} onClick={() => navigate('/market-finder')}>
            Market Finder
          </Button>
          <Button icon={<Plus size={15} />} onClick={() => setEditing('new')}>
            Add carrier
          </Button>
        </>
      }
    >
      {loadError && <p className="rounded-lg border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">{loadError}</p>}
      {notice && <p className="rounded-lg border border-[var(--color-ink-100)] bg-white px-3 py-2 text-sm text-[var(--color-ink-700)]">{notice}</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          items={[
            { key: 'active', label: 'Active', count: rows.active.length },
            { key: 'archived', label: 'Archived', count: rows.archived.length },
          ]}
          active={view}
          onChange={(k) => setView(k as 'active' | 'archived')}
        />
        <label className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" />
          <input className={`${inputClass} pl-8`} placeholder="Search carriers" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search carriers" />
        </label>
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Building2 size={26} strokeWidth={1.5} />} title={view === 'active' ? 'No carriers match' : 'No archived carriers'} description={view === 'archived' ? 'Archived carriers stay here and can be restored.' : undefined} />
      ) : (
        <Card>
          <CardBody className="divide-y divide-[var(--color-ink-100)] p-0">
            {list.map((row) => (
              <div key={row.key} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-900)]">
                    {row.name}
                    {row.carrier && !row.carrier.baseRecordId ? <Badge tone="brand">Your carrier</Badge> : row.carrier ? <Badge tone="info">Edited</Badge> : <Badge>Built-in</Badge>}
                    <span className="text-xs font-normal text-[var(--color-ink-500)]">{(row.record?.marketType ?? row.carrier?.marketType) === 'mga' ? 'MGA' : 'Direct'}</span>
                  </p>
                  <p className="truncate text-xs text-[var(--color-ink-500)]">
                    {row.record ? summary(row.record) : `Archived ${row.carrier?.archivedAt ? formatShortDate(row.carrier.archivedAt) : ''}`}
                    {row.carrier && view === 'active' && ` · updated ${formatShortDate(row.carrier.updatedAt)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {view === 'active' ? (
                    <>
                      <button className={linkButtonClass} onClick={() => setEditing(row)}>
                        <Pencil size={12} /> Edit
                      </button>
                      <button className={linkButtonClass} onClick={() => setArchiving(row)}>
                        <ArchiveIcon size={12} /> Archive
                      </button>
                    </>
                  ) : (
                    <button className={linkButtonClass} onClick={() => archive(row, false)} disabled={busy}>
                      <ArchiveRestore size={12} /> Restore
                    </button>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <CarrierDrawer
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={async (name) => {
          setEditing(null);
          const after = await reload();
          setNotice(`${name} saved — Market Finder is using it now.`);
          if (!after.ok) setLoadError(after.message ?? null);
        }}
      />
      <ConfirmDialog
        open={!!archiving}
        onCancel={() => setArchiving(null)}
        onConfirm={() => archiving && archive(archiving, true)}
        title={`Archive ${archiving?.name ?? 'this carrier'}?`}
        description="Market Finder stops suggesting it for your agency. Quotes already on accounts keep it, and you can restore it from Archived."
        confirmLabel="Archive carrier"
        confirming={busy}
        variant="default"
      />
    </PageContainer>
  );
}

interface FormState extends CriteriaForm {
  name: string;
  marketType: MarketType;
  availableThrough: string;
  website: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  strictness: RuleStrictness;
  notes: string;
}

function initialForm(row: Row | 'new'): FormState {
  if (row === 'new') {
    return { ...recordToForm(undefined), name: '', marketType: 'direct', availableThrough: '', website: '', contactName: '', contactEmail: '', contactPhone: '', strictness: 'hard', notes: '' };
  }
  const c = row.carrier;
  const r = row.record;
  return {
    ...recordToForm(r ?? (c?.baseRecordId ? row.builtIn : undefined)),
    name: c?.name ?? row.name,
    marketType: c?.marketType ?? r?.marketType ?? 'direct',
    availableThrough: c?.availableThrough ?? r?.availableThrough ?? '',
    website: c?.website ?? '',
    contactName: c?.contactName ?? '',
    contactEmail: c?.contactEmail ?? '',
    contactPhone: c?.contactPhone ?? '',
    strictness: c?.strictness ?? 'hard',
    notes: c?.notes ?? '',
  };
}

function CarrierDrawer({ row, onClose, onSaved }: { row: Row | 'new' | null; onClose: () => void; onSaved: (name: string) => void }) {
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(row ? initialForm(row) : null);
    setError(null);
  }, [row]);

  if (!row || !form) return null;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const builtIn = row === 'new' ? undefined : row.builtIn;
  const badStates = [...unknownStateCodes(form.statesAdmitted), ...unknownStateCodes(form.statesExcluded)];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    setSaving(true);
    setError(null);
    const existing = row === 'new' ? undefined : row?.carrier;
    const res = await saveAgencyCarrier(
      {
        baseRecordId: existing ? existing.baseRecordId : builtIn ? builtIn.id : null,
        name: form.name,
        marketType: form.marketType,
        availableThrough: form.marketType === 'mga' ? form.availableThrough : null,
        website: form.website,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        criteria: formToSavedCriteria(form, builtIn),
        strictness: form.strictness,
        notes: form.notes,
      },
      existing?.id
    );
    setSaving(false);
    if (!res.ok) return setError(res.message);
    onSaved(form.name.trim());
  }

  const field = (label: string, k: keyof FormState, props: { placeholder?: string; type?: string; inputMode?: 'numeric' | 'decimal' } = {}) => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input className={inputClass} value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} {...props} />
    </label>
  );
  const section = 'mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-500)]';

  return (
    <Drawer
      open
      onClose={onClose}
      title={row === 'new' ? 'Add carrier' : `Edit ${row.name}`}
      subtitle={builtIn ? 'Built-in carrier — your changes apply to your agency only. Anything you leave as it is keeps the built-in appetite.' : 'Blank fields mean "not on file" — Market Finder shows them as needing confirmation.'}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        {field('Carrier name', 'name', { placeholder: 'e.g. Blue Ridge Mutual' })}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>Type</span>
            <select className={inputClass} value={form.marketType} onChange={(e) => set('marketType', e.target.value as MarketType)}>
              <option value="direct">Direct carrier</option>
              <option value="mga">MGA</option>
            </select>
          </label>
          {form.marketType === 'mga' ? field('Writes on paper of', 'availableThrough', { placeholder: 'Carrier name' }) : <div />}
        </div>

        <p className={section}>Contact</p>
        {field('Website', 'website', { placeholder: 'https://' })}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {field('Contact name', 'contactName')}
          {field('Email', 'contactEmail', { type: 'email' })}
          {field('Phone', 'contactPhone')}
        </div>

        <p className={section}>Appetite</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('States written', 'statesAdmitted', { placeholder: 'e.g. TX, OK, LA — blank = all' })}
          {field('States excluded', 'statesExcluded', { placeholder: 'e.g. NY, NJ' })}
        </div>
        {badStates.length > 0 && <p className="-mt-1 text-xs text-[var(--color-danger-600)]">Not a state code, will be ignored: {badStates.join(', ')}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {field('Fleet min (units)', 'fleetMin', { inputMode: 'numeric' })}
          {field('Fleet max (units)', 'fleetMax', { inputMode: 'numeric' })}
          {field('Min years in business', 'yearsMin', { inputMode: 'decimal' })}
          {field('New ventures: max years', 'yearsMax', { inputMode: 'decimal' })}
          {field('Min driver experience (yrs)', 'driverExperienceMin', { inputMode: 'decimal' })}
          {field('Min driver age', 'driverAgeMin', { inputMode: 'numeric' })}
          {field('Max radius (miles)', 'maxRadiusMiles', { inputMode: 'numeric' })}
          {field('Max claims (3 yrs)', 'maxClaims3y', { inputMode: 'numeric' })}
        </div>
        <fieldset>
          <legend className={labelClass}>Operations written</legend>
          <div className="flex flex-wrap gap-3 text-sm text-[var(--color-ink-700)]">
            {(Object.keys(OPERATION_TYPE_LABELS) as OperationType[]).map((o) => (
              <label key={o} className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={form.operationTypes.includes(o)} onChange={(e) => set('operationTypes', e.target.checked ? [...form.operationTypes, o] : form.operationTypes.filter((x) => x !== o))} />
                {OPERATION_TYPE_LABELS[o]}
              </label>
            ))}
          </div>
        </fieldset>
        {field('Commodities written', 'commodities', { placeholder: 'e.g. Dry van, Reefer, Flatbed' })}
        {field('Excluded operations / risks', 'exclusions', { placeholder: 'e.g. Hazmat, Logging, Auto hauling' })}
        <label className="block">
          <span className={labelClass}>How Market Finder applies the criteria you set</span>
          <select className={inputClass} value={form.strictness} onChange={(e) => set('strictness', e.target.value as RuleStrictness)}>
            <option value="hard">Requirements — rule an account out when it doesn't meet them</option>
            <option value="guideline">Guidelines — flag it, but never rule it out</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Notes</span>
          <textarea className={`${inputClass} min-h-20`} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Underwriter preferences, submission tips…" />
        </label>

        {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!form.name.trim() || saving}>
            {saving ? 'Saving…' : 'Save carrier'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
