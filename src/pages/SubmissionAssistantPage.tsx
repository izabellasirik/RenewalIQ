import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Compass, Printer, TriangleAlert } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { AccountNotFound } from '../components/layout/AccountNotFound';
import { Button, Tabs } from '../components/ui';
import { ApplicationPreview } from '../components/submission/ApplicationPreview';
import { useAccountsStore } from '../state/useAccountsStore';
import { mapRiskProfileToApplication, APPLICATION_TEMPLATES, DEFAULT_APPLICATION_TEMPLATE_ID } from '../services/application';

export function SubmissionAssistantPage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [templateId, setTemplateId] = useState(DEFAULT_APPLICATION_TEMPLATE_ID);

  const template = APPLICATION_TEMPLATES.find((t) => t.id === templateId) ?? APPLICATION_TEMPLATES[0];
  const application = useMemo(() => (profile ? mapRiskProfileToApplication(profile, template) : null), [profile, template]);

  if (!account || !profile || !application) {
    return <AccountNotFound />;
  }

  const totalFields = application.sections.reduce((sum, s) => sum + s.fields.length, 0);
  const filledFields = application.sections.reduce(
    (sum, s, sIdx) => sum + s.fields.filter((f, fIdx) => (values[`${sIdx}-${fIdx}`] ?? f.value).trim() !== '').length,
    0
  );

  return (
    <PageContainer
      title={`Submission Assistant — ${account.namedInsured}`}
      description={`${application.templateName}. Pre-filled from the risk profile — edit anything before sending to a market.`}
      actions={
        <>
          <Button variant="secondary" icon={<Printer size={15} />} onClick={() => window.print()}>
            Print / Export PDF
          </Button>
          <Button icon={<Compass size={15} />} onClick={() => navigate(`/accounts/${accountId}/carrier-appetite`)}>
            Carrier Appetite
          </Button>
        </>
      }
    >
      <div className="print:hidden">
        <Tabs
          items={APPLICATION_TEMPLATES.map((t) => ({ key: t.id, label: t.name }))}
          active={template.id}
          onChange={(key) => {
            setTemplateId(key);
            setValues({});
          }}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-[var(--color-ink-100)] bg-white px-4 py-3 text-sm print:hidden">
        <span className="text-[var(--color-ink-600)]">
          <span className="font-semibold text-[var(--color-ink-900)]">{filledFields}</span> of {totalFields} fields populated
        </span>
        <span className="text-xs text-[var(--color-ink-400)]">This is a sample application layout for demo purposes, not a certified ACORD form.</span>
      </div>

      {application.fieldsNeedingReview > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-100)]/40 px-4 py-3 text-sm text-[var(--color-warning-700)] print:hidden">
          <TriangleAlert size={16} className="shrink-0" />
          <span>
            <span className="font-semibold">{application.fieldsNeedingReview}</span> field{application.fieldsNeedingReview === 1 ? '' : 's'} need
            {application.fieldsNeedingReview === 1 ? 's' : ''} your review before this submission is ready — missing, conflicting, or low-confidence
            data was not guessed.
          </span>
        </div>
      )}

      <ApplicationPreview
        application={application}
        values={values}
        onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
      />
    </PageContainer>
  );
}
