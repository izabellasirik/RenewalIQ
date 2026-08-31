import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, History, ListChecks, TrendingUp, TrendingDown, Minus, Trash2 } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { AccountNotFound } from '../components/layout/AccountNotFound';
import { Button, ProgressBar, Tabs, OverflowMenu, ConfirmDialog, type OverflowMenuItem } from '../components/ui';
import { SectionCard } from '../components/riskProfile/SectionCard';
import { FieldRow } from '../components/riskProfile/FieldRow';
import { ConflictBanner } from '../components/riskProfile/ConflictBanner';
import { MissingFieldsPanel } from '../components/riskProfile/MissingFieldsPanel';
import { InsightStrip } from '../components/riskProfile/InsightStrip';
import { AccountSummary } from '../components/riskProfile/AccountSummary';
import { HistoryDrawer } from '../components/history/HistoryDrawer';
import { useAccountsStore } from '../state/useAccountsStore';
import { useRiskProfileStats } from '../hooks/useRiskProfileStats';
import { deriveVehicleSummary, deriveDriverSummary, deriveLossSummary } from '../utils/deriveInsights';
import { RISK_PROFILE_GROUPS } from './riskProfileFieldConfig';
import { COVERAGE_LABELS } from '../types';
import { formatDate } from '../utils/dates';
import { EMPTY_ACTIVITY_EVENTS, EMPTY_DOCUMENTS } from '../utils/emptyArrays';
import { cn } from '../utils/cn';

const TREND_ICON = { increasing: TrendingUp, decreasing: TrendingDown, stable: Minus, insufficient_data: Minus };
const TREND_LABEL = { increasing: 'Increasing', decreasing: 'Decreasing', stable: 'Stable', insufficient_data: 'Not enough data' };
const TREND_COLOR = {
  increasing: 'text-[var(--color-danger-600)]',
  decreasing: 'text-[var(--color-success-600)]',
  stable: 'text-[var(--color-ink-700)]',
  insufficient_data: 'text-[var(--color-ink-400)]',
};

type TabKey = 'details' | 'fleet' | 'drivers' | 'loss-history' | 'coverage';

