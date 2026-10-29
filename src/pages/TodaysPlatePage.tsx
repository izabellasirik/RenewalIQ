import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Hourglass, LayoutGrid, Plus, RotateCcw, Sparkles, Building2 } from 'lucide-react';
import { PageContainer } from '../components/layout/PageContainer';
import { Button, Card, CardBody, EmptyState, Tabs } from '../components/ui';
import { ActionList } from '../components/workspace/ActionList';
import { ACTION_KIND_META } from '../components/workspace/actionMeta';
import { useAccountsStore } from '../state/useAccountsStore';
import { useBrokerSession } from '../hooks/useBrokerSession';
import { getAccountContacts } from '../services/workflow/contacts';
import { normalizeDateKey, toLocalDateKey, todayKey } from '../services/workflow/dates';
import { deriveAccountActions, deriveDoneActions, sortActions, summarizeWaiting, type ActionItem, type ActionKind } from '../services/workflow/nextActions';
import { ALL_BROKERS, ASSIGNED_TO_ME, UNASSIGNED, matchesBroker } from '../services/workflow/brokerFilter';
import { useRememberedView } from '../hooks/useRememberedView';
import { receivesRenewalReminders } from '../services/workflow/renewals';
import { aBoolean, aString, defined, oneOf } from '../services/preferences/viewPreferences';

/** Today's Plate filters remembered between visits (per user, on this device). */
interface PlateView {
  /** Agency admins: whose accounts. */
  broker: string;
  /** Outside an agency: only accounts assigned to me (as before). */
  mineOnly: boolean;
  /** All tasks, overdue, today's, renewals, what's coming up in the next 7 days, or everything other than renewals. */
  show: PlateShow;
}
type PlateShow = 'all' | 'overdue' | 'due_today' | 'follow_ups' | 'renewal' | 'coming_up' | 'other';
const PLATE_SHOW: PlateShow[] = ['all', 'overdue', 'due_today', 'follow_ups', 'renewal', 'coming_up', 'other'];
/** The "Show" menu, in this order. */
const SHOW_LABELS: Record<PlateShow, string> = {
  all: 'All tasks',
  overdue: 'Overdue',
  due_today: 'Due today',
  follow_ups: 'Follow-ups',
  renewal: 'Renewals',
  coming_up: 'Coming up',
  other: 'Other',
};
/** Earlier versions' choices: one kind of task, the follow-ups and what's waiting are now under "Other". */
const OLD_OTHER = ['action_required', 'ready_to_send', 'waiting', 'carrier_follow_up', 'client_follow_up', 'follow_up'];
/** Every kind of follow-up: scheduled ones, carrier and client follow-ups. */
const FOLLOW_UP_KINDS: ActionKind[] = ['follow_up', 'carrier_follow_up', 'client_follow_up'];
const showsKind = (show: PlateShow, kind: ActionKind) =>
  show === 'renewal' ? kind === 'renewal' : show === 'follow_ups' ? FOLLOW_UP_KINDS.includes(kind) : show === 'other' ? kind !== 'renewal' : true;
/** Each section shows its most urgent tasks first; the rest behind "Show all", so no kind of task crowds out the others. */
const SECTION_SHOWN = 5;
const PLATE_VIEW_DEFAULTS: PlateView = { broker: ALL_BROKERS, mineOnly: false, show: 'all' };
const sanitizePlateView = (saved: Record<string, unknown>): Partial<PlateView> =>
  defined<PlateView>({
    broker: aString(saved.broker),
    mineOnly: aBoolean(saved.mineOnly),
    // Saved by earlier versions: 'renewals', the next 7 days, and the separate kinds of task.
    show: saved.show === 'renewals' ? 'renewal' : saved.show === 'next_7_days' ? 'coming_up' : OLD_OTHER.includes(saved.show as string) ? 'other' : oneOf(PLATE_SHOW)(saved.show),
  });
const filterClass =
  'cursor-pointer rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-sm text-[var(--color-ink-800)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

