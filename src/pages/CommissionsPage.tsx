import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FileText, Flag, History, ListChecks, Scale } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Badge, Button, ConfirmDialog, Modal } from '../components/ui';
import { useAccountsStore } from '../state/useAccountsStore';
import { monthsOf } from '../services/commissions/calc';
import { ASSUMPTIONS, type AssumptionId } from '../services/commissions/assumptions';
import { SAMPLE_DEFAULT_MONTH } from '../services/commissions/sampleData';
import { MonthSelect, SampleDataBanner, StatusLine } from '../components/commissions/shared';
import { AssumptionContext } from '../components/commissions/commissionsUi';
import { useSampleLedger } from '../components/commissions/useSampleLedger';
import { CalculatorView } from '../components/commissions/CalculatorView';
import { TransactionsTab } from '../components/commissions/TransactionsTab';
import { StatementsTab } from '../components/commissions/StatementsTab';
import { AdjustmentsTab } from '../components/commissions/AdjustmentsTab';
import { AuditTab } from '../components/commissions/AuditTab';
import { AssumptionsTab } from '../components/commissions/AssumptionsTab';

const VIEWS = ['calculator', 'transactions', 'statements', 'adjustments', 'audit', 'assumptions'] as const;
type View = (typeof VIEWS)[number];

/** The secondary screens, reached from the links under the calculator. */
const MORE: { view: Exclude<View, 'calculator'>; title: string; text: string; icon: typeof FileText }[] = [
  { view: 'statements', title: 'Statements', text: 'What each producer is owed this month', icon: FileText },
  { view: 'adjustments', title: 'Adjustments', text: 'Bonuses and corrections, with a reason', icon: Scale },
  { view: 'transactions', title: 'All transactions', text: 'Edit lines and example splits', icon: ListChecks },
  { view: 'audit', title: 'Audit history', text: 'Every change, kept permanently', icon: History },
  { view: 'assumptions', title: 'Assumptions', text: `${ASSUMPTIONS.length} rules waiting for confirmation`, icon: Flag },
];

/**
 * Commissions (Carrier 103) — a preview for agency admins, on FICTIONAL sample data only. Reached
 * through CommissionsRoute, which lets in agency admins only and only when the section is switched
 * on. The calculator is the main screen; statements, adjustments, transactions, audit history and
 * assumptions are one click away. Nothing here reads or writes RenewalIQ data.
 */
export function CommissionsPage() {
  const userId = useAccountsStore((s) => s.currentUserId) ?? 'signed-out';
  const agencyName = useAccountsStore((s) => s.agencyAccess?.agencyName) || 'Your agency';
  const by = useAccountsStore((s) => s.myProfile?.fullName || s.currentUserEmail || 'You');
  const { ledger, apply, reset, status } = useSampleLedger(userId);
  const [params, setParams] = useSearchParams();
  const view: View = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'calculator';
  const months = useMemo(() => monthsOf(ledger), [ledger]);
  const [monthState, setMonth] = useState(SAMPLE_DEFAULT_MONTH);
  const month = months.includes(monthState) ? monthState : (months.at(-1) ?? SAMPLE_DEFAULT_MONTH);
  const [producer, setProducer] = useState('');
  const [openAssumption, setOpenAssumption] = useState<AssumptionId | null>(null);
  const [highlight, setHighlight] = useState<AssumptionId | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const open = useCallback(
    (v: View) =>
      setParams((p) => {
        const n = new URLSearchParams(p);
        if (v === 'calculator') n.delete('view');
        else n.set('view', v);
        return n;
      }),
    [setParams]
  );
  const assumption = ASSUMPTIONS.find((a) => a.id === openAssumption);
  const current = MORE.find((m) => m.view === view);
  const showMonth = view === 'calculator' || view === 'transactions' || view === 'statements' || view === 'adjustments';

  return (
    <AssumptionContext.Provider value={setOpenAssumption}>
      <PageContainer
        title="Commissions"
        description={
          <span className="flex flex-wrap items-center gap-2">
            Producer earnings and agency retained <Badge tone="warning">Sample data</Badge>
            <Badge tone="neutral">Admins only</Badge>
          </span>
        }
        actions={showMonth ? <MonthSelect months={months} value={month} onChange={setMonth} /> : undefined}
      >
        <SampleDataBanner onReset={() => setConfirmReset(true)} />
        <StatusLine message={status?.message ?? null} tone={status?.tone ?? 'success'} />

        {current && (
          <div className="flex flex-wrap items-center gap-3" data-testid="secondary-header">
            <Button variant="secondary" size="sm" icon={<ArrowLeft size={14} />} onClick={() => open('calculator')}>Calculator</Button>
            <h2 className="text-lg font-semibold text-[var(--color-ink-900)]">{current.title}</h2>
          </div>
        )}

        {view === 'calculator' && (
          <>
            <CalculatorView ledger={ledger} month={month} by={by} apply={apply} onOpen={open} />
            <nav aria-label="More commission tools" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="more">
              {MORE.map((m) => (
                <button
                  key={m.view}
                  type="button"
                  onClick={() => open(m.view)}
                  className="group flex items-center gap-3 rounded-xl border border-[var(--color-ink-100)] bg-white px-4 py-3 text-left [box-shadow:var(--shadow-card)] transition-colors hover:border-[var(--color-ink-200)] hover:bg-[var(--color-ink-50)] cursor-pointer"
                >
                  <m.icon size={18} className="shrink-0 text-[var(--color-ink-400)]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[var(--color-ink-900)]">{m.title}</span>
                    <span className="block text-xs text-[var(--color-ink-500)]">{m.text}</span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-[var(--color-ink-300)] group-hover:text-[var(--color-ink-500)]" aria-hidden />
                </button>
              ))}
            </nav>
          </>
        )}
        {view === 'transactions' && <TransactionsTab ledger={ledger} month={month} by={by} apply={apply} />}
        {view === 'statements' && <StatementsTab ledger={ledger} month={month} producerId={producer} onProducer={setProducer} agencyName={agencyName} />}
        {view === 'adjustments' && <AdjustmentsTab key={month} ledger={ledger} month={month} months={months} by={by} apply={apply} />}
        {view === 'audit' && <AuditTab ledger={ledger} />}
        {view === 'assumptions' && <AssumptionsTab highlight={highlight} />}
      </PageContainer>

      <Modal
        open={!!assumption}
        onClose={() => setOpenAssumption(null)}
        title={assumption ? `${assumption.id} · ${assumption.topic}` : ''}
        subtitle="Assumption — not confirmed by your agency yet"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenAssumption(null)}>Close</Button>
            <Button
              onClick={() => {
                setHighlight(openAssumption);
                setOpenAssumption(null);
                open('assumptions');
              }}
            >
              See all assumptions
            </Button>
          </>
        }
      >
        {assumption && (
          <div className="flex flex-col gap-2 text-sm text-[var(--color-ink-700)]" data-testid="assumption-detail">
            <p className="font-medium text-[var(--color-ink-900)]">{assumption.question}</p>
            <p><span className="font-medium">The preview assumes: </span>{assumption.current}</p>
            <p className="text-[var(--color-ink-500)]">Why it matters: {assumption.why}</p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmReset}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          reset();
        }}
        title="Reset the sample data?"
        description="Your changes to the fictional sample, and their audit entries, are cleared from this browser. Nothing in RenewalIQ is affected."
        confirmLabel="Reset sample data"
      />
    </AssumptionContext.Provider>
  );
}
