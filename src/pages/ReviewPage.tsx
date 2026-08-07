import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, CircleHelp, Sparkles, TriangleAlert } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { AccountNotFound } from '../components/layout/AccountNotFound';
import { Button, Card, CardBody } from '../components/ui';
import { FieldRow } from '../components/riskProfile/FieldRow';
import { SuggestedFixRow } from '../components/review/SuggestedFixRow';
import { useAccountsStore } from '../state/useAccountsStore';
import { useRiskProfileStats } from '../hooks/useRiskProfileStats';
import { cn } from '../utils/cn';

function StatCard({
  icon,
  tone,
  label,
  value,
}: {
  icon: ReactNode;
  tone: 'success' | 'warning' | 'neutral';
  label: string;
  value: number;
}) {
  const toneClasses = {
    success: 'bg-[var(--color-success-100)] text-[var(--color-success-600)]',
    warning: 'bg-[var(--color-warning-100)] text-[var(--color-warning-600)]',
    neutral: 'bg-[var(--color-ink-100)] text-[var(--color-ink-600)]',
  }[tone];

  return (
    <Card>
      <CardBody className="flex items-center gap-3 pt-5">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', toneClasses)}>{icon}</div>
        <div>
          <p className="text-2xl font-semibold leading-none text-[var(--color-ink-900)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--color-ink-500)]">{label}</p>
        </div>
      </CardBody>
    </Card>
  );
}

export function ReviewPage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const updateField = useAccountsStore((s) => s.updateField);
  const stats = useRiskProfileStats(profile);
  const [showCompleted, setShowCompleted] = useState(false);

  if (!account || !profile) {
    return <AccountNotFound />;
  }

  const isClean = stats.missing.length === 0 && stats.conflicting.length === 0;

  return (
    <PageContainer
      title={`Submission Review — ${account.namedInsured}`}
      description="An AI-assisted pass over the risk profile before the application is generated."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={<CheckCircle2 size={19} />} tone="success" label="Fields completed" value={stats.completed.length + stats.conflicting.length} />
        <StatCard icon={<CircleHelp size={19} />} tone="neutral" label="Fields missing" value={stats.missing.length} />
        <StatCard icon={<TriangleAlert size={19} />} tone="warning" label="Conflicting values" value={stats.conflicting.length} />
      </div>

      {isClean && (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--color-success-100)] bg-[var(--color-success-100)]/40 px-4 py-3">
          <CheckCircle2 size={17} className="shrink-0 text-[var(--color-success-600)]" />
          <p className="text-sm text-[var(--color-success-600)]">
            Everything looks resolved. The submission is ready to generate an application.
          </p>
        </div>
      )}

      {stats.conflicting.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
              <TriangleAlert size={15} className="text-[var(--color-warning-600)]" />
              Conflicting Information
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">
              These fields have different values from different documents. Renewal IQ picked the higher-confidence value automatically — confirm or override below.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {stats.conflicting.map((entry, i) => (
              <motion.div key={entry.field.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.2 }}>
                <SuggestedFixRow entry={entry} onResolve={(value) => updateField(accountId, entry.field.section, entry.field.key, value)} />
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {stats.missing.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
              <CircleHelp size={15} className="text-[var(--color-ink-500)]" />
              Missing Information
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">Not found in any uploaded document. Fill these in now, or continue and address them later.</p>
          </div>
          <Card>
            <CardBody className="flex flex-col gap-1 pt-2">
              {stats.missing.map((entry) => (
                <div key={entry.field.key} className="border-b border-[var(--color-ink-100)] py-1 last:border-0">
                  <FieldRow
                    label={`${entry.field.label} · ${entry.groupTitle}`}
                    valueType={entry.field.type}
                    field={entry.value}
                    onSave={(value) => updateField(accountId, entry.field.section, entry.field.key, value)}
                  />
                  {entry.field.hint && <p className="px-4 pb-2 text-xs italic text-[var(--color-ink-400)]">{entry.field.hint}</p>}
                </div>
              ))}
            </CardBody>
          </Card>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <button
          onClick={() => setShowCompleted((v) => !v)}
          className="flex items-center gap-2 text-left text-sm font-semibold text-[var(--color-ink-900)] cursor-pointer"
        >
          <CheckCircle2 size={15} className="text-[var(--color-success-600)]" />
          Completed Information
          <span className="font-normal text-[var(--color-ink-400)]">({stats.completed.length} fields)</span>
          {showCompleted ? <ChevronUp size={15} className="text-[var(--color-ink-400)]" /> : <ChevronDown size={15} className="text-[var(--color-ink-400)]" />}
        </button>
        {showCompleted && (
          <Card>
            <CardBody className="flex flex-col gap-1 pt-2">
              {stats.completed.map((entry) => (
                <FieldRow key={entry.field.key} label={`${entry.field.label} · ${entry.groupTitle}`} valueType={entry.field.type} readOnly field={entry.value} onSave={() => {}} />
              ))}
            </CardBody>
          </Card>
        )}
      </section>

      <div className="flex items-center justify-end gap-3 border-t border-[var(--color-ink-100)] pt-5">
        {!isClean && (
          <p className="text-xs text-[var(--color-ink-500)]">
            {stats.missing.length + stats.conflicting.length} item{stats.missing.length + stats.conflicting.length === 1 ? '' : 's'} may affect accuracy — you can still continue.
          </p>
        )}
        <Button icon={<Sparkles size={15} />} onClick={() => navigate(`/accounts/${accountId}/submission-assistant`)}>
          Generate Application <ArrowRight size={15} />
        </Button>
      </div>
    </PageContainer>
  );
}
