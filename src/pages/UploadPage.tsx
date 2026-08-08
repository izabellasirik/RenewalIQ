import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { AccountNotFound } from '../components/layout/AccountNotFound';
import { Dropzone } from '../components/upload/Dropzone';
import { DocumentList } from '../components/upload/DocumentList';
import { Button, Card, CardBody, ProgressBar } from '../components/ui';
import { useAccountsStore } from '../state/useAccountsStore';
import { EMPTY_DOCUMENTS } from '../utils/emptyArrays';

export function UploadPage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const documents = useAccountsStore((s) => s.documents[accountId]) ?? EMPTY_DOCUMENTS;
  const addFiles = useAccountsStore((s) => s.addFiles);
  const loadSampleDocuments = useAccountsStore((s) => s.loadSampleDocuments);

  if (!account) {
    return <AccountNotFound />;
  }

  const processedCount = documents.filter((d) => d.status === 'processed').length;
  const totalFields = documents.reduce((sum, d) => sum + (d.fieldsExtracted ?? 0), 0);
  const allProcessed = documents.length > 0 && processedCount === documents.length;

  return (
    <PageContainer
      title={`Upload Documents — ${account.namedInsured}`}
      description="Drag in client documents. Renewal IQ extracts key fields and builds a unified, editable risk profile."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Dropzone onFiles={(files) => addFiles(accountId, files)} />

          {documents.length === 0 && (
            <button
              onClick={() => loadSampleDocuments(accountId)}
              className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-accent-500)]/40 bg-[var(--color-accent-100)] px-4 py-3 text-sm font-medium text-[var(--color-accent-600)] hover:bg-[var(--color-accent-100)]/70 cursor-pointer"
            >
              <Sparkles size={15} />
              Load sample submission documents (application, loss run, vehicle &amp; driver schedules)
            </button>
          )}

          <DocumentList documents={documents} />
        </div>

        <Card className="h-fit">
          <CardBody className="pt-5">
            <p className="text-sm font-semibold text-[var(--color-ink-800)]">Extraction Progress</p>
            <div className="mt-3">
              <ProgressBar value={documents.length ? (processedCount / documents.length) * 100 : 0} />
              <p className="mt-2 text-xs text-[var(--color-ink-500)]">
                {processedCount} of {documents.length} document{documents.length === 1 ? '' : 's'} processed
              </p>
            </div>

            <div className="mt-4 rounded-lg bg-[var(--color-ink-50)] px-3 py-2.5 text-xs text-[var(--color-ink-600)]">
              <span className="font-semibold text-[var(--color-ink-800)]">{totalFields}</span> fields extracted so far
            </div>

            <Button
              className="mt-4 w-full"
              disabled={!allProcessed}
              icon={<ArrowRight size={15} />}
              onClick={() => navigate(`/accounts/${accountId}/risk-profile`)}
            >
              Review Risk Profile
            </Button>
          </CardBody>
        </Card>
      </div>
    </PageContainer>
  );
}
