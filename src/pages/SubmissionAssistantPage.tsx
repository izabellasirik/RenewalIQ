import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Compass, Printer, TriangleAlert, CircleCheck, CircleHelp, Download, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { AccountNotFound } from '../components/layout/AccountNotFound';
import { Button, ProgressBar, OverflowMenu } from '../components/ui';
import { ApplicationPreview } from '../components/submission/ApplicationPreview';
import { useAccountsStore } from '../state/useAccountsStore';
import { mapRiskProfileToApplication, computeApplicationStats, APPLICATION_TEMPLATES, DEFAULT_APPLICATION_TEMPLATE_ID } from '../services/application';
import { parseDraft } from '../components/riskProfile/FieldRow';
import { RISK_PROFILE_GROUPS } from './riskProfileFieldConfig';
import { downloadBlob } from '../utils/download';
import type { CoverageType, MappedField } from '../types';

function fieldValueType(section: 'business' | 'transportation', key: string) {
  for (const group of RISK_PROFILE_GROUPS) {
    const match = group.fields.find((f) => f.section === section && f.key === key);
    if (match) return match.type;
  }
  return 'text' as const;
}

type SavableTarget = { kind: 'field'; section: 'business' | 'transportation'; key: string } | { kind: 'coverage'; coverageType: CoverageType; field: 'currentLimit' | 'requestedLimit' } | null;

