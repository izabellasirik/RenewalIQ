import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Card, CardBody } from '../components/ui';
import { useAccountsStore } from '../state/useAccountsStore';
import { sampleAccount } from '../data/sampleAccounts';

const US_STATES = ['OH', 'IN', 'KY', 'MI', 'PA', 'IL', 'TN', 'WV', 'NY', 'GA', 'TX', 'FL'];

export function NewAccountPage() {
  const navigate = useNavigate();
  const createAccount = useAccountsStore((s) => s.createAccount);
  const ensureSampleAccount = useAccountsStore((s) => s.ensureSampleAccount);
  const [namedInsured, setNamedInsured] = useState('');
  const [state, setState] = useState('OH');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!namedInsured.trim()) return;
    const id = createAccount(namedInsured.trim(), state);
    navigate(`/accounts/${id}/upload`);
  }

  function handleUseSample() {
    const id = ensureSampleAccount();
    navigate(`/accounts/${id}/upload`);
  }

  return (
    <PageContainer title="New Submission" description="Start a new account. You'll upload documents and build the risk profile next.">
      <div className="max-w-lg">
        <Card>
          <CardBody className="pt-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]">Named Insured</label>
                <input
                  autoFocus
                  value={namedInsured}
                  onChange={(e) => setNamedInsured(e.target.value)}
                  placeholder="e.g. Summit Freight Logistics LLC"
                  className="w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2.5 text-sm text-[var(--color-ink-900)] outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]">Domicile State</label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2.5 text-sm text-[var(--color-ink-900)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
                >
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={!namedInsured.trim()} className="mt-1">
                Create Submission
              </Button>
            </form>

            <div className="mt-5 flex items-center gap-3 text-xs text-[var(--color-ink-400)]">
              <div className="h-px flex-1 bg-[var(--color-ink-100)]" />
              or
              <div className="h-px flex-1 bg-[var(--color-ink-100)]" />
            </div>

            <button
              onClick={handleUseSample}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-accent-500)]/40 bg-[var(--color-accent-100)] px-4 py-3 text-sm font-medium text-[var(--color-accent-600)] hover:bg-[var(--color-accent-100)]/70 cursor-pointer"
            >
              <Sparkles size={15} />
              Use sample account — {sampleAccount.namedInsured}
            </button>
          </CardBody>
        </Card>
      </div>
    </PageContainer>
  );
}
