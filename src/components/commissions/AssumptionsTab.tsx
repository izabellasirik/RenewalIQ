import { useEffect } from 'react';
import { CheckCircle2, Flag } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader } from '../ui';
import { cn } from '../../utils/cn';
import { ASSUMPTIONS, CONFIRMED_RULES, type AssumptionId } from '../../services/commissions/assumptions';

/** What the agency has confirmed, and the rules the preview only assumes — with what each one does today. */
export function AssumptionsTab({ highlight }: { highlight: AssumptionId | null }) {
  useEffect(() => {
    if (highlight) document.getElementById(`assumption-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-ink-900)]">
            <CheckCircle2 size={17} className="text-[var(--color-success-500)]" aria-hidden /> Confirmed by the agency
          </h2>
        </CardHeader>
        <CardBody className="pt-3">
          <ul className="flex flex-col gap-2 text-sm text-[var(--color-ink-700)]" data-testid="confirmed-rules">
            {CONFIRMED_RULES.map((r) => (
              <li key={r} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--color-success-500)]" aria-hidden />{r}</li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-ink-900)]">
          <Flag size={16} className="text-[var(--color-warning-500)]" aria-hidden /> Assumptions — not approved business rules
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-500)]">
          The preview needs an answer to each of these. Until the agency confirms them, any figure marked with the same number is an illustration only.
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2" data-testid="assumptions">
        {ASSUMPTIONS.map((a) => (
          <li
            key={a.id}
            id={`assumption-${a.id}`}
            className={cn('rounded-xl border bg-white p-4 [box-shadow:var(--shadow-card)] transition-colors', highlight === a.id ? 'border-[var(--color-warning-500)] ring-2 ring-[var(--color-warning-500)]/30' : 'border-[var(--color-ink-100)]')}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-[var(--color-ink-900)]">
                <span className="mr-1.5 text-[var(--color-warning-600)]">{a.id}</span>
                {a.topic}
              </p>
              <Badge tone="warning" className="shrink-0">Needs confirmation</Badge>
            </div>
            <p className="mt-1 text-sm font-medium text-[var(--color-ink-700)]">{a.question}</p>
            <p className="mt-2 text-sm text-[var(--color-ink-600)]"><span className="font-medium text-[var(--color-ink-700)]">The preview assumes: </span>{a.current}</p>
            <p className="mt-1.5 text-xs text-[var(--color-ink-500)]">Why it matters: {a.why}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