function parseRiskProfilePath(path: string): SavableTarget {
  const parts = path.split('.');
  if (parts[0] === 'coverage') {
    return { kind: 'coverage', coverageType: parts[1] as CoverageType, field: (parts[2] as 'currentLimit' | 'requestedLimit') ?? 'requestedLimit' };
  }
  if (parts[0] === 'business' || parts[0] === 'transportation') {
    return { kind: 'field', section: parts[0], key: parts[1] };
  }
  return null;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function SubmissionAssistantPage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const updateField = useAccountsStore((s) => s.updateField);
  const updateCoverage = useAccountsStore((s) => s.updateCoverage);
  const [values, setValues] = useState<Record<string, string>>({});
  const [templateId, setTemplateId] = useState(DEFAULT_APPLICATION_TEMPLATE_ID);
  const [exportingPdf, setExportingPdf] = useState(false);

  const template = APPLICATION_TEMPLATES.find((t) => t.id === templateId) ?? APPLICATION_TEMPLATES[0];
  const application = useMemo(() => (profile ? mapRiskProfileToApplication(profile, template) : null), [profile, template]);
  const stats = useMemo(() => (application ? computeApplicationStats(application) : null), [application]);

  if (!account || !profile || !application || !stats) {
    return <AccountNotFound />;
  }

  function saveFieldToRiskProfile(field: MappedField, value: string) {
    if (!field.riskProfilePath) return;
    const target = parseRiskProfilePath(field.riskProfilePath);
    if (!target) return;
    if (target.kind === 'field') {
      const valueType = fieldValueType(target.section, target.key);
      updateField(accountId, target.section, target.key, parseDraft(valueType, value));
    } else {
      updateCoverage(accountId, target.coverageType, target.field, value);
    }
  }

  function resolveFieldConflict(field: MappedField) {
    if (!field.riskProfilePath) return;
    const target = parseRiskProfilePath(field.riskProfilePath);
    if (target?.kind === 'field') {
      navigate(`/accounts/${accountId}/risk-profile`, { state: { focusField: { section: target.section, key: target.key } } });
    } else {
      navigate(`/accounts/${accountId}/risk-profile`);
    }
  }

  async function handleDownloadPdf() {
    setExportingPdf(true);
    try {
      const { generateApplicationPdf } = await import('../services/application/exportApplication');
      const bytes = await generateApplicationPdf(application!, account!.namedInsured);
      downloadBlob(new Uint8Array(bytes), `${slugify(account!.namedInsured)}_${slugify(application!.templateName)}.pdf`, 'application/pdf');
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleDownloadJson() {
    const { generateApplicationJson } = await import('../services/application/exportApplication');
    downloadBlob(generateApplicationJson(application!), `${slugify(account!.namedInsured)}_application.json`, 'application/json');
  }

  async function handleDownloadCsv() {
    const { generateApplicationCsv } = await import('../services/application/exportApplication');
    downloadBlob(generateApplicationCsv(application!), `${slugify(account!.namedInsured)}_application.csv`, 'text/csv');
  }

  return (
    <PageContainer
      title={`Submission Assistant — ${account.namedInsured}`}
      description="Renewal IQ already knows this account. Review what it filled instead of retyping everything."
      actions={
        <>
          <Button variant="secondary" icon={<Printer size={15} />} onClick={() => window.print()} className="print:hidden">
            Print
          </Button>
          <OverflowMenu
            items={[
              { key: 'json', label: 'Export as JSON', icon: <FileJson size={14} />, onSelect: handleDownloadJson },
              { key: 'csv', label: 'Export as CSV', icon: <FileSpreadsheet size={14} />, onSelect: handleDownloadCsv },
            ]}
          />
          <Button icon={exportingPdf ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} onClick={handleDownloadPdf} disabled={exportingPdf} className="print:hidden">
            Download PDF
          </Button>
          <Button variant="secondary" icon={<Compass size={15} />} onClick={() => navigate(`/accounts/${accountId}/carrier-appetite`)} className="print:hidden">
            Carrier Appetite
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1 print:hidden">
        {APPLICATION_TEMPLATES.length > 1 ? (
          <select
            value={template.id}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setValues({});
            }}
            className="w-fit rounded-lg border border-[var(--color-ink-200)] px-3 py-1.5 text-sm text-[var(--color-ink-800)] outline-none focus:border-[var(--color-brand-500)]"
          >
            {APPLICATION_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm font-medium text-[var(--color-ink-700)]">{template.name}</p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-ink-100)] bg-white px-4 py-4 print:hidden">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-[var(--color-ink-900)]">Transportation Application</h2>
          <span className="text-sm font-semibold text-[var(--color-ink-900)]">{stats.percentComplete}% Complete</span>
        </div>
        <ProgressBar value={stats.percentComplete} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
          <span className="flex items-center gap-1.5 text-[var(--color-success-600)]">
            <CircleCheck size={14} />
            <span className="font-semibold text-[var(--color-ink-900)]">{stats.autoFilled + stats.manuallyEntered}</span> fields filled
          </span>
          {stats.missing > 0 && (
            <span className="flex items-center gap-1.5 text-[var(--color-warning-600)]">
              <TriangleAlert size={14} />
              <span className="font-semibold text-[var(--color-ink-900)]">{stats.missing}</span> fields missing
            </span>
          )}
          {stats.conflict > 0 && (
            <span className="flex items-center gap-1.5 text-[var(--color-danger-600)]">
              <TriangleAlert size={14} />
              <span className="font-semibold text-[var(--color-ink-900)]">{stats.conflict}</span> conflict{stats.conflict === 1 ? '' : 's'}
            </span>
          )}
          {stats.needsReview > 0 && (
            <span className="flex items-center gap-1.5 text-[var(--color-warning-600)]">
              <CircleHelp size={14} />
              <span className="font-semibold text-[var(--color-ink-900)]">{stats.needsReview}</span> need review
            </span>
          )}
          <span className="text-[var(--color-ink-400)]">{stats.itemizedRows} itemized rows mapped</span>
        </div>
        <p className="text-xs text-[var(--color-ink-400)]">This is a sample application layout for demo purposes, not a certified ACORD form.</p>
      </div>

      {stats.conflict > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-danger-300)] bg-[var(--color-danger-100)]/40 px-4 py-3 text-sm text-[var(--color-danger-700)] print:hidden">
          <TriangleAlert size={16} className="shrink-0" />
          <span>
            <span className="font-semibold">{stats.conflict}</span> conflict{stats.conflict === 1 ? '' : 's'} must be resolved in the Risk Profile before{' '}
            {stats.conflict === 1 ? 'that field can' : 'those fields can'} populate here.
          </span>
        </div>
      )}

      <ApplicationPreview
        application={application}
        values={values}
        onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
        onSaveToRiskProfile={saveFieldToRiskProfile}
        onResolveConflict={resolveFieldConflict}
      />
    </PageContainer>
  );
}
