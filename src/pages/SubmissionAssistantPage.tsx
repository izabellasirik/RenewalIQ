import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Compass, ListChecks, TriangleAlert, CircleCheck, CircleHelp, Download, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { AccountNotFound } from '../components/layout/AccountNotFound';
import { Button, ProgressBar, OverflowMenu, ConfirmDialog } from '../components/ui';
import { ApplicationPreview } from '../components/submission/ApplicationPreview';
import { WhatsMissingPanel } from '../components/review/WhatsMissingPanel';
import { useAccountsStore } from '../state/useAccountsStore';
import { mapRiskProfileToApplication, computeApplicationStats, computeSubmissionCompleteness, applicationTitleFor, APPLICATION_TEMPLATES, DEFAULT_APPLICATION_TEMPLATE_ID } from '../services/application';
import { parseDraft } from '../components/riskProfile/FieldRow';
import { downloadBlob } from '../utils/download';
import { normalizeCurrencyText } from '../utils/currency';
import { fieldPathValueType } from '../utils/fieldLabels';
import { parseRiskProfilePath } from '../utils/riskProfilePath';
import { EMPTY_DOCUMENTS } from '../utils/emptyArrays';
import type { MappedField } from '../types';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

type ExportKind = 'pdf' | 'json' | 'csv';

export function SubmissionAssistantPage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const documents = useAccountsStore((s) => s.documents[accountId]) ?? EMPTY_DOCUMENTS;
  const updateField = useAccountsStore((s) => s.updateField);
  const updateCoverage = useAccountsStore((s) => s.updateCoverage);
  const [templateId, setTemplateId] = useState(DEFAULT_APPLICATION_TEMPLATE_ID);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pendingExport, setPendingExport] = useState<ExportKind | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [whatsMissingOpen, setWhatsMissingOpen] = useState(false);

  const template = APPLICATION_TEMPLATES.find((t) => t.id === templateId) ?? APPLICATION_TEMPLATES[0];
  const application = useMemo(() => (profile ? mapRiskProfileToApplication(profile, template) : null), [profile, template]);
  const stats = useMemo(() => (application ? computeApplicationStats(application) : null), [application]);
  const completeness = useMemo(() => (profile ? computeSubmissionCompleteness(profile, documents) : null), [profile, documents]);

  if (!account || !profile || !application || !stats || !completeness) {
    return <AccountNotFound />;
  }

  function saveFieldToRiskProfile(field: MappedField, value: string) {
    if (!field.riskProfilePath) return;
    const target = parseRiskProfilePath(field.riskProfilePath);
    if (!target) return;
    if (target.kind === 'field') {
      const valueType = fieldPathValueType(field.riskProfilePath);
      updateField(accountId, target.section, target.key, parseDraft(valueType, value));
    } else {
      // Coverage limits are free-text (a broker can write "$1M/$2M CSL"), but a plain-digit entry
      // like "100000" is normalized to "$100,000" here too — the same rule CoverageSection's own
      // FieldRow applies, so a limit reads the same whether it was edited from the Risk Profile's
      // Limits & Coverage page or from here.
      updateCoverage(accountId, target.coverageType, target.field, normalizeCurrencyText(value));
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

  async function runExport(kind: ExportKind) {
    setExportError(null);
    try {
      if (kind === 'pdf') {
        setExportingPdf(true);
        const { generateApplicationPdf } = await import('../services/application/exportApplication');
        const bytes = await generateApplicationPdf(application!, account!.namedInsured);
        downloadBlob(new Uint8Array(bytes), `${slugify(account!.namedInsured)}_${slugify(application!.templateName)}.pdf`, 'application/pdf');
      } else if (kind === 'json') {
        const { generateApplicationJson } = await import('../services/application/exportApplication');
        downloadBlob(generateApplicationJson(application!), `${slugify(account!.namedInsured)}_application.json`, 'application/json');
      } else {
        const { generateApplicationCsv } = await import('../services/application/exportApplication');
        downloadBlob(generateApplicationCsv(application!), `${slugify(account!.namedInsured)}_application.csv`, 'text/csv');
      }
    } catch (err) {
      // Never fail silently — an export that neither downloads nor explains why is indistinguishable
      // from "Continue anyway" simply not working.
      setExportError(err instanceof Error ? err.message : 'Something went wrong generating this file. Nothing was downloaded — try again.');
    } finally {
      setExportingPdf(false);
    }
  }

  /**
   * Gates export behind an explicit "continue anyway" when fields still need review — a broker can
   * always proceed (missing/conflicting fields are never force-filled, just visibly flagged). Once
   * the broker confirms, the export ALWAYS actually runs — the warning explains what's missing, it
   * never silently blocks the download afterward.
   */
  function guardExport(kind: ExportKind) {
    if (stats!.conflict + stats!.missing + stats!.needsReview > 0) {
      setPendingExport(kind);
    } else {
      runExport(kind);
    }
  }

  async function confirmPendingExport() {
    const kind = pendingExport;
    setPendingExport(null);
    if (kind) await runExport(kind);
  }

  return (
    <PageContainer
      title={`Submission Assistant — ${account.namedInsured}`}
      description="Renewal IQ already knows this account. Review what it filled instead of retyping everything."
      actions={
        <>
          <Button variant="secondary" icon={<ListChecks size={15} />} onClick={() => setWhatsMissingOpen(true)} className="print:hidden">
            What's missing?
          </Button>
          <OverflowMenu
            items={[
              { key: 'json', label: 'Export as JSON', icon: <FileJson size={14} />, onSelect: () => guardExport('json') },
              { key: 'csv', label: 'Export as CSV', icon: <FileSpreadsheet size={14} />, onSelect: () => guardExport('csv') },
            ]}
          />
          <Button icon={exportingPdf ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} onClick={() => guardExport('pdf')} disabled={exportingPdf} className="print:hidden">
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
            onChange={(e) => setTemplateId(e.target.value)}
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
          <h2 className="text-base font-semibold text-[var(--color-ink-900)]">{applicationTitleFor(account.namedInsured, application.templateName)}</h2>
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

      {exportError && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-danger-300)] bg-[var(--color-danger-100)]/40 px-4 py-3 text-sm text-[var(--color-danger-700)] print:hidden">
          <TriangleAlert size={16} className="shrink-0" />
          {exportError}
        </div>
      )}

      <ApplicationPreview application={application} onSaveToRiskProfile={saveFieldToRiskProfile} onResolveConflict={resolveFieldConflict} />

      <ConfirmDialog
        open={pendingExport !== null}
        onCancel={() => setPendingExport(null)}
        onConfirm={confirmPendingExport}
        variant="default"
        title="This application isn't complete yet"
        description={`${stats.conflict + stats.missing + stats.needsReview} field${stats.conflict + stats.missing + stats.needsReview === 1 ? '' : 's'} require review before this application is complete${
          stats.conflict > 0 ? ` — including ${stats.conflict} unresolved conflict${stats.conflict === 1 ? '' : 's'}, which will print blank rather than a guessed value` : ''
        }. You can continue anyway, or go resolve them first.`}
        confirmLabel="Continue anyway"
        cancelLabel="Review fields"
      />

      <WhatsMissingPanel
        open={whatsMissingOpen}
        onClose={() => setWhatsMissingOpen(false)}
        completeness={completeness}
        onUpdateField={(section, key, value) => updateField(accountId, section, key, value)}
        onUpdateCoverage={(coverageType, field, value) => updateCoverage(accountId, coverageType, field, value)}
      />
    </PageContainer>
  );
}
