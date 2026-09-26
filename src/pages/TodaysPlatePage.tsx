import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Hourglass, LayoutGrid, Plus, Sparkles, Building2 } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Card, CardBody, EmptyState } from '../components/ui';
import { ActionList } from '../components/workspace/ActionList';
import { ACTION_KIND_META } from '../components/workspace/actionMeta';
import { useAccountsStore } from '../state/useAccountsStore';
import { useBrokerSession } from '../hooks/useBrokerSession';
import { getAccountContacts } from '../services/workflow/contacts';
import { normalizeDateKey, todayKey } from '../services/workflow/dates';
import { deriveAccountActions, sortActions, summarizeWaiting, type ActionItem, type ActionKind } from '../services/workflow/nextActions';

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
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  // An agent only ever has their own accounts (RLS), so the toggle only means something outside an agency or for an admin.

  const today = todayKey();

  const { now, upcoming, waiting } = useMemo(() => {
    const allNow: ActionItem[] = [];
    const allUpcoming: ActionItem[] = [];
    // Blocked on someone else, nothing to do right now — shown apart, just so it isn't forgotten.
    const waitingRows: { accountId: string; accountName: string; onClient: number; onCarriers: string[] }[] = [];
    for (const account of accounts) {
      if (account.archived) continue;
      if (mineOnly && session.status === 'signed_in') {
        if (agencyAccess) {
          if (account.assignedUserId !== session.userId) continue;
        } else {
          const b = account.assignedBroker;
          if (!b || (b.userId !== session.userId && b.email !== session.email)) continue;
        }
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
      const w = summarizeWaiting(missingItems[account.id] ?? [], quotes[account.id] ?? []);
      if (w.onClient > 0 || w.onCarriers.length > 0) waitingRows.push({ accountId: account.id, accountName: account.namedInsured, onClient: w.onClient, onCarriers: w.onCarriers });
    }
    waitingRows.sort((a, b) => a.accountName.localeCompare(b.accountName));
    return { now: sortActions(allNow), upcoming: sortActions(allUpcoming), waiting: waitingRows };
  }, [accounts, riskProfiles, missingItems, quotes, followUps, mineOnly, session.status, session.userId, session.email, today, agencyAccess]);

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
      {session.status === 'signed_in' && agencyAccess?.role !== 'agent' && (
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

      {waiting.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">
              <Hourglass size={15} />
              Waiting
              <span className="rounded-full bg-[var(--color-ink-100)] px-1.5 py-0.5 text-xs text-[var(--color-ink-600)]">{waiting.length}</span>
            </h2>
            <p className="text-xs text-[var(--color-ink-400)]">On the client or a carrier — nothing for you to do yet.</p>
          </div>
          <ul className="flex flex-col gap-2">
            {waiting.map((w) => (
              <li key={w.accountId}>
                <button
                  onClick={() => navigate(`/accounts/${w.accountId}?tab=${w.onClient > 0 ? 'checklist' : 'quotes'}`)}
                  className="flex w-full items-center gap-3 rounded-lg border border-[var(--color-ink-100)] bg-white px-3 py-2.5 text-left transition-colors hover:border-[var(--color-brand-500)]/50 hover:bg-[var(--color-ink-50)] cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--color-ink-900)]">{w.accountName}</p>
                    <p className="truncate text-sm text-[var(--color-ink-600)]">
                      {[
                        w.onClient > 0 ? `Waiting on client · ${w.onClient} item${w.onClient === 1 ? '' : 's'}` : null,
                        w.onCarriers.length > 0 ? `Waiting on ${w.onCarriers.length === 1 ? 'carrier' : 'carriers'} · ${w.onCarriers.join(', ')}` : null,
                      ]
                        .filter(Boolean)
                        .join('  ·  ')}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-brand-700)]">
                    Open <ArrowRight size={12} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
