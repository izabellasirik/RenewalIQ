import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, LayoutGrid, Plus, Sparkles, Building2 } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Card, CardBody, EmptyState } from '../components/ui';
import { ActionList } from '../components/workspace/ActionList';
import { ACTION_KIND_META } from '../components/workspace/actionMeta';
import { useAccountsStore } from '../state/useAccountsStore';
import { useBrokerSession } from '../hooks/useBrokerSession';
import { getAccountContacts } from '../services/workflow/contacts';
import { normalizeDateKey, todayKey } from '../services/workflow/dates';
import { deriveAccountActions, sortActions, type ActionItem, type ActionKind } from '../services/workflow/nextActions';

const SECTION_ORDER: { kind: ActionKind; title: string; hint: string }[] = [
  { kind: 'ready_to_send', title: 'Ready to send', hint: 'Received from the client — a carrier is waiting for it.' },
  { kind: 'action_required', title: 'Action required', hint: 'Carrier requests, unsent submissions, and quotes to present.' },
  { kind: 'carrier_follow_up', title: 'Carrier follow-ups', hint: 'Submissions waiting on a carrier or MGA.' },
  { kind: 'follow_up', title: 'Follow-ups', hint: 'Follow-ups you scheduled on an account.' },
  { kind: 'client_follow_up', title: 'Client follow-ups', hint: 'Items requested from the client that are due for a nudge.' },
  { kind: 'renewal', title: 'Renewals coming up', hint: 'Effective within 45 days and not bound yet.' },
];

/**
 * Today's Plate — the broker's daily work, derived entirely from account state (follow-up dates on
 * missing items and market submissions, carrier requests, received items that unblock a carrier,
 * renewal dates). There is no task list to maintain: update the account and the plate updates.
 */
export function TodaysPlatePage() {
  const navigate = useNavigate();
  const accounts = useAccountsStore((s) => s.accounts);
  const riskProfiles = useAccountsStore((s) => s.riskProfiles);
  const missingItems = useAccountsStore((s) => s.missingItems);
  const quotes = useAccountsStore((s) => s.quotes);
  const followUps = useAccountsStore((s) => s.followUps);
  const ensureSampleAccount = useAccountsStore((s) => s.ensureSampleAccount);
  const session = useBrokerSession();
  const [mineOnly, setMineOnly] = useState(false);

  const today = todayKey();

  const { now, upcoming } = useMemo(() => {
    const allNow: ActionItem[] = [];
    const allUpcoming: ActionItem[] = [];
    for (const account of accounts) {
      if (account.archived) continue;
      if (mineOnly && session.status === 'signed_in') {
        const b = account.assignedBroker;
        if (!b || (b.userId !== session.userId && b.email !== session.email)) continue;
      }
      const profile = riskProfiles[account.id];
      const derived = deriveAccountActions(
        {
          account,
          items: missingItems[account.id] ?? [],
          quotes: quotes[account.id] ?? [],
          contacts: getAccountContacts(account),
          effectiveDate: normalizeDateKey((profile?.business?.effectiveDate?.value as string | null | undefined) ?? null),
          followUps: followUps[account.id] ?? [],
        },
        today
      );
      allNow.push(...derived.now);
      allUpcoming.push(...derived.upcoming);
    }
    return { now: sortActions(allNow), upcoming: sortActions(allUpcoming) };
  }, [accounts, riskProfiles, missingItems, quotes, followUps, mineOnly, session.status, session.userId, session.email, today]);

  const overdue = now.filter((a) => a.overdue).length;
  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (accounts.filter((a) => !a.archived).length === 0) {
    return (
      <PageContainer title="Today's Plate" description={dateLabel}>
        <EmptyState
          icon={<Building2 size={28} strokeWidth={1.5} />}
          title="No accounts yet"
          description="Create an account to start tracking missing documents, client and carrier follow-ups, and quotes. Everything you need to do each day will show up here."
          action={
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button icon={<Plus size={16} />} onClick={() => navigate('/accounts/new')}>
                New Submission
              </Button>
              <Button
                variant="secondary"
                icon={<Sparkles size={16} />}
                onClick={() => {
                  const id = ensureSampleAccount();
                  navigate(`/accounts/${id}`);
                }}
              >
                Try Sample Account
              </Button>
            </div>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Today's Plate"
      description={`${dateLabel} · ${now.length === 0 ? 'Nothing due' : `${now.length} to do${overdue ? `, ${overdue} overdue` : ''}`}`}
      actions={
        <Button variant="secondary" icon={<LayoutGrid size={15} />} onClick={() => navigate('/')}>
          All accounts
        </Button>
      }
    >
      {session.status === 'signed_in' && (
        <label className="flex items-center gap-1.5 self-start text-sm text-[var(--color-ink-600)]">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          Only accounts assigned to me
        </label>
      )}

      {now.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 size={26} className="text-[var(--color-success-500)]" />
            <p className="text-sm font-medium text-[var(--color-ink-800)]">You're clear for today.</p>
            <p className="max-w-md text-sm text-[var(--color-ink-500)]">No follow-ups are due and nothing is waiting to be sent. Anything scheduled for later shows under “Coming up”.</p>
          </CardBody>
        </Card>
      ) : (
        SECTION_ORDER.map(({ kind, title, hint }) => {
          const list = now.filter((a) => a.kind === kind);
          if (list.length === 0) return null;
          const Icon = ACTION_KIND_META[kind].icon;
          return (
            <section key={kind} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-700)]">
                  <Icon size={15} />
                  {title}
                  <span className="rounded-full bg-[var(--color-ink-100)] px-1.5 py-0.5 text-xs text-[var(--color-ink-600)]">{list.length}</span>
                </h2>
                <p className="text-xs text-[var(--color-ink-400)]">{hint}</p>
              </div>
              <ActionList actions={list} showAccount />
            </section>
          );
        })
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Coming up · next 7 days</h2>
          <ActionList actions={upcoming} showAccount />
        </section>
      )}
    </PageContainer>
  );
}
