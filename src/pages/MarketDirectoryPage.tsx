import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Check, Download, ExternalLink, FileUp, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Button, Card, CardBody, Drawer, EmptyState } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { AccessStatusBadge, HowToSubmit, RuleSummary } from '../components/appetite/MarketAccessParts';
import { useAccountsStore } from '../state/useAccountsStore';
import type { AgencyCarrier } from '../services/appetite/agencyCarriers';
import { hasAccessInfo } from '../services/appetite/agencyCarriers';
import { archiveCarrierRule, importCarrierDirectory, saveCarrierRule, saveMarketAccess, type ImportCounts, type RuleInput } from '../services/supabase/carriersRepo';
import {
  IMPORT_TEMPLATE_CSV,
  RULE_CATEGORIES,
  RULE_OPERATORS,
  conditionsToText,
  importPayload,
  parseConditions,
  parseCsvText,
  parseRuleValue,
  planImport,
  planImportJson,
  relinkPlan,
  valueToText,
  type BuiltInRef,
  type ImportPlan,
  type LinkTarget,
} from '../services/appetite/directoryImport';
import { sampleAppetiteRecords } from '../data/carriers';
import type { AccessRoute, AccessStatus, CarrierRule, CoverageType, MarketAccess, MarketContact, RuleAnswer, RuleCategory, RuleOperator, RuleStrength } from '../types';
import { ACCESS_ROUTE_LABELS, ACCESS_STATUS_LABELS, COVERAGE_LABELS, RULE_ANSWER_LABELS, RULE_CATEGORY_LABELS, RULE_STRENGTH_LABELS } from '../types';
import { cn } from '../utils/cn';

/**
 * Carrier 101 — the Market Access Directory: how the agency reaches each market (route, status,
 * portal, contacts, appointment), and each market's Carrier 102 underwriting rules. Every agency
 * member can look things up; only agency admins can change them or import (the database enforces
 * it). Agency-private: nothing here is visible to other agencies.
 */

const inputClass = 'w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-sm text-[var(--color-ink-900)] focus:border-[var(--color-brand-500)] focus:outline-none';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-ink-600)]';
const STATUSES: AccessStatus[] = ['ready', 'partial', 'not_ready', 'inactive'];
const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_ACCESS: MarketAccess = { route: null, status: null, mga: null, wholesaler: null, paper: null, portalName: null, portalUrl: null, submissionEmail: null, producerCode: null, appointment: null, appointmentNotes: null, contacts: [], source: null, sourceDate: null, verifiedAt: null, notes: null };

function chainText(a: MarketAccess | null | undefined): string {
  if (!a) return '';
  return [a.wholesaler, a.mga, a.paper].filter(Boolean).join(' → ');
}