export function RiskProfilePage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const documents = useAccountsStore((s) => s.documents[accountId]) ?? EMPTY_DOCUMENTS;
  const activityLog = useAccountsStore((s) => s.activityLog[accountId]) ?? EMPTY_ACTIVITY_EVENTS;
  const updateField = useAccountsStore((s) => s.updateField);
  const resolveField = useAccountsStore((s) => s.resolveField);
  const updateCoverage = useAccountsStore((s) => s.updateCoverage);
  const deleteAccountPermanently = useAccountsStore((s) => s.deleteAccountPermanently);
  const [tab, setTab] = useState<TabKey>('details');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [highlightFieldId, setHighlightFieldId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      deleteAccountPermanently(accountId);
      navigate('/');
    } catch {
      // Local Zustand state mutation — practically can't fail, but never remove the submission
      // from the UI or navigate away as if it succeeded when it didn't.
      setDeleting(false);
      setDeleteConfirmOpen(false);
      setDeleteError("Something went wrong deleting this submission. It hasn't been removed — try again.");
    }
  }

  function focusField(section: 'business' | 'transportation', key: string) {
    const id = `field-${section}-${key}`;
    setTab('details');
    setHighlightFieldId(id);
    requestAnimationFrame(() => {
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    });
    setTimeout(() => setHighlightFieldId((current) => (current === id ? null : current)), 2200);
  }

  // Lets other pages (e.g. Submission Assistant, on a conflict field) deep-link straight to the
  // field that needs resolving, reusing this page's existing scroll-to-and-highlight behavior
  // instead of duplicating a conflict resolver elsewhere.
  useEffect(() => {
    const target = (location.state as { focusField?: { section: 'business' | 'transportation'; key: string } } | null)?.focusField;
    if (target) focusField(target.section, target.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const stats = useRiskProfileStats(profile);
  const anyProcessing = documents.some((d) => d.status === 'processing');

  const vehicleSummary = useMemo(() => deriveVehicleSummary(profile?.vehicles ?? []), [profile?.vehicles]);
  const driverSummary = useMemo(() => deriveDriverSummary(profile?.drivers ?? []), [profile?.drivers]);
  const lossSummary = useMemo(() => deriveLossSummary(profile?.lossHistory ?? []), [profile?.lossHistory]);
  const lossRunDocs = documents.filter((d) => d.category === 'loss_run' && d.status === 'processed');

  if (!account || !profile) {
    return <AccountNotFound />;
  }

  return (
    <PageContainer
      title={`Risk Profile — ${account.namedInsured}`}
      description="Unified, editable view of everything extracted from uploaded documents. Every value shows its confidence and source."
      actions={
        <>
          <Button variant="secondary" icon={<History size={15} />} onClick={() => setHistoryOpen(true)}>
            History
          </Button>
          <Button icon={<ListChecks size={15} />} onClick={() => navigate(`/accounts/${accountId}/review`)}>
            Review Submission
          </Button>
          <OverflowMenu
            items={
              [
                {
                  key: 'delete',
                  label: 'Delete submission',
                  icon: <Trash2 size={14} />,
                  tone: 'danger',
                  onSelect: () => {
                    setDeleteError(null);
                    setDeleteConfirmOpen(true);
                  },
                },
              ] satisfies OverflowMenuItem[]
            }
          />
        </>
      }
    >
      <AccountSummary account={account} profile={profile} />

      <div className="flex items-center gap-4 rounded-lg border border-[var(--color-ink-100)] bg-white px-4 py-3">
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--color-ink-700)]">Profile Completeness</span>
            <span className="text-[var(--color-ink-500)]">
              {stats.filled} of {stats.total} fields
            </span>
          </div>
          <ProgressBar value={(stats.filled / Math.max(stats.total, 1)) * 100} className="mt-1.5" />
        </div>
      </div>

      <ConflictBanner count={stats.conflicting.length} />
      <MissingFieldsPanel
        fields={stats.missing.map((m) => ({ label: m.field.label, section: m.field.section, key: m.field.key }))}
        onFieldClick={focusField}
      />

      <Tabs
        items={[
          { key: 'details', label: 'Business & Transportation' },
          { key: 'fleet', label: 'Fleet', count: profile.vehicles.length },
          { key: 'drivers', label: 'Drivers', count: profile.drivers.length },
          { key: 'loss-history', label: 'Loss History', count: profile.lossHistory.length },
          { key: 'coverage', label: 'Coverage', count: profile.coverage.length },
        ]}
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
      />

      {tab === 'details' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {RISK_PROFILE_GROUPS.map((group, gi) => (
            <motion.div key={group.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: gi * 0.05, duration: 0.25 }}>
              <SectionCard title={group.title}>
                {group.fields.map((f) => (
                  <div
                    key={f.key}
                    id={`field-${f.section}-${f.key}`}
                    className={cn('rounded-lg transition-shadow', highlightFieldId === `field-${f.section}-${f.key}` && 'ring-2 ring-[var(--color-brand-500)]')}
                  >
                    <FieldRow
                      label={f.label}
                      valueType={f.type}
                      pending={anyProcessing}
                      field={profile[f.section][f.key as keyof (typeof profile)[typeof f.section]] as any}
                      onSave={(value) => updateField(accountId, f.section, f.key, value)}
                      onResolve={(resolution) => resolveField(accountId, f.section, f.key, resolution)}
                      autoExpand={highlightFieldId === `field-${f.section}-${f.key}`}
                    />
                  </div>
                ))}
              </SectionCard>
            </motion.div>
          ))}
        </div>
      )}

      {tab === 'fleet' && (
        <SectionCard title="Fleet" description="Itemized from uploaded vehicle schedules.">
          {profile.vehicles.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-[var(--color-ink-400)]">No vehicle schedule uploaded yet.</p>
          ) : (
            <>
              <InsightStrip
                stats={[
                  { label: 'Total Vehicles', value: String(vehicleSummary.totalVehicleCount) },
                  {
                    label: 'Vehicle Types',
                    value: vehicleSummary.vehicleTypes.length > 3 ? `${vehicleSummary.vehicleTypes.length} types` : vehicleSummary.vehicleTypes.join(', ') || '—',
                    caption: vehicleSummary.vehicleTypes.length > 3 ? vehicleSummary.vehicleTypes.join(', ') : undefined,
                  },
                  { label: 'Average Age', value: vehicleSummary.averageVehicleAge !== null ? `${vehicleSummary.averageVehicleAge.toFixed(1)} yrs` : '—' },
                  { label: 'Total Insured Value', value: vehicleSummary.totalInsuredValue !== null ? `$${vehicleSummary.totalInsuredValue.toLocaleString('en-US')}` : '—' },
                  { label: 'Manufacturers', value: vehicleSummary.manufacturers.length > 0 ? vehicleSummary.manufacturers.join(', ') : '—' },
                  {
                    label: 'Oldest Vehicle',
                    value: vehicleSummary.oldestVehicle ? String(vehicleSummary.oldestVehicle.year) : '—',
                    caption: vehicleSummary.oldestVehicle ? [vehicleSummary.oldestVehicle.make, vehicleSummary.oldestVehicle.model].filter(Boolean).join(' ') || undefined : undefined,
                  },
                  {
                    label: 'Newest Vehicle',
                    value: vehicleSummary.newestVehicle ? String(vehicleSummary.newestVehicle.year) : '—',
                    caption: vehicleSummary.newestVehicle ? [vehicleSummary.newestVehicle.make, vehicleSummary.newestVehicle.model].filter(Boolean).join(' ') || undefined : undefined,
                  },
                ]}
              />
              <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-ink-100)] text-xs text-[var(--color-ink-500)]">
                    <th className="py-2 pr-4 font-medium">VIN</th>
                    <th className="py-2 pr-4 font-medium">Make</th>
                    <th className="py-2 pr-4 font-medium">Model</th>
                    <th className="py-2 pr-4 font-medium">Year</th>
                    <th className="py-2 pr-4 font-medium">Value</th>
                    <th className="py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.vehicles.map((v) => (
                    <tr key={v.id} className="border-b border-[var(--color-ink-100)] last:border-0">
                      <td className="py-2.5 pr-4 font-mono text-xs text-[var(--color-ink-800)]">{v.vin ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{v.make ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{v.model ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{v.year ?? '—'}</td>
                      <td className="py-2.5 pr-4 font-medium text-[var(--color-ink-900)]">{v.value ? `$${v.value.toLocaleString('en-US')}` : '—'}</td>
                      <td className="py-2.5 text-xs text-[var(--color-ink-400)]">{v.source.documentName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </SectionCard>
      )}

      {tab === 'drivers' && (
        <SectionCard title="Drivers" description="Itemized from uploaded driver schedules.">
          {profile.drivers.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-[var(--color-ink-400)]">No driver schedule uploaded yet.</p>
          ) : (
            <>
              <InsightStrip
                stats={[
                  { label: 'Driver Count', value: String(driverSummary.driverCount) },
                  { label: 'Min. Age', value: driverSummary.minDriverAge !== null ? String(driverSummary.minDriverAge) : '—' },
                  { label: 'Avg. Age', value: driverSummary.averageDriverAge !== null ? driverSummary.averageDriverAge.toFixed(1) : '—' },
                  { label: 'Min. Experience', value: driverSummary.minExperience !== null ? `${driverSummary.minExperience} yrs` : '—' },
                  { label: 'Avg. Experience', value: driverSummary.averageExperience !== null ? `${driverSummary.averageExperience.toFixed(1)} yrs` : '—' },
                  {
                    label: 'Violations',
                    value: `${driverSummary.violations.driversWithViolations} of ${driverSummary.violations.totalDrivers} drivers`,
                  },
                ]}
                footer={
                  driverSummary.violations.details.length > 0 ? (
                    <span>{driverSummary.violations.details.join(' · ')}</span>
                  ) : (
                    <span>No violations reported.</span>
                  )
                }
              />
              <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-ink-100)] text-xs text-[var(--color-ink-500)]">
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">DOB</th>
                    <th className="py-2 pr-4 font-medium">License State</th>
                    <th className="py-2 pr-4 font-medium">Years Experience</th>
                    <th className="py-2 pr-4 font-medium">Violations</th>
                    <th className="py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.drivers.map((d) => (
                    <tr key={d.id} className="border-b border-[var(--color-ink-100)] last:border-0">
                      <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.name ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.dob ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.licenseState ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.yearsExperience ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{d.violations ?? '—'}</td>
                      <td className="py-2.5 text-xs text-[var(--color-ink-400)]">{d.source.documentName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </SectionCard>
      )}

      {tab === 'loss-history' && (
        <SectionCard title="Loss History" description="Consolidated from uploaded loss run documents.">
          {profile.lossHistory.length === 0 ? (
            lossRunDocs.length > 0 ? (
              <div className="px-2 py-6 text-center">
                <p className="text-sm font-medium text-[var(--color-warning-600)]">
                  {lossRunDocs.length === 1 ? 'A loss run document was' : `${lossRunDocs.length} loss run documents were`} uploaded, but no claims could be extracted.
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-500)]">
                  {lossRunDocs.some((d) => d.warnings?.length)
                    ? lossRunDocs.flatMap((d) => d.warnings ?? []).join(' ')
                    : "The document's layout wasn't recognized (expected a claims table, or one labeled claim per block with a date and amount). Try re-uploading a clearer copy."}
                </p>
              </div>
            ) : (
              <p className="px-2 py-6 text-center text-sm text-[var(--color-ink-400)]">No loss runs uploaded yet.</p>
            )
          ) : (
            <>
              <InsightStrip
                stats={[
                  { label: 'Total Claims', value: String(lossSummary.totalClaims) },
                  { label: 'Open', value: String(lossSummary.openClaims) },
                  { label: 'Closed', value: String(lossSummary.closedClaims) },
                  { label: 'Total Paid', value: `$${lossSummary.totalPaid.toLocaleString('en-US')}` },
                  { label: 'Total Reserved', value: `$${lossSummary.totalReserved.toLocaleString('en-US')}` },
                  { label: 'Total Incurred', value: `$${lossSummary.totalIncurred.toLocaleString('en-US')}` },
                  {
                    label: 'Largest Loss',
                    value: lossSummary.largestLoss ? `$${lossSummary.largestLoss.amount.toLocaleString('en-US')}` : '—',
                    caption: lossSummary.largestLoss ? `${lossSummary.largestLoss.claimType} — ${formatDate(lossSummary.largestLoss.lossDate)}` : undefined,
                  },
                ]}
                footer={
                  <span className={`inline-flex items-center gap-1.5 font-medium ${TREND_COLOR[lossSummary.trend]}`}>
                    {(() => {
                      const TrendIcon = TREND_ICON[lossSummary.trend];
                      return <TrendIcon size={13} />;
                    })()}
                    Loss Trend: {TREND_LABEL[lossSummary.trend]}
                    <span className="font-normal text-[var(--color-ink-500)]">— {lossSummary.trendDescription}</span>
                  </span>
                }
              />
              <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-ink-100)] text-xs text-[var(--color-ink-500)]">
                    <th className="py-2 pr-4 font-medium">Loss Date</th>
                    <th className="py-2 pr-4 font-medium">Claim Type</th>
                    <th className="py-2 pr-4 font-medium">Paid</th>
                    <th className="py-2 pr-4 font-medium">Reserved</th>
                    <th className="py-2 pr-4 font-medium">Incurred</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.lossHistory
                    .slice()
                    .sort((a, b) => (a.lossDate < b.lossDate ? 1 : -1))
                    .map((entry) => (
                      <tr key={entry.id} className="border-b border-[var(--color-ink-100)] last:border-0">
                        <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{formatDate(entry.lossDate)}</td>
                        <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">{entry.claimType}</td>
                        <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">${entry.paid.toLocaleString('en-US')}</td>
                        <td className="py-2.5 pr-4 text-[var(--color-ink-800)]">${entry.reserved.toLocaleString('en-US')}</td>
                        <td className="py-2.5 pr-4 font-medium text-[var(--color-ink-900)]">${entry.incurred.toLocaleString('en-US')}</td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={
                              entry.status === 'open'
                                ? 'rounded-full bg-[var(--color-warning-100)] px-2 py-0.5 text-xs font-medium text-[var(--color-warning-600)]'
                                : 'rounded-full bg-[var(--color-ink-100)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-600)]'
                            }
                          >
                            {entry.status === 'open' ? 'Open' : 'Closed'}
                          </span>
                        </td>
                        <td className="py-2.5 text-xs text-[var(--color-ink-400)]">{entry.source.documentName}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </SectionCard>
      )}

      {tab === 'coverage' && (
        <SectionCard title="Coverage" description="Expiring limits (from loss run) vs. requested limits (from application).">
          {profile.coverage.map((line) => (
            <div key={line.type} className="border-b border-[var(--color-ink-100)] py-3 last:border-0">
              <p className="mb-2 text-sm font-semibold text-[var(--color-ink-800)]">{COVERAGE_LABELS[line.type]}</p>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                <FieldRow
                  label="Current Limit"
                  valueType="text"
                  field={line.currentLimit ?? { value: null, confidence: 'low', isMissing: true, isConflicting: false }}
                  onSave={(value) => updateCoverage(accountId, line.type, 'currentLimit', value)}
                />
                <FieldRow
                  label="Requested Limit"
                  valueType="text"
                  field={line.requestedLimit}
                  onSave={(value) => updateCoverage(accountId, line.type, 'requestedLimit', value)}
                />
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      <div className="flex justify-end">
        <Button icon={<ArrowRight size={15} />} onClick={() => navigate(`/accounts/${accountId}/review`)}>
          Continue to Review
        </Button>
      </div>

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} accountName={account.namedInsured} events={activityLog} />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Delete this submission?"
        description={`This will permanently remove ${account.namedInsured} and its associated submission data. This action cannot be undone.`}
        confirmLabel="Delete submission"
        confirming={deleting}
      />
      {deleteError && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-4 py-2.5 text-sm text-[var(--color-danger-700)] shadow-lg">
          {deleteError}
        </div>
      )}
    </PageContainer>
  );
}
