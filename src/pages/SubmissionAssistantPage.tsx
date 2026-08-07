import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Compass, Printer } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button } from '../components/ui';
import { ApplicationPreview } from '../components/submission/ApplicationPreview';
import { useAccountsStore } from '../state/useAccountsStore';
import { generateApplication } from '../services/application';

export function SubmissionAssistantPage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const [values, setValues] = useState<Record<string, string>>({});

  const application = useMemo(() => (profile ? generateApplication(profile) : null), [profile]);

  if (!account || !profile || !application) {
    return (
      <PageContainer title="Account not found">
        <p className="text-sm text-[var(--color-ink-500)]">This submission doesn't exist yet.</p>
      </PageContainer>
    );
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
      <div className="flex items-center justify-between rounded-lg border border-[var(--color-ink-100)] bg-white px-4 py-3 text-sm print:hidden">
        <span className="text-[var(--color-ink-600)]">
          <span className="font-semibold text-[var(--color-ink-900)]">{filledFields}</span> of {totalFields} fields populated
        </span>
        <span className="text-xs text-[var(--color-ink-400)]">This is a sample application layout for demo purposes, not a certified ACORD form.</span>
      </div>

      <ApplicationPreview
        application={application}
        values={values}
        onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
      />
    </PageContainer>
  );
}