export function MarketDirectoryPage() {
  const navigate = useNavigate();
  const access = useAccountsStore((s) => s.agencyAccess);
  const carriers = useAccountsStore((s) => s.agencyCarriers);
  const reload = useAccountsStore((s) => s.reloadCarrierAppetite);
  const isAdmin = access?.role === 'admin';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AccessStatus | 'none' | null>(null);
  const [route, setRoute] = useState<AccessRoute | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    reload().then((r) => setLoadError(r.ok ? null : r.message ?? null));
  }, [reload]);

  const markets = useMemo(() => carriers.filter((c) => !c.archivedAt).sort((a, b) => a.name.localeCompare(b.name)), [carriers]);
  const q = search.trim().toLowerCase();
  const shown = markets.filter((c) => {
    const a = c.access;
    if (status === 'none' ? hasAccessInfo(a) && !!a.status : status && a?.status !== status) return false;
    if (route && a?.route !== route) return false;
    if (!q) return true;
    const hay = [c.name, a?.mga, a?.wholesaler, a?.paper, a?.portalName, a?.notes, ...(a?.contacts ?? []).flatMap((x) => [x.name, x.email])].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
  const counts = Object.fromEntries(STATUSES.map((s) => [s, markets.filter((c) => c.access?.status === s).length])) as Record<AccessStatus, number>;
  const open = markets.find((c) => c.id === openId) ?? null;

  if (!access) {
    return (
      <PageContainer title="Market Access Directory" description="How your agency reaches each market.">
        <EmptyState icon={<BookOpen size={26} strokeWidth={1.5} />} title="Join or set up an agency first" description="The directory belongs to an agency and is shared with its members only." />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Market Access Directory"
      description="How your agency reaches each market — the route, status, portal and contacts — and each market's underwriting rules. Ready means a submission route exists, not that every account fits; Market Finder checks the fit."
      actions={
        <>
          <Button variant="secondary" icon={<ArrowLeft size={15} />} onClick={() => navigate('/market-finder')}>
            Market Finder
          </Button>
          {isAdmin && (
            <Button icon={<FileUp size={15} />} onClick={() => setImportOpen(true)}>
              Import directory
            </Button>
          )}
        </>
      }
    >
      {loadError && <p className="rounded-lg border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">{loadError}</p>}
      {notice && <p className="rounded-lg border border-[var(--color-ink-100)] bg-white px-3 py-2 text-sm text-[var(--color-ink-700)]" data-testid="directory-notice">{notice}</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by access status">
          <FilterChip active={status === null} onClick={() => setStatus(null)} label={`All (${markets.length})`} />
          {STATUSES.map((s) => (
            <FilterChip key={s} active={status === s} onClick={() => setStatus(status === s ? null : s)} label={`${ACCESS_STATUS_LABELS[s]} (${counts[s]})`} />
          ))}
          <FilterChip active={route === 'direct'} onClick={() => setRoute(route === 'direct' ? null : 'direct')} label="Direct" />
          <FilterChip active={route === 'indirect'} onClick={() => setRoute(route === 'indirect' ? null : 'indirect')} label="Through intermediary" />
        </div>
        <label className="relative w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-400)]" />
          <input className={`${inputClass} pl-8`} placeholder="Search market, MGA, wholesaler, contact" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the directory" />
        </label>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={26} strokeWidth={1.5} />}
          title={markets.length === 0 ? 'No markets in your directory yet' : 'No markets match'}
          description={markets.length === 0 ? (isAdmin ? 'Import your agency’s directory, or add markets in Manage Carrier Appetite.' : 'Your agency admin can import the directory.') : undefined}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="directory-list">
          {shown.map((c) => (
            <li key={c.id}>
              <DirectoryCard carrier={c} onOpen={() => setOpenId(c.id)} />
            </li>
          ))}
        </ul>
      )}

      {open && (
        <DirectoryDrawer
          carrier={open}
          agencyName={access.agencyName}
          isAdmin={isAdmin}
          onClose={() => setOpenId(null)}
          onChanged={async (message) => {
            const r = await reload();
            setNotice(message);
            if (!r.ok) setLoadError(r.message ?? null);
          }}
        />
      )}
      {isAdmin && (
        <ImportDialog
          open={importOpen}
          existing={carriers}
          onClose={() => setImportOpen(false)}
          onImported={async (counts, fileName) => {
            setImportOpen(false);
            const r = await reload();
            setNotice(`Imported ${fileName}: ${counts.marketsAdded} new market${counts.marketsAdded === 1 ? '' : 's'}, ${counts.marketsUpdated} updated, ${counts.rulesAdded} rule${counts.rulesAdded === 1 ? '' : 's'} added, ${counts.rulesUpdated} updated.`);
            if (!r.ok) setLoadError(r.message ?? null);
          }}
        />
      )}
    </PageContainer>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('rounded-full border px-3 py-1 text-xs font-medium cursor-pointer', active ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]' : 'border-[var(--color-ink-200)] bg-white text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]')}
    >
      {label}
    </button>
  );
}

