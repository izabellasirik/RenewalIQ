import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Compass, FileText as FileTextIcon } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, ProgressBar, Tabs } from '../components/ui';
import { SectionCard } from '../components/riskProfile/SectionCard';
import { FieldRow } from '../components/riskProfile/FieldRow';
import { ConflictBanner } from '../components/riskProfile/ConflictBanner';
import { MissingFieldsPanel } from '../components/riskProfile/MissingFieldsPanel';
import { useAccountsStore } from '../state/useAccountsStore';
import { BUSINESS_FIELDS, TRANSPORTATION_FIELDS } from './riskProfileFieldConfig';
import { COVERAGE_LABELS } from '../types';
import { formatDate } from '../utils/dates';

type TabKey = 'details' | 'loss-history' | 'coverage';

export function RiskProfilePage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const updateField = useAccountsStore((s) => s.updateField);
  const [tab, setTab] = useState<TabKey>('details');

  const stats = useMemo(() => {
    if (!profile) return { missing: [] as string[], conflicts: 0, total: 0, filled: 0 };
    const missing: string[] = [];
    let conflicts = 0;
    let filled = 0;
    const total = BUSINESS_FIELDS.length + TRANSPORTATION_FIELDS.length;

    for (const f of BUSINESS_FIELDS) {
      const field = (profile.business as unknown as Record<string, { isMissing: boolean; isConflicting: boolean }>)[f.key];
      if (field.isMissing) missing.push(f.label);
      else filled++;
      if (field.isConflicting) conflicts++;
    }
    for (const f of TRANSPORTATION_FIELDS) {
      const field = (profile.transportation as unknown as Record<string, { isMissing: boolean; isConflicting: boolean }>)[f.key];
      if (field.isMissing) missing.push(f.label);
      else filled++;
      if (field.isConflicting) conflicts++;
    }
    return { missing, conflicts, total, filled };
  }, [profile]);

  if (!account || !profile) {
    return (
      <PageContainer title="Account not found">
        <p className="text-sm text-[var(--color-ink-500)]">This submission doesn't exist yet.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={`Risk Profile — ${account.namedInsured}`}
      description="Unified, editable view of everything extracted from uploaded documents. Every value shows its confidence and source."
      actions={
        <>
          <Button variant="secondary" icon={<FileTextIcon size={15} />} onClick={() => navigate(`/accounts/${accountId}/submission-assistant`)}>
            Submission Assistant
          </Button>
          <Button icon={<Compass size={15} />} onClick={() => navigate(`/accounts/${accountId}/carrier-appetite`)}>
            Carrier Appetite
          </Button>
        </>
      }
    >
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

      <ConflictBanner count={stats.conflicts} />
      <MissingFieldsPanel fields={stats.missing} />

      <Tabs
        items={[
          { key: 'details', label: 'Business & Transportation' },
          { key: 'loss-history', label: 'Loss History', count: profile.lossHistory.length },
          { key: 'coverage', label: 'Coverage', count: profile.coverage.length },
        ]}
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
      />

      {tab === 'details' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <SectionCard title="Business Information">
            {BUSINESS_FIELDS.map((f) => (
              <FieldRow
                key={f.key}
                label={f.label}
                valueType={f.type}
                field={profile.business[f.key as keyof typeof profile.business] as any}
                onSave={(value) => updateField(accountId, 'business', f.key, value)}
              />
            ))}
          </SectionCard>

          <SectionCard title="Transportation & Fleet">
            {TRANSPORTATION_FIELDS.map((f) => (
              <FieldRow
                key={f.key}
                label={f.label}
                valueType={f.type}
                field={profile.transportation[f.key as keyof typeof profile.transportation] as any}
                onSave={(value) => updateField(accountId, 'transportation', f.key, value)}
              />
            ))}
          </SectionCard>
        </div>
      )}

      {tab === 'loss-history' && (
        <SectionCard title="Loss History" description="Consolidated from uploaded loss run documents.">
          {profile.lossHistory.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-[var(--color-ink-400)]">No loss runs uploaded yet.</p>
          ) : (
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
                  readOnly
                  field={line.currentLimit ?? { value: null, confidence: 'low', isMissing: true, isConflicting: false }}
                  onSave={() => {}}
                />
                <FieldRow label="Requested Limit" valueType="text" readOnly field={line.requestedLimit} onSave={() => {}} />
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      <div className="flex justify-end">
        <Button icon={<ArrowRight size={15} />} onClick={() => navigate(`/accounts/${accountId}/submission-assistant`)}>
          Continue to Submission Assistant
        </Button>
      </div>
    </PageContainer>
  );
}