const SECTION_ORDER: { kind: ActionKind; title: string }[] = [
  { kind: 'ready_to_send', title: 'Ready to send' },
  { kind: 'action_required', title: 'Action required' },
  { kind: 'carrier_follow_up', title: 'Carrier follow-ups' },
  { kind: 'follow_up', title: 'Follow-ups' },
  { kind: 'client_follow_up', title: 'Client follow-ups' },
  { kind: 'renewal', title: 'Renewals coming up' },
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
  const documentRequests = useAccountsStore((s) => s.documentRequests);
  const ensureSampleAccount = useAccountsStore((s) => s.ensureSampleAccount);
  const session = useBrokerSession();
  const [plate, updatePlate, resetPlate] = useRememberedView('todays-plate', PLATE_VIEW_DEFAULTS, sanitizePlateView);
  const [view, setView] = useState<'active' | 'done'>('active');
  // Sections opened past their first few tasks ("Show all").
  const [expanded, setExpanded] = useState<Set<ActionKind>>(() => new Set());
  const undoActionDone = useAccountsStore((s) => s.undoActionDone);
  const reopenFollowUp = useAccountsStore((s) => s.reopenFollowUp);
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const agencyMembers = useAccountsStore((s) => s.agencyMembers);
  const accountOwners = useAccountsStore((s) => s.accountOwners);
  // An agent only ever has their own accounts (RLS), so filtering by broker only means something for an
  // admin (a broker list) or outside an agency (the earlier "only mine" checkbox).
  const byAgent = agencyAccess?.role === 'admin';
  const signedIn = session.status === 'signed_in';
  // A remembered broker who left the agency shows everyone instead.
  const broker =
    byAgent && (plate.broker === ALL_BROKERS || plate.broker === UNASSIGNED || plate.broker === ASSIGNED_TO_ME || agencyMembers.some((m) => m.userId === plate.broker)) ? plate.broker : ALL_BROKERS;
  const mineOnly = !agencyAccess && signedIn && plate.mineOnly;
  const show = plate.show;
  const renewalsOnly = show === 'renewal';
  const filtersActive = broker !== ALL_BROKERS || mineOnly || show !== 'all';

  const today = todayKey();
  // Outdated MVRs / loss runs show up here too, even for accounts not opened today.
  const ensureFreshnessItems = useAccountsStore((s) => s.ensureFreshnessItems);
  const cloudHydratedFor = useAccountsStore((s) => s.cloudHydratedFor);
  useEffect(() => {
    for (const a of useAccountsStore.getState().accounts) ensureFreshnessItems(a.id);
  }, [cloudHydratedFor, today, ensureFreshnessItems]);

  const { now, upcoming, waiting, doneToday } = useMemo(() => {
    const allNow: ActionItem[] = [];
    // Marked Done today — the same records as the account's "Done" list (done actions and completed
    // follow-ups); Undo puts each back on the plate. Earlier days stay in the account's Activity.
    const doneRows: { id: string; accountId: string; accountName: string; title: string; doneAt: string; undo: () => void }[] = [];
    const isToday = (iso: string) => toLocalDateKey(new Date(iso)) === today;
    const allUpcoming: ActionItem[] = [];
    // Blocked on someone else, nothing to do right now — shown apart, just so it isn't forgotten.
    const waitingRows: { accountId: string; accountName: string; onClient: number; onCarriers: string[] }[] = [];
    for (const account of accounts) {
      if (account.archived) continue;
      if (byAgent && !matchesBroker(account, broker, { byAgent, myUserId: session.userId })) continue;
      if (mineOnly) {
        const b = account.assignedBroker;
        if (!b || (b.userId !== session.userId && b.email !== session.email)) continue;
      }
      const profile = riskProfiles[account.id];
      const input = {
        account,
        items: missingItems[account.id] ?? [],
        quotes: quotes[account.id] ?? [],
        contacts: getAccountContacts(account),
        effectiveDate: normalizeDateKey((profile?.business?.effectiveDate?.value as string | null | undefined) ?? null),
        followUps: followUps[account.id] ?? [],
        documentRequests: documentRequests[account.id] ?? [],
      };
      const derived = deriveAccountActions(input, today);
      const base = { accountId: account.id, accountName: account.namedInsured };
      for (const d of deriveDoneActions(input, today)) {
        if (isToday(d.doneAt)) doneRows.push({ ...base, id: `${account.id}:${d.key}`, title: d.action.title, doneAt: d.doneAt, undo: () => undoActionDone(account.id, d.key, d.action.title) });
      }
      for (const f of input.followUps) {
        if (f.doneAt && isToday(f.doneAt)) doneRows.push({ ...base, id: f.id, title: `Follow up: ${f.subject}`, doneAt: f.doneAt, undo: () => reopenFollowUp(account.id, f.id) });
      }
      // Renewal reminders go to the assigned broker; someone only helping on the account doesn't get them.
      // Filtered by a broker, an admin sees that broker's renewals: the ones assigned to them (not ones they only help on).
      const brokersRenewal = !byAgent || broker === ALL_BROKERS || broker === UNASSIGNED || account.assignedUserId === (broker === ASSIGNED_TO_ME ? session.userId : broker);
      const reminded = (a: ActionItem) => a.kind !== 'renewal' || (brokersRenewal && receivesRenewalReminders(account, { role: agencyAccess?.role ?? null, userId: session.userId, ownerId: accountOwners[account.id] ?? null }));
      allNow.push(...derived.now.filter(reminded));
      allUpcoming.push(...derived.upcoming.filter(reminded));
      const w = summarizeWaiting(missingItems[account.id] ?? [], quotes[account.id] ?? []);
      if (w.onClient > 0 || w.onCarriers.length > 0) waitingRows.push({ accountId: account.id, accountName: account.namedInsured, onClient: w.onClient, onCarriers: w.onCarriers });
    }
    waitingRows.sort((a, b) => a.accountName.localeCompare(b.accountName));
    doneRows.sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));
    // "Show": everything; only today's; renewals (today's and the next 7 days'); only the next 7 days; or
    // everything but renewals (today's, the next 7 days' and what's waiting on others).
    // Overdue: only what's past due; Due today: today's without the overdue ones.
    const kept = (a: ActionItem) => showsKind(show, a.kind) && (show === 'overdue' ? a.overdue : show === 'due_today' ? !a.overdue : true);
    return {
      now: show === 'coming_up' ? [] : sortActions(allNow.filter(kept)),
      upcoming: show === 'due_today' || show === 'overdue' ? [] : sortActions(allUpcoming.filter(kept)),
      waiting: show === 'all' || show === 'other' || show === 'follow_ups' ? waitingRows : [],
      doneToday: doneRows,
    };
  }, [accounts, riskProfiles, missingItems, quotes, followUps, documentRequests, mineOnly, byAgent, broker, show, session.userId, session.email, today, undoActionDone, reopenFollowUp, agencyAccess?.role, accountOwners]);

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
      <div className="flex flex-wrap items-center gap-2" data-testid="plate-filters">
        {byAgent && (
          <select value={broker} onChange={(e) => updatePlate({ broker: e.target.value })} className={filterClass} aria-label="Filter by agent">
            <option value={ALL_BROKERS}>All agents</option>
            <option value={ASSIGNED_TO_ME}>Assigned to me</option>
            {agencyMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
                {m.userId === session.userId ? ' (you)' : ''}
              </option>
            ))}
            <option value={UNASSIGNED}>Unassigned</option>
          </select>
        )}
        {signedIn && !agencyAccess && (
          <label className="flex items-center gap-1.5 text-sm text-[var(--color-ink-600)]">
            <input type="checkbox" checked={mineOnly} onChange={(e) => updatePlate({ mineOnly: e.target.checked })} />
            Only accounts assigned to me
          </label>
        )}
        <select value={plate.show} onChange={(e) => updatePlate({ show: e.target.value as PlateView['show'] })} className={filterClass} aria-label="Show">
          {PLATE_SHOW.map((v) => (
            <option key={v} value={v}>
              {SHOW_LABELS[v]}
            </option>
          ))}
        </select>
        {filtersActive && (
          <button onClick={resetPlate} className="text-sm font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
            Clear filters
          </button>
        )}
      </div>

      <Tabs
        items={[
          { key: 'active', label: 'Active', count: now.length || undefined },
          { key: 'done', label: 'Done today', count: doneToday.length || undefined },
        ]}
        active={view}
        onChange={(k) => setView(k as 'active' | 'done')}
      />

      {view === 'done' ? (
        doneToday.length === 0 ? (
          <Card>
            <CardBody className="py-10 text-center text-sm text-[var(--color-ink-500)]">Nothing marked done today yet. Earlier completed tasks are in each account's Activity.</CardBody>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {doneToday.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg border border-[var(--color-ink-100)] bg-white px-3 py-2.5">
                <CheckCircle2 size={16} className="shrink-0 text-[var(--color-success-600)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--color-ink-800)]">{r.title}</p>
                  <p className="truncate text-xs text-[var(--color-ink-500)]">
                    <button onClick={() => navigate(`/accounts/${r.accountId}`)} className="font-medium text-[var(--color-ink-700)] hover:underline cursor-pointer">
                      {r.accountName}
                    </button>
                    {' · Done at '}
                    {new Date(r.doneAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
                <button
                  onClick={r.undo}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-brand-800)]/8 cursor-pointer"
                  aria-label={`Undo: ${r.title}`}
                >
                  <RotateCcw size={12} /> Undo
                </button>
              </li>
            ))}
          </ul>
        )
      ) : now.length === 0 && show !== 'coming_up' ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 size={26} className="text-[var(--color-success-500)]" />
            {filtersActive ? (
              <>
                <p className="text-sm font-medium text-[var(--color-ink-800)]" data-testid="plate-filtered-empty">Nothing to do for these filters today.</p>
                <p className="max-w-md text-sm text-[var(--color-ink-500)]">{renewalsOnly ? 'No renewals are coming up for these accounts.' : 'Other agents or task types may still have work today.'} Clear the filters to see everything.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-[var(--color-ink-800)]">You're clear for today.</p>
                <p className="max-w-md text-sm text-[var(--color-ink-500)]">No follow-ups are due and nothing is waiting to be sent. Anything scheduled for later shows under “Coming up”.</p>
              </>
            )}
          </CardBody>
        </Card>
      ) : (
        SECTION_ORDER.map(({ kind, title }) => {
          const list = now.filter((a) => a.kind === kind);
          if (list.length === 0) return null;
          const Icon = ACTION_KIND_META[kind].icon;
          const all = expanded.has(kind) || list.length <= SECTION_SHOWN + 1;
          return (
            <section key={kind} className="flex flex-col gap-2" data-testid={`plate-section-${kind}`}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-700)]">
                  <Icon size={15} />
                  {title}
                  <span className="rounded-full bg-[var(--color-ink-100)] px-1.5 py-0.5 text-xs text-[var(--color-ink-600)]">{list.length}</span>
                </h2>
              </div>
              <ActionList actions={all ? list : list.slice(0, SECTION_SHOWN)} showAccount />
              {list.length > SECTION_SHOWN + 1 && (
                <button
                  type="button"
                  onClick={() => setExpanded((cur) => { const next = new Set(cur); if (next.has(kind)) next.delete(kind); else next.add(kind); return next; })}
                  className="w-fit cursor-pointer text-sm font-medium text-[var(--color-brand-700)] hover:underline"
                  data-testid={`plate-section-toggle-${kind}`}
                >
                  {all ? 'Show fewer' : `Show all ${list.length}`}
                </button>
              )}
            </section>
          );
        })
      )}

      {view === 'active' && show === 'coming_up' && upcoming.length === 0 && (
        <Card>
          <CardBody className="py-10 text-center text-sm text-[var(--color-ink-500)]" data-testid="plate-filtered-empty">
            Nothing is scheduled for the next 7 days for these accounts.
          </CardBody>
        </Card>
      )}

      {view === 'active' && upcoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">Coming up · next 7 days</h2>
          <ActionList actions={upcoming} showAccount />
        </section>
      )}

      {view === 'active' && waiting.length > 0 && (
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