function DirectoryCard({ carrier, onOpen }: { carrier: AgencyCarrier; onOpen: () => void }) {
  const a = hasAccessInfo(carrier.access) ? carrier.access : null;
  const rules = carrier.rules ?? [];
  const verified = rules.filter((r) => r.lastVerifiedAt).length;
  return (
    <Card className="h-full cursor-pointer transition-shadow hover:[box-shadow:var(--shadow-card-hover)]" onClick={onOpen} data-testid="directory-card" data-market={carrier.name}>
      <CardBody className="flex flex-col gap-2 pt-4">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-[var(--color-ink-900)]">{carrier.name}</p>
          <AccessStatusBadge status={a?.status ?? null} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-ink-500)]">
          {a?.route && <Badge tone="neutral">{ACCESS_ROUTE_LABELS[a.route]}</Badge>}
          {chainText(a) && <span>{chainText(a)}</span>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-ink-500)]">
          <span>
            {rules.length ? `${rules.length} underwriting rule${rules.length === 1 ? '' : 's'} · ${verified} verified` : 'No underwriting rules yet'}
          </span>
          {a?.portalUrl && /^https?:\/\//i.test(a.portalUrl) && (
            <a href={a.portalUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-700)] hover:underline">
              {a.portalName || 'Portal'} <ExternalLink size={11} />
            </a>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function DirectoryDrawer({ carrier, agencyName, isAdmin, onClose, onChanged }: { carrier: AgencyCarrier; agencyName: string | null; isAdmin: boolean; onClose: () => void; onChanged: (message: string) => Promise<void> }) {
  const [editingAccess, setEditingAccess] = useState(false);
  const [editingRule, setEditingRule] = useState<CarrierRule | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = hasAccessInfo(carrier.access) ? carrier.access : null;
  const rules = carrier.rules ?? [];

  async function verifyRule(rule: CarrierRule) {
    const { id: _id, archivedAt: _a, ...rest } = rule;
    const res = await saveCarrierRule(carrier.id, { ...rest, lastVerifiedAt: today() }, rule.id);
    if (!res.ok) return setError(res.message);
    await onChanged(`Rule verified today for ${carrier.name}.`);
  }
  async function removeRule(rule: CarrierRule) {
    const res = await archiveCarrierRule(rule.id);
    if (!res.ok) return setError(res.message);
    await onChanged(`Rule removed from ${carrier.name} (kept in the record).`);
  }

  return (
    <Drawer open onClose={onClose} title={carrier.name} subtitle="Market access (Carrier 101) and underwriting rules (Carrier 102)">
      <div className="flex flex-col gap-6" data-testid="directory-drawer">
        {error && <p className="rounded-lg bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">{error}</p>}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[var(--color-ink-900)]">How to submit</h4>
            {isAdmin && !editingAccess && (
              <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={() => setEditingAccess(true)}>
                Edit access
              </Button>
            )}
          </div>
          {editingAccess ? (
            <AccessForm
              initial={a ?? EMPTY_ACCESS}
              onCancel={() => setEditingAccess(false)}
              onSave={async (next) => {
                const res = await saveMarketAccess(carrier.id, next);
                if (!res.ok) return res.message;
                setEditingAccess(false);
                await onChanged(`Access details saved for ${carrier.name}.`);
                return null;
              }}
            />
          ) : a ? (
            <HowToSubmit access={a} marketName={carrier.name} agencyName={agencyName} />
          ) : (
            <p className="text-sm text-[var(--color-ink-500)]">No access details on file yet.</p>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[var(--color-ink-900)]">Underwriting rules ({rules.length})</h4>
            {isAdmin && !editingRule && (
              <Button size="sm" icon={<Plus size={13} />} onClick={() => setEditingRule('new')}>
                Add rule
              </Button>
            )}
          </div>
          <p className="mb-3 text-xs text-[var(--color-ink-500)]">
            Only a verified hard NO can make Market Finder say Not Eligible. UNKNOWN never declines; unverified rules ask for confirmation. A source's
            own wording ("Documented: VERIFIED") is kept as a record — a rule counts as verified only once your agency confirms it here.
          </p>
          {editingRule && (
            <div className="mb-3 rounded-lg border border-[var(--color-brand-100)] bg-[var(--color-brand-50)] p-3">
              <RuleForm
                initial={editingRule === 'new' ? null : editingRule}
                onCancel={() => setEditingRule(null)}
                onSave={async (input) => {
                  const res = await saveCarrierRule(carrier.id, input, editingRule === 'new' ? undefined : editingRule.id);
                  if (!res.ok) return res.message;
                  setEditingRule(null);
                  await onChanged(`Rule saved for ${carrier.name}.`);
                  return null;
                }}
              />
            </div>
          )}
          {rules.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-500)]">None yet — this market's appetite is unknown. Market Finder shows it as Needs More Information.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {rules.map((r) => (
                <li key={r.id} className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
                  <RuleSummary rule={r} />
                  {isAdmin && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => setEditingRule(r)}>
                        Edit
                      </Button>
                      {!r.lastVerifiedAt && (
                        <Button size="sm" variant="ghost" icon={<Check size={12} />} onClick={() => void verifyRule(r)}>
                          Mark verified today
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => void removeRule(r)}>
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function AccessForm({ initial, onCancel, onSave }: { initial: MarketAccess; onCancel: () => void; onSave: (a: MarketAccess) => Promise<string | null> }) {
  const [a, setA] = useState<MarketAccess>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof MarketAccess>(k: K, v: MarketAccess[K]) => setA((x) => ({ ...x, [k]: v }));
  const text = (k: keyof MarketAccess) => ({ value: (a[k] as string | null) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, (e.target.value || null) as never) });
  const setContact = (i: number, patch: Partial<MarketContact>) => set('contacts', a.contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (a.portalUrl && !/^https?:\/\/\S+$/i.test(a.portalUrl)) return setError('The portal address must start with https://');
        setBusy(true);
        const err = await onSave(a);
        setBusy(false);
        setError(err);
      }}
      data-testid="access-form"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Status">
          <select className={inputClass} value={a.status ?? ''} onChange={(e) => set('status', (e.target.value || null) as AccessStatus | null)}>
            <option value="">Not on file</option>
            {STATUSES.map((s) => <option key={s} value={s}>{ACCESS_STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label="Route">
          <select className={inputClass} value={a.route ?? ''} onChange={(e) => set('route', (e.target.value || null) as AccessRoute | null)}>
            <option value="">Not on file</option>
            <option value="direct">{ACCESS_ROUTE_LABELS.direct}</option>
            <option value="indirect">{ACCESS_ROUTE_LABELS.indirect}</option>
          </select>
        </Field>
        <Field label="Wholesaler"><input className={inputClass} {...text('wholesaler')} /></Field>
        <Field label="MGA"><input className={inputClass} {...text('mga')} /></Field>
        <Field label="Carrier paper (underlying insurer)" className="sm:col-span-2"><input className={inputClass} {...text('paper')} /></Field>
        <Field label="Portal name"><input className={inputClass} {...text('portalName')} /></Field>
        <Field label="Portal address"><input className={inputClass} placeholder="https://" {...text('portalUrl')} /></Field>
        <Field label="Submission email"><input className={inputClass} type="email" {...text('submissionEmail')} /></Field>
        <Field label="Producer code"><input className={inputClass} {...text('producerCode')} /></Field>
        <Field label="Appointment" className="sm:col-span-2"><input className={inputClass} placeholder="e.g. Appointed through the wholesaler" {...text('appointment')} /></Field>
        <Field label="Appointment notes" className="sm:col-span-2"><textarea className={inputClass} rows={2} {...text('appointmentNotes')} /></Field>
      </div>
      <div>
        <p className={labelClass}>Contacts</p>
        <div className="flex flex-col gap-2">
          {a.contacts.map((c, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--color-ink-100)] p-2 sm:grid-cols-4">
              <input className={inputClass} placeholder="Name" aria-label="Contact name" value={c.name ?? ''} onChange={(e) => setContact(i, { name: e.target.value })} />
              <input className={inputClass} placeholder="Role (underwriter, service…)" aria-label="Contact role" value={c.role ?? ''} onChange={(e) => setContact(i, { role: e.target.value })} />
              <input className={inputClass} placeholder="Email" aria-label="Contact email" value={c.email ?? ''} onChange={(e) => setContact(i, { email: e.target.value })} />
              <div className="flex gap-1">
                <input className={inputClass} placeholder="Phone" aria-label="Contact phone" value={c.phone ?? ''} onChange={(e) => setContact(i, { phone: e.target.value })} />
                <Button type="button" size="sm" variant="ghost" aria-label="Remove contact" icon={<Trash2 size={12} />} onClick={() => set('contacts', a.contacts.filter((_, j) => j !== i))} />
              </div>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" icon={<Plus size={12} />} onClick={() => set('contacts', [...a.contacts, {}])}>
            Add contact
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Source"><input className={inputClass} placeholder="e.g. Agency cheat sheet" {...text('source')} /></Field>
        <Field label="Source date"><input className={inputClass} type="date" {...text('sourceDate')} /></Field>
        <Field label="Verified on"><input className={inputClass} type="date" {...text('verifiedAt')} /></Field>
      </div>
      <Field label="Documented status (exactly as the source states it)"><input className={inputClass} placeholder="e.g. ACTIVE / READY" {...text('documentedStatus')} /></Field>
      <Field label="Notes"><textarea className={inputClass} rows={2} {...text('notes')} /></Field>
      <p className="text-[11px] text-[var(--color-ink-400)]">Never enter passwords or logins here — they are not stored.</p>
      {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save access'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

const COVERAGES = Object.keys(COVERAGE_LABELS) as CoverageType[];

function RuleForm({ initial, onCancel, onSave }: { initial: CarrierRule | null; onCancel: () => void; onSave: (r: RuleInput) => Promise<string | null> }) {
  const [coverage, setCoverage] = useState<CoverageType | ''>(initial?.coverage ?? '');
  const [category, setCategory] = useState<RuleCategory>(initial?.category ?? 'commodity');
  const [operator, setOperator] = useState<RuleOperator>(initial?.operator ?? 'any_of');
  const [value, setValue] = useState(initial ? valueToText(initial.operator, initial.value) : '');
  const [answer, setAnswer] = useState<RuleAnswer>(initial?.answer ?? 'no');
  const [strength, setStrength] = useState<RuleStrength>(initial?.strength ?? 'soft');
  const [conditions, setConditions] = useState(initial ? conditionsToText(initial.conditions) : '');
  const [conditionsText, setConditionsText] = useState(initial?.conditionsText ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [sourceDate, setSourceDate] = useState(initial?.sourceDate ?? '');
  const [verifiedAt, setVerifiedAt] = useState(initial?.lastVerifiedAt ?? '');
  const [verifiedBy, setVerifiedBy] = useState(initial?.verifiedBy ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [documentedStatus, setDocumentedStatus] = useState(initial?.documentedStatus ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="rule-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = parseRuleValue(operator, value);
        if (v.error) return setError(v.error);
        const c = parseConditions(conditions);
        if (c.error) return setError(c.error);
        setBusy(true);
        const err = await onSave({
          coverage: coverage || null, category, operator, value: v.value, answer, strength, conditions: c.conditions,
          conditionsText: conditionsText || null, source: source || null, sourceDate: sourceDate || null, lastVerifiedAt: verifiedAt || null, verifiedBy: verifiedBy || null, notes: notes || null, documentedStatus: documentedStatus || null, ref: initial?.ref ?? null,
        });
        setBusy(false);
        setError(err);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Coverage">
          <select className={inputClass} value={coverage} onChange={(e) => setCoverage(e.target.value as CoverageType | '')}>
            <option value="">Every coverage</option>
            {COVERAGES.map((c) => <option key={c} value={c}>{COVERAGE_LABELS[c]}</option>)}
          </select>
        </Field>
        <Field label="Field / category">
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as RuleCategory)}>
            {RULE_CATEGORIES.map((c) => <option key={c} value={c}>{RULE_CATEGORY_LABELS[c]}</option>)}
          </select>
        </Field>
        <Field label="Test">
          <select className={inputClass} value={operator} onChange={(e) => setOperator(e.target.value as RuleOperator)}>
            {RULE_OPERATORS.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Value" className="sm:col-span-3">
          <input className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} placeholder="hazmat|logs · 25 · 1-10 · or the requirement in words" />
        </Field>
        <Field label="Market answer">
          <select className={inputClass} value={answer} onChange={(e) => setAnswer(e.target.value as RuleAnswer)}>
            {(['yes', 'no', 'referral', 'unknown'] as RuleAnswer[]).map((x) => <option key={x} value={x}>{RULE_ANSWER_LABELS[x]}</option>)}
          </select>
        </Field>
        <Field label="Strength">
          <select className={inputClass} value={strength} onChange={(e) => setStrength(e.target.value as RuleStrength)}>
            {(['hard', 'soft', 'info'] as RuleStrength[]).map((x) => <option key={x} value={x}>{RULE_STRENGTH_LABELS[x]}</option>)}
          </select>
        </Field>
        <Field label="Applies when (optional)">
          <input className={inputClass} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="fleet_size gt 10" />
        </Field>
        <Field label="Conditions in words (optional)" className="sm:col-span-3"><input className={inputClass} value={conditionsText} onChange={(e) => setConditionsText(e.target.value)} /></Field>
        <Field label="Source"><input className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Underwriter email, guide…" /></Field>
        <Field label="Source date"><input className={inputClass} type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} /></Field>
        <Field label="Last verified"><input className={inputClass} type="date" value={verifiedAt} onChange={(e) => setVerifiedAt(e.target.value)} /></Field>
        <Field label="Verified by"><input className={inputClass} value={verifiedBy} onChange={(e) => setVerifiedBy(e.target.value)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Documented status (as the source states it)" className="sm:col-span-3"><input className={inputClass} value={documentedStatus} onChange={(e) => setDocumentedStatus(e.target.value)} placeholder="e.g. VERIFIED, SUPPORTED — kept as a record, not a RenewalIQ verification" /></Field>
      </div>
      {answer === 'no' && strength === 'hard' && !verifiedAt && (
        <p className="text-xs text-[var(--color-warning-600)]">Not verified yet: Market Finder will ask for underwriter review rather than say Not Eligible.</p>
      )}
      {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save rule'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

const BUILT_INS: BuiltInRef[] = sampleAppetiteRecords.map((r) => ({ id: r.id, marketName: r.marketName, parentCompany: r.parentCompany, programName: r.programName }));
const targetKey = (t: LinkTarget) => `${t.kind}:${t.id}`;
const targetLabel = (t: LinkTarget) => `${t.kind === 'built-in' ? 'Built-in' : 'Your market'}: ${t.name}${t.program ? ` (${t.program} program)` : ''}`;

function ImportDialog({ open, existing, onClose, onImported }: { open: boolean; existing: AgencyCarrier[]; onClose: () => void; onImported: (counts: ImportCounts, fileName: string) => void }) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [check, setCheck] = useState<ImportCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPlan(null);
    setFileName('');
    setCheck(null);
    setError(null);
  }

  async function read(file: File) {
    reset();
    if (file.size > 5 * 1024 * 1024) return setError('That file is over 5 MB — a directory is much smaller.');
    const text = await file.text();
    setFileName(file.name);
    setPlan(/\.json$/i.test(file.name) ? planImportJson(text, existing, BUILT_INS) : planImport(parseCsvText(text), existing, BUILT_INS));
  }

  async function run(dryRun: boolean) {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const res = await importCarrierDirectory(importPayload(fileName, plan.markets), dryRun);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    if (dryRun) setCheck(res.data);
    else onImported(res.data, fileName);
  }

  const canImport = !!plan && plan.errors.length === 0 && plan.markets.length > 0;
  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Import market directory"
      subtitle="Review before anything is saved. Existing appetite is never changed, and nothing is deleted."
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            icon={<Download size={14} />}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE_CSV], { type: 'text/csv' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = 'market-directory-template.csv';
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Template
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!canImport || busy} onClick={() => void run(true)}>Check</Button>
            <Button disabled={!canImport || !check || busy} onClick={() => void run(false)} data-testid="import-confirm">{busy ? 'Working…' : 'Import'}</Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3" data-testid="import-dialog">
        <input type="file" accept=".csv,.json,text/csv,application/json" aria-label="Directory file" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} className="text-sm" />
        <p className="text-xs text-[var(--color-ink-500)]">A CSV from your spreadsheet (download the template) or the same content as JSON. The file is read in your browser; only the reviewed markets and rules are saved, to your agency only.</p>
        {error && <p className="rounded-lg bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">{error}</p>}
        {plan && plan.errors.length > 0 && (
          <div className="rounded-lg border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]" data-testid="import-errors">
            <p className="font-medium">Fix these first ({plan.errors.length}):</p>
            <ul className="mt-1 list-disc pl-5 text-xs">{plan.errors.slice(0, 30).map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        {plan && plan.warnings.length > 0 && (
          <ul className="list-disc rounded-lg bg-[var(--color-warning-50)] py-2 pl-8 pr-3 text-xs text-[var(--color-warning-700)]">{plan.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}</ul>
        )}
        {plan && plan.preview.length > 0 && (
          <div className="max-h-80 overflow-auto rounded-lg border border-[var(--color-ink-100)]">
            <table className="w-full text-left text-xs" data-testid="import-preview">
              <thead className="sticky top-0 bg-[var(--color-ink-50)] text-[var(--color-ink-500)]">
                <tr><th className="px-2 py-1.5">Market</th><th className="px-2 py-1.5">Action</th><th className="px-2 py-1.5">Link to</th><th className="px-2 py-1.5">Access</th><th className="px-2 py-1.5">Route</th><th className="px-2 py-1.5">Rules</th></tr>
              </thead>
              <tbody>
                {plan.preview.map((p) => (
                  <tr key={p.market.ref} className="border-t border-[var(--color-ink-100)]">
                    <td className="px-2 py-1.5 font-medium text-[var(--color-ink-800)]">{p.market.name}</td>
                    <td className="px-2 py-1.5">{p.action === 'new' ? (p.linkedTo ? 'New, as your version' : 'New') : `Updates “${p.existingName}”`}</td>
                    <td className="px-2 py-1.5" data-testid="import-link">
                      {p.action === 'update' && p.linkedTo?.kind === 'agency' && !p.market.linkTo ? (
                        <span className="text-[var(--color-ink-500)]">matched</span>
                      ) : p.linkedTo || p.possibleDuplicates.length ? (
                        <select
                          aria-label={`Link ${p.market.name} to`}
                          className="max-w-56 rounded border border-[var(--color-ink-200)] bg-white px-1 py-0.5 text-xs"
                          value={p.linkedTo ? targetKey(p.linkedTo) : ''}
                          onChange={(e) => {
                            const options = [...(p.linkedTo ? [p.linkedTo] : []), ...p.possibleDuplicates];
                            const target = options.find((t) => targetKey(t) === e.target.value) ?? null;
                            setCheck(null);
                            setPlan(relinkPlan(plan, p.market.ref, target, existing, BUILT_INS));
                          }}
                        >
                          <option value="">Keep separate</option>
                          {[...(p.linkedTo ? [p.linkedTo] : []), ...p.possibleDuplicates].map((t) => <option key={targetKey(t)} value={targetKey(t)}>{targetLabel(t)}</option>)}
                        </select>
                      ) : (
                        <span className="text-[var(--color-ink-400)]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{p.market.accessStatus ? ACCESS_STATUS_LABELS[p.market.accessStatus] : '—'}</td>
                    <td className="px-2 py-1.5">{chainText({ ...EMPTY_ACCESS, mga: p.market.mga, wholesaler: p.market.wholesaler, paper: p.market.paper }) || (p.market.accessRoute ? ACCESS_ROUTE_LABELS[p.market.accessRoute] : '—')}</td>
                    <td className="px-2 py-1.5">{p.market.rules.length}{p.market.rules.length ? ` (${p.verifiedHardNos} verified hard NO · ${p.unverifiedRules} not verified)` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {check && (
          <p className="rounded-lg bg-[var(--color-success-50)] px-3 py-2 text-sm text-[var(--color-success-700)]" data-testid="import-check">
            Checked with the database: {check.marketsAdded} new, {check.marketsUpdated} updated, {check.rulesAdded} rules added, {check.rulesUpdated} updated. Nothing saved yet.
          </p>
        )}
      </div>
    </Modal>
  );
}
