import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Copy, FileText, Loader2, Mail, Paperclip, ShieldAlert, Upload, XCircle } from 'lucide-react';
import { Badge, Button, Drawer, type BadgeTone } from '../ui';
import { inputClass, labelClass, smallInputClass } from '../workspace/formStyles';
import { useAccountsStore } from '../../state/useAccountsStore';
import { getAccountContacts } from '../../services/workflow/contacts';
import { formatShortDate, normalizeDateKey, todayKey } from '../../services/workflow/dates';
import { gmailComposeUrl, type EmailDraft } from '../../services/workflow/emailDraft';
import { getFieldValueByPath } from '../../utils/riskProfilePath';
import { isSupabaseConfigured } from '../../services/supabase/client';
import { requestLink } from '../../services/supabase/documentRequestsRepo';
import { fetchEmailSeen, recordEmailReviewActions, saveEmailReview, setEmailReviewStatus, type EmailReviewActionInput } from '../../services/supabase/emailReviewsRepo';
import { precheckUpload } from '../../services/uploads/uploadCheck';
import { fileSha256 } from '../../services/ingestion/aiReadContext';
import { EmailTooLargeError } from '../../services/emailAssistant/parseEmail';
import { fileSource, pasteSource, SOURCE_LABELS, type EmailSource } from '../../services/emailAssistant/sources';
import { buildMatchInputs, type MatchStatus } from '../../services/emailAssistant/matchAccount';
import { analyzeEmail, reviewForAccount, type AccountReview, type EmailReview } from '../../services/emailAssistant/reviewEmail';
import { applyPlan, type ApplyOutcome } from '../../services/emailAssistant/applyPlan';
import { attachmentFile, type AttachmentReview, type AttachmentStatus, type EarlierAttachment } from '../../services/emailAssistant/attachments';
import { attachmentText } from '../../services/emailAssistant/attachmentText';
import { invokeEmailAi } from '../../services/emailAssistant/aiExtractor';
import { CATEGORY_LABELS, type EmailCategory } from '../../services/emailAssistant/classify';
import { EMAIL_ASSISTANT_AI_ENABLED } from '../../services/emailAssistant/flag';
import type { Suggestion } from '../../services/emailAssistant/suggestActions';
import { INTENT_LABELS, type DocumentStance } from '../../services/emailAssistant/types';
import type { ChecklistOutcome } from '../../services/emailAssistant/checklistCheck';
import { cn } from '../../utils/cn';

const MATCH_LABEL: Record<MatchStatus, { label: string; tone: BadgeTone }> = {
  matched: { label: 'Matched', tone: 'success' },
  possible: { label: 'Possible match — confirm', tone: 'warning' },
  ambiguous: { label: 'Ambiguous — choose', tone: 'danger' },
  none: { label: 'No match', tone: 'neutral' },
};
const STANCE_LABEL: Record<DocumentStance, { label: string; tone: BadgeTone }> = {
  requested: { label: 'Asked for', tone: 'info' },
  provided: { label: 'Says it’s sent', tone: 'brand' },
  already_have: { label: 'Not needed / on file', tone: 'neutral' },
  mentioned: { label: 'Mentioned', tone: 'neutral' },
};
const OUTCOME_TONE: Record<ChecklistOutcome, BadgeTone> = { new: 'warning', on_checklist: 'info', already_requested: 'info', received_unverified: 'warning', received: 'success', waived: 'neutral' };
const CATEGORY_TONE: Record<EmailCategory, BadgeTone> = { carrier_request: 'info', client_response: 'brand', document_delivery: 'success', unrelated: 'neutral' };
const ATTACHMENT_LABEL: Record<AttachmentStatus, { label: string; tone: BadgeTone }> = {
  new: { label: 'New', tone: 'success' },
  on_account: { label: 'Already on the account', tone: 'neutral' },
  possible_duplicate: { label: 'Possible duplicate', tone: 'warning' },
  seen_before: { label: 'Came with an earlier email', tone: 'warning' },
  repeated_in_email: { label: 'Attached twice', tone: 'neutral' },
  blocked: { label: 'Blocked', tone: 'danger' },
  not_supported: { label: 'Can’t be imported', tone: 'danger' },
  unreadable: { label: 'Can’t be read', tone: 'neutral' },
};

const newKey = () => crypto.randomUUID();

/** Edits the agent makes to a suggestion before approving it. */
interface SuggestionEdit {
  draft?: EmailDraft;
  date?: string;
}

function withEdits(s: Suggestion, e: SuggestionEdit | undefined, attachmentChoice: Set<number> | null): Suggestion {
  if (s.kind === 'import_attachments' && attachmentChoice) return { ...s, selected: [...attachmentChoice] };
  if (!e) return s;
  if (s.kind === 'request_from_client') return { ...s, draft: e.draft ?? s.draft, followUpDate: e.date || s.followUpDate };
  if (s.kind === 'follow_up_request') return { ...s, draft: e.draft ?? s.draft, nextFollowUp: e.date || s.nextFollowUp };
  if (s.kind === 'schedule_follow_up') return { ...s, dueDate: e.date || s.dueDate };
  if (s.kind === 'reply_to_sender') return { ...s, draft: e.draft ?? s.draft };
  return s;
}

const draftOf = (s: Suggestion): EmailDraft | undefined => (s.kind === 'request_from_client' || s.kind === 'follow_up_request' || s.kind === 'reply_to_sender' ? s.draft : undefined);
const toOf = (s: Suggestion): string | undefined => ('to' in s ? s.to : undefined);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Section({ n, title, children, testId, aside }: { n: number; title: string; children: ReactNode; testId: string; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">
          <span className="mr-1.5 text-[var(--color-ink-400)]">{n}.</span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The Email Assistant, opened from a client's account. The agent pastes an email or uploads the
 * .eml; Renewal IQ reads it (fixed rules first, AI only if switched on and the rules are unsure),
 * checks which client and market it's about, fingerprints the attachments, and suggests next
 * steps. Nothing on the account changes — no checklist item, request, follow-up, note or imported
 * document — until the agent approves it, and nothing is ever sent: drafts are copied or opened in
 * the agent's own Gmail.
 */
export default function EmailAssistantDrawer({ open, onClose, accountId: startAccountId }: { open: boolean; onClose: () => void; accountId: string }) {
  const navigate = useNavigate();
  const accounts = useAccountsStore((s) => s.accounts);
  const riskProfiles = useAccountsStore((s) => s.riskProfiles);
  const quotes = useAccountsStore((s) => s.quotes);
  const missingItems = useAccountsStore((s) => s.missingItems);
  const documents = useAccountsStore((s) => s.documents);
  const documentRequests = useAccountsStore((s) => s.documentRequests);
  const agencyAccess = useAccountsStore((s) => s.agencyAccess);
  const myProfile = useAccountsStore((s) => s.myProfile);
  const currentUserId = useAccountsStore((s) => s.currentUserId);
  const cloudAccountIds = useAccountsStore((s) => s.cloudAccountIds);
  const loadDocumentRequests = useAccountsStore((s) => s.loadDocumentRequests);
  const recordEmailReviewed = useAccountsStore((s) => s.recordEmailReviewed);
  const recordEmailDraftOpened = useAccountsStore((s) => s.recordEmailDraftOpened);
  const agencyId = agencyAccess?.agencyId ?? null;

  const [raw, setRaw] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<EmailReview | null>(null);
  const [accountId, setAccountId] = useState(startAccountId);
  const [quoteChoice, setQuoteChoice] = useState<string | null | undefined>(undefined);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [attachmentChoice, setAttachmentChoice] = useState<Set<number> | null>(null);
  const [edits, setEdits] = useState<Record<string, SuggestionEdit>>({});
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [accountConfirmed, setAccountConfirmed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [seen, setSeen] = useState<{ key: string; reviewedAt?: string; attachments: EarlierAttachment[] } | null>(null);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ suggestions: Suggestion[]; outcomes: ApplyOutcome[]; accountId: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // One link token per review + account, so the draft's link is the one the request is created with.
  const tokens = useRef<Record<string, string>>({});
  // The stored review (0061), saved once — on the first approval, copy or dismissal.
  const savedReview = useRef<{ key: string; id: Promise<string | null> } | null>(null);

  useEffect(() => setAccountId(startAccountId), [startAccountId]);

  const inputs = useMemo(() => buildMatchInputs({ accounts, riskProfiles, quotes }, { agencyId }), [accounts, riskProfiles, quotes, agencyId]);
  const account = accounts.find((a) => a.id === accountId);
  const isCloud = isSupabaseConfigured && !!currentUserId && !!cloudAccountIds[accountId];

  // Fresh client requests for the chosen account, so "already requested" is up to date (read only).
  useEffect(() => {
    if (accountId && isCloud) void loadDocumentRequests([accountId]);
  }, [accountId, isCloud, loadDocumentRequests]);

  // Seen before on this account (any agent's stored review): the same email, the same files.
  const seenKey = review ? `${review.fingerprint}:${accountId}` : '';
  useEffect(() => {
    if (!review || !isCloud) return;
    let live = true;
    const hashes = review.attachmentFacts.map((f) => f.sha256).filter((h): h is string => !!h);
    void fetchEmailSeen(accountId, review.fingerprint, hashes).then((res) => {
      if (!live) return;
      if (res.ok) setSeen({ key: seenKey, ...res.data });
      else if (res.missingMigration) setStoreNote(res.message);
    });
    return () => {
      live = false;
    };
  }, [review, accountId, isCloud, seenKey]);

  const accountReview: AccountReview | null = useMemo(() => {
    if (!review || !account) return null;
    const profile = riskProfiles[account.id];
    const read = (path: string) => (profile ? ((getFieldValueByPath(profile, path)?.value as string | null | undefined) ?? null) : null);
    const key = `${review.fingerprint}:${account.id}`;
    const seenHere = seen?.key === key ? seen : null;
    return reviewForAccount(
      review,
      {
        account,
        items: missingItems[account.id] ?? [],
        quotes: quotes[account.id] ?? [],
        contacts: getAccountContacts(account),
        requests: documentRequests[account.id] ?? [],
        effectiveDate: normalizeDateKey((profile?.business?.effectiveDate?.value as string | null | undefined) ?? null),
        documents: documents[account.id] ?? [],
        dotNumber: read('transportation.dotNumber'),
        earlierAttachments: seenHere?.attachments,
        reviewedBefore: seenHere?.reviewedAt,
      },
      {
        today: todayKey(),
        agentName: myProfile?.fullName || undefined,
        linkFor: isSupabaseConfigured && !!currentUserId && !!cloudAccountIds[account.id] ? requestLink : undefined,
        newToken: () => (tokens.current[key] ??= crypto.randomUUID()),
        quoteId: quoteChoice,
      }
    );
  }, [review, account, riskProfiles, missingItems, quotes, documents, documentRequests, currentUserId, cloudAccountIds, myProfile, quoteChoice, seen]);

  // Pre-tick the plan's defaults whenever the plan for an account is (re)built.
  const planKey = accountReview ? `${review?.fingerprint}:${accountId}:${quoteChoice ?? ''}:${seen?.key ?? ''}:${seen?.reviewedAt ?? ''}` : '';
  useEffect(() => {
    if (!accountReview || applied) return;
    setSelected(Object.fromEntries(accountReview.plan.suggestions.map((s) => [s.id, s.defaultSelected])));
    const imp = accountReview.plan.suggestions.find((s) => s.kind === 'import_attachments');
    setAttachmentChoice(new Set(imp?.kind === 'import_attachments' ? imp.selected : []));
    setEdits({});
    setAccountConfirmed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  const reset = () => {
    setRaw('');
    setFile(null);
    setReview(null);
    setAccountId(startAccountId);
    setQuoteChoice(undefined);
    setSelected({});
    setAttachmentChoice(null);
    setEdits({});
    setOpenDraft(null);
    setVerified(false);
    setAccountConfirmed(false);
    setSeen(null);
    setStoreNote(null);
    setApplied(null);
    setError(null);
    savedReview.current = null;
    if (fileInput.current) fileInput.current.value = '';
  };

  const analyze = async () => {
    setError(null);
    setBusy(true);
    const source: EmailSource = file ? fileSource(file) : pasteSource(raw);
    try {
      const loaded = await source.load();
      const r = await analyzeEmail(loaded, inputs, {
        agencyId,
        today: todayKey(),
        accountId: startAccountId,
        ai: EMAIL_ASSISTANT_AI_ENABLED && isSupabaseConfigured && currentUserId ? invokeEmailAi : null,
        readText: attachmentText,
      });
      setReview(r);
      setAccountId(startAccountId);
      setQuoteChoice(undefined);
      setVerified(false);
      setApplied(null);
    } catch (e) {
      setError(e instanceof EmailTooLargeError ? e.message : 'This email couldn’t be read. Paste the message text instead.');
    } finally {
      setBusy(false);
    }
  };

  /** The stored review's id (saved on first use; null when the account isn't in the cloud or 0061 is missing). */
  const ensureSaved = (): Promise<string | null> => {
    if (!review || !accountReview || !isCloud) return Promise.resolve(null);
    const key = `${review.fingerprint}:${accountId}`;
    if (savedReview.current?.key === key) return savedReview.current.id;
    const id = saveEmailReview(accountId, review, accountReview).then((res) => {
      if (res.ok) return res.data;
      setStoreNote(res.message);
      return null;
    });
    savedReview.current = { key, id };
    return id;
  };
  const audit = (actions: EmailReviewActionInput[]) => {
    void ensureSaved().then((id) => (id ? recordEmailReviewActions(id, actions) : undefined));
  };

  const suggestions = accountReview?.plan.suggestions ?? [];
  const requiresVerification = !!accountReview?.plan.requiresVerification;
  const needsAccountConfirmation = (accountReview?.accountWarnings.length ?? 0) > 0;
  const locked = (s: Suggestion) => ('blocked' in s && !!s.blocked) || (s.changesAccount && ((requiresVerification && !verified) || (needsAccountConfirmation && !accountConfirmed)));
  const current = (s: Suggestion) => withEdits(s, edits[s.id], attachmentChoice);
  const chosen = suggestions.filter((s) => selected[s.id] && !locked(s) && s.changesAccount).map(current).filter((s) => s.kind !== 'import_attachments' || s.selected.length > 0);
  const drafts = suggestions.filter((s) => draftOf(s)).map(current);

  const approve = async () => {
    if (!account || !accountReview || !review) return;
    setBusy(true);
    const outcomes = await applyPlan(() => useAccountsStore.getState(), account.id, chosen, {
      agencyId,
      verifiedOutsideEmail: verified,
      requiresVerification,
      clientKey: newKey,
      emailSubject: review.email.subject,
      imports: {
        fileFor: (i) => (review.email.attachments[i] ? attachmentFile(review.email.attachments[i]) : null),
        precheck: async (f) => {
          const c = await precheckUpload(f);
          return c.ok ? { ok: true } : { ok: false, reason: c.reason };
        },
        hash: fileSha256,
      },
    });
    const done = outcomes.filter((o) => o.ok).length;
    recordEmailReviewed(account.id, `Email reviewed with the Email Assistant: “${review.email.subject || '(no subject)'}” — ${done} approved change${done === 1 ? '' : 's'} made${outcomes.length > done ? `, ${outcomes.length - done} not made` : ''}.`);
    const actions: EmailReviewActionInput[] = [
      ...chosen.map((s) => ({ action: 'approved' as const, suggestionKind: s.kind, detail: s.title })),
      ...outcomes.map((o) => ({
        action: (o.importedDocumentIds?.length ? 'imported' : o.ok ? 'applied' : 'failed') as EmailReviewActionInput['action'],
        suggestionKind: chosen.find((s) => s.id === o.suggestionId)?.kind,
        detail: o.message,
        documentIds: o.importedDocumentIds,
      })),
    ];
    void ensureSaved().then(async (id) => {
      if (!id) return;
      await recordEmailReviewActions(id, actions);
      await setEmailReviewStatus(id, 'applied');
    });
    // Information-only suggestions (verify, record the quote) stay on screen as reminders.
    setApplied({ suggestions: [...chosen, ...suggestions.filter((x) => !x.changesAccount)], outcomes, accountId: account.id });
    setBusy(false);
  };

  const dismiss = () => {
    if (review && accountReview && isCloud) {
      void ensureSaved().then(async (id) => {
        if (!id) return;
        await recordEmailReviewActions(id, [{ action: 'dismissed', detail: 'Reviewed; nothing approved.' }]);
        await setEmailReviewStatus(id, 'dismissed');
      });
    }
    reset();
  };

  const copyDraft = async (s: Suggestion) => {
    const draft = draftOf(s);
    if (!draft) return;
    const ok = await copyText(`Subject: ${draft.subject}\n\n${draft.body}`);
    setCopied(ok ? s.id : `${s.id}:failed`);
    if (ok) audit([{ action: 'draft_copied', suggestionKind: s.kind, detail: `Draft copied: “${draft.subject}”` }]);
  };
  const openedInGmail = (s: Suggestion) => {
    const draft = draftOf(s);
    const to = toOf(s);
    if (!draft || !to || !account) return;
    recordEmailDraftOpened(account.id, to, draft.subject);
    audit([{ action: 'draft_opened', suggestionKind: s.kind, detail: `Draft opened in Gmail for ${to}` }]);
  };

  const setEdit = (id: string, patch: SuggestionEdit) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const importSuggestion = suggestions.find((s) => s.kind === 'import_attachments');

  return (
    <Drawer open={open} onClose={onClose} title="Email Assistant" subtitle={account ? `For ${account.namedInsured}` : undefined}>
      <div className="flex flex-col gap-6" data-testid="email-assistant">
        <div className="rounded-lg border border-[var(--color-info-100)] bg-[var(--color-info-100)]/40 px-3 py-2 text-xs text-[var(--color-info-600)]">
          Nothing is sent and nothing on the account changes until you approve. Links in the email are never opened, attachments are only imported if you tick them, and no document is marked received from an email.
        </div>

        {!review && (
          <section className="flex flex-col gap-3">
            <div>
              <label htmlFor="email-raw" className={labelClass}>
                Paste the email (include the From and Subject lines if you can)
              </label>
              <textarea
                id="email-raw"
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = '';
                }}
                rows={10}
                className={cn(inputClass, 'font-mono text-xs')}
                placeholder={'From: Morgan Hale <mhale@carrier.example>\nSubject: Items needed to quote\n\nHi, before we can quote we need…'}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                id="email-file"
                type="file"
                accept=".eml,message/rfc822,.txt,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f) setRaw('');
                  setError(null);
                }}
              />
              <Button variant="secondary" size="sm" icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>
                Upload a .eml file
              </Button>
              {file && (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-600)]" data-testid="email-file-name">
                  <FileText size={13} /> {file.name}
                </span>
              )}
            </div>
            {error && <p className="text-sm text-[var(--color-danger-600)]">{error}</p>}
            <div>
              <Button onClick={() => void analyze()} disabled={(!raw.trim() && !file) || busy} icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}>
                Review email
              </Button>
            </div>
          </section>
        )}

        {review && (
          <>
            <EmailSummary review={review} accountReview={accountReview} onStartOver={reset} />
            <SafetyPanel review={review} />

            <Section n={2} title="Client / submission match" testId="email-account">
              {!applied ? (
                <AccountPicker review={review} accountId={accountId} startAccountId={startAccountId} onChoose={(id) => {
                  setAccountId(id);
                  setQuoteChoice(undefined);
                }} allAccounts={inputs.map((i) => ({ id: i.account.id, name: i.account.namedInsured }))} />
              ) : (
                <p className="text-sm text-[var(--color-ink-700)]">{account?.namedInsured}</p>
              )}
              {account && accountReview && !applied && (quotes[account.id] ?? []).length > 0 && accountReview.senderRole !== 'client' && (
                <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-600)]">
                  Market (submission)
                  <select aria-label="From market" className={smallInputClass} value={quoteChoice === null ? '' : (quoteChoice ?? accountReview.quoteId ?? '')} onChange={(e) => setQuoteChoice(e.target.value || null)}>
                    <option value="">Not from a market</option>
                    {(quotes[account.id] ?? []).map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.marketName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {accountReview && accountReview.accountWarnings.length > 0 && !applied && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--color-danger-100)] bg-[var(--color-danger-100)]/30 px-3 py-2" data-testid="email-account-warning" role="alert">
                  {accountReview.accountWarnings.map((w) => (
                    <p key={w} className="flex items-start gap-1.5 text-xs text-[var(--color-danger-600)]">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
                    </p>
                  ))}
                  <label className="flex items-start gap-2 text-sm text-[var(--color-danger-600)]">
                    <input type="checkbox" className="mt-1" checked={accountConfirmed} onChange={(e) => setAccountConfirmed(e.target.checked)} />
                    <span>I checked: this email is about {account?.namedInsured}. Account changes stay locked until this is ticked.</span>
                  </label>
                </div>
              )}
            </Section>

            {accountReview && account && (
              <>
                <Section n={3} title="Documents received" testId="email-documents">
                  <DocumentsReceived
                    review={review}
                    accountReview={accountReview}
                    choice={attachmentChoice}
                    disabled={!!applied || (importSuggestion ? locked(importSuggestion) : true)}
                    onToggle={(index, on) =>
                      setAttachmentChoice((prev) => {
                        const next = new Set(prev ?? []);
                        if (on) next.add(index);
                        else next.delete(index);
                        return next;
                      })
                    }
                  />
                </Section>

                <Section n={4} title="Missing items" testId="email-missing">
                  <MissingItems review={review} accountReview={accountReview} />
                </Section>

                {!applied && (
                  <Section n={5} title="Suggested actions" testId="email-suggestions">
                    {accountReview.plan.notes.map((n) => (
                      <p key={n} className="rounded-md bg-[var(--color-ink-50)] px-3 py-2 text-xs text-[var(--color-ink-600)]">
                        {n}
                      </p>
                    ))}
                    {storeNote && <p className="rounded-md bg-[var(--color-warning-100)]/50 px-3 py-2 text-xs text-[var(--color-warning-600)]">{storeNote}</p>}
                    {requiresVerification && (
                      <label className="flex items-start gap-2 rounded-lg border border-[var(--color-danger-100)] bg-[var(--color-danger-100)]/30 px-3 py-2 text-sm text-[var(--color-danger-600)]">
                        <input type="checkbox" className="mt-1" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
                        <span>I confirmed this email is genuine outside email (for example, by calling a number I already have). Account changes stay locked until this is ticked.</span>
                      </label>
                    )}
                    <ul className="flex flex-col gap-2">
                      {suggestions
                        .filter((s) => s.kind !== 'reply_to_sender')
                        .map((s) => (
                          <SuggestionRow key={s.id} s={current(s)} checked={!!selected[s.id] && !locked(s)} locked={locked(s)} onToggle={(v) => setSelected((x) => ({ ...x, [s.id]: v }))} onEdit={(patch) => setEdit(s.id, patch)} />
                        ))}
                    </ul>
                  </Section>
                )}

                <Section n={applied ? 5 : 6} title="Draft reply" testId="email-drafts">
                  {drafts.length === 0 ? (
                    <p className="text-sm text-[var(--color-ink-500)]">No reply is needed for this email.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {drafts.map((s) => (
                        <DraftCard
                          key={s.id}
                          s={s}
                          open={openDraft === s.id}
                          onToggle={() => setOpenDraft((d) => (d === s.id ? null : s.id))}
                          onEdit={(draft) => setEdit(s.id, { draft })}
                          onCopy={() => void copyDraft(s)}
                          copied={copied === s.id ? 'ok' : copied === `${s.id}:failed` ? 'failed' : null}
                          onOpenGmail={() => openedInGmail(s)}
                          readOnly={!!applied}
                          linkPending={!applied && s.kind === 'request_from_client' && !!accountReview && isCloud}
                        />
                      ))}
                    </ul>
                  )}
                </Section>

                {!applied && (
                  <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center gap-2 border-t border-[var(--color-ink-100)] bg-white px-6 py-3">
                    <Button onClick={() => void approve()} disabled={busy || chosen.length === 0} icon={busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}>
                      Approve {chosen.length} selected
                    </Button>
                    <Button variant="secondary" onClick={dismiss} disabled={busy}>
                      Dismiss
                    </Button>
                    <span className="text-xs text-[var(--color-ink-500)]">{chosen.length === 0 ? 'Nothing selected — the account stays as it is' : `${chosen.length} change${chosen.length === 1 ? '' : 's'} to the account`}</span>
                  </div>
                )}
              </>
            )}

            {applied && (
              <AppliedPanel
                applied={applied}
                onOpenAccount={() => {
                  onClose();
                  navigate(`/accounts/${applied.accountId}?tab=checklist`);
                }}
                onAnother={reset}
              />
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

function EmailSummary({ review, accountReview, onStartOver }: { review: EmailReview; accountReview: AccountReview | null; onStartOver: () => void }) {
  const { email, read } = review;
  const c = accountReview?.classification;
  return (
    <Section n={1} title="Email summary" testId="email-summary" aside={<button onClick={onStartOver} className="text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">Start over</button>}>
      <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--color-ink-100)] bg-[var(--color-ink-50)] px-3 py-2.5">
        <p className="min-w-0 text-sm font-semibold text-[var(--color-ink-900)] break-words">{email.subject || '(no subject)'}</p>
        <p className="text-xs text-[var(--color-ink-600)] break-words">
          From {email.from.name ? `${email.from.name} ` : ''}
          {email.from.address ? `<${email.from.address}>` : '(unknown sender)'}
          {email.date ? ` · ${formatShortDate(email.date.slice(0, 10))}` : ''} · {SOURCE_LABELS[review.source.kind]}
          {email.attachments.length ? ` · ${email.attachments.length} attachment${email.attachments.length === 1 ? '' : 's'}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {c && (
            <Badge tone={CATEGORY_TONE[c.category]} data-testid="email-category">
              {CATEGORY_LABELS[c.category]}
            </Badge>
          )}
          {c && (
            <span className="text-xs text-[var(--color-ink-500)]" data-testid="email-confidence">
              {c.level === 'high' ? 'High' : c.level === 'medium' ? 'Medium' : 'Low'} confidence ({Math.round(c.confidence * 100)}%)
            </span>
          )}
          <Badge tone="neutral">{INTENT_LABELS[review.extraction.intent]}</Badge>
          <span className="text-xs text-[var(--color-ink-400)]" data-testid="email-read-method">
            {read.method === 'hybrid' ? `Read by rules, then AI${read.ai?.model ? ` (${read.ai.model})` : ''}` : 'Read by fixed rules'}
          </span>
        </div>
        {c && c.reasons.length > 0 && <p className="text-xs text-[var(--color-ink-600)]">{c.reasons.join(' ')}</p>}
        {c && c.uncertain.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs text-[var(--color-warning-600)]" data-testid="email-uncertain">
            {c.uncertain.map((u) => (
              <li key={u}>? {u}</li>
            ))}
          </ul>
        )}
        {read.aiSkipped && read.rulesDoubts.length > 0 && <p className="text-xs text-[var(--color-ink-400)]">{read.aiSkipped}</p>}
        {read.ai && read.ai.dropped > 0 && <p className="text-xs text-[var(--color-ink-400)]">{read.ai.dropped} AI finding{read.ai.dropped === 1 ? ' was' : 's were'} left out because {read.ai.dropped === 1 ? 'its' : 'their'} wording isn’t in the email.</p>}
      </div>
    </Section>
  );
}

function SafetyPanel({ review }: { review: EmailReview }) {
  const extra = review.read.ai?.instructionsToSoftware ? ['The AI also noticed instructions aimed at software in this email. They were ignored.'] : [];
  if (review.safety.length === 0 && !extra.length) return null;
  const high = review.safety.filter((s) => s.level === 'high');
  return (
    <section
      className={cn('flex flex-col gap-1.5 rounded-lg border px-3 py-2.5', high.length ? 'border-[var(--color-danger-100)] bg-[var(--color-danger-100)]/40' : 'border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/50')}
      data-testid="email-safety"
      role="alert"
    >
      <p className={cn('flex items-center gap-1.5 text-sm font-semibold', high.length ? 'text-[var(--color-danger-600)]' : 'text-[var(--color-warning-600)]')}>
        <ShieldAlert size={15} /> {high.length ? 'This email may not be genuine' : 'Things to check'}
      </p>
      <ul className="flex flex-col gap-1 pl-5 text-xs text-[var(--color-ink-700)] list-disc">
        {review.safety.map((s) => (
          <li key={s.code}>{s.message}</li>
        ))}
        {extra.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </section>
  );
}

function AccountPicker({ review, accountId, startAccountId, onChoose, allAccounts }: { review: EmailReview; accountId: string; startAccountId: string; onChoose: (id: string) => void; allAccounts: { id: string; name: string }[] }) {
  const { match } = review;
  const meta = MATCH_LABEL[match.status];
  // The matches, plus the account the assistant was opened from and the one chosen.
  const extra = allAccounts.filter((a) => (a.id === startAccountId || a.id === accountId) && !match.candidates.some((c) => c.accountId === a.id));
  const listed = [...match.candidates, ...extra.map((a) => ({ accountId: a.id, namedInsured: a.name, evidence: [], score: 0 }))];
  const others = allAccounts.filter((a) => !listed.some((c) => c.accountId === a.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={meta.tone} data-testid="match-status">
          {meta.label}
        </Badge>
        <p className="text-xs text-[var(--color-ink-600)]">{match.reason}</p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {listed.map((c) => (
          <li key={c.accountId}>
            <label className={cn('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2', accountId === c.accountId ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-800)]/5' : 'border-[var(--color-ink-100)]')}>
              <input type="radio" name="email-account" className="mt-1" checked={accountId === c.accountId} onChange={() => onChoose(c.accountId)} aria-label={c.namedInsured} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink-900)]">{c.namedInsured}</p>
                {c.evidence.length === 0 && <p className="text-xs text-[var(--color-ink-500)]">Nothing in the email points to this account.</p>}
                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {c.evidence.map((e, i) => (
                    <li key={i} className={cn('text-xs', e.strength === 'conflict' ? 'text-[var(--color-danger-600)]' : e.strength === 'strong' ? 'text-[var(--color-success-600)]' : 'text-[var(--color-ink-500)]')}>
                      {e.strength === 'conflict' ? '✕ ' : e.strength === 'strong' ? '✓ ' : '· '}
                      {e.detail}
                    </li>
                  ))}
                </ul>
              </div>
            </label>
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 text-xs text-[var(--color-ink-600)]">
        Or another account
        <select aria-label="Choose another account" className={smallInputClass} value={others.some((o) => o.id === accountId) ? accountId : ''} onChange={(e) => e.target.value && onChoose(e.target.value)}>
          <option value="">—</option>
          {others.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function DocumentsReceived({ review, accountReview, choice, disabled, onToggle }: { review: EmailReview; accountReview: AccountReview; choice: Set<number> | null; disabled: boolean; onToggle: (index: number, on: boolean) => void }) {
  const provided = review.extraction.documents.filter((d) => d.stance === 'provided');
  return (
    <div className="flex flex-col gap-2">
      {accountReview.attachments.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-500)]">{review.email.source === 'paste' ? 'Pasted text can’t carry attachments — upload the .eml to check them.' : 'No attachments.'}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {accountReview.attachments.map((a) => (
            <AttachmentRow key={a.index} a={a} checked={!!choice?.has(a.index)} disabled={disabled || !a.importable} onToggle={(on) => onToggle(a.index, on)} />
          ))}
        </ul>
      )}
      {provided.length > 0 && (
        <p className="text-xs text-[var(--color-ink-600)]">
          The email says it sends: {provided.map((d) => d.label).join(', ')}.
        </p>
      )}
      {accountReview.contradictions.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/50 px-3 py-2" data-testid="email-contradictions">
          {accountReview.contradictions.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--color-warning-600)]">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {c.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachmentRow({ a, checked, disabled, onToggle }: { a: AttachmentReview; checked: boolean; disabled: boolean; onToggle: (on: boolean) => void }) {
  const meta = ATTACHMENT_LABEL[a.status];
  return (
    <li className="flex items-start gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-2" data-testid="email-attachment" data-status={a.status}>
      {a.importable ? (
        <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} aria-label={`Import ${a.name}`} />
      ) : (
        <Paperclip size={14} className="mt-0.5 shrink-0 text-[var(--color-ink-300)]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-[var(--color-ink-900)] break-all">{a.name}</span>
          <span className="text-xs text-[var(--color-ink-400)]">{Math.max(1, Math.round(a.sizeBytes / 1024))} KB</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-ink-600)]">{a.detail}</p>
      </div>
    </li>
  );
}

function MissingItems({ review, accountReview }: { review: EmailReview; accountReview: AccountReview }) {
  const docs = review.extraction.documents.filter((d) => d.stance !== 'provided');
  const deadline = review.extraction.deadlines[0];
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2" data-testid="email-deadline">
        {deadline ? (
          <>
            <p className="text-sm font-medium text-[var(--color-ink-900)]">Deadline {formatShortDate(deadline.date)}</p>
            <p className="mt-0.5 text-xs italic text-[var(--color-ink-400)]">“{deadline.evidence}”</p>
          </>
        ) : null}
        {review.deadlineCheck.note && <p className={cn('text-xs', deadline ? 'mt-1 text-[var(--color-warning-600)]' : 'text-[var(--color-ink-600)]')}>{review.deadlineCheck.note}</p>}
      </div>
      {docs.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-500)]">The newest part of this email asks for no documents.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((d) => {
            const check = accountReview.checks.find((c) => c.doc.requirementKey === d.requirementKey);
            return (
              <li key={d.requirementKey} className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2" data-testid="email-doc">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-ink-900)]">{d.label}</span>
                  <Badge tone={STANCE_LABEL[d.stance].tone}>{STANCE_LABEL[d.stance].label}</Badge>
                  {check && <Badge tone={OUTCOME_TONE[check.outcome]}>{check.message}</Badge>}
                </div>
                {d.instructions && <p className="mt-0.5 text-xs text-[var(--color-ink-600)]">{d.instructions}</p>}
                <p className="mt-1 text-xs italic text-[var(--color-ink-400)]">“{d.evidence}”</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function dateOf(s: Suggestion): { label: string; value: string } | undefined {
  if (s.kind === 'request_from_client') return { label: 'Follow up', value: s.followUpDate };
  if (s.kind === 'follow_up_request') return { label: 'Next follow-up', value: s.nextFollowUp };
  if (s.kind === 'schedule_follow_up') return { label: 'Due', value: s.dueDate };
  return undefined;
}

function SuggestionRow({ s, checked, locked, onToggle, onEdit }: { s: Suggestion; checked: boolean; locked: boolean; onToggle: (v: boolean) => void; onEdit: (patch: SuggestionEdit) => void }) {
  const date = dateOf(s);
  const blocked = 'blocked' in s ? s.blocked : undefined;
  return (
    <li className={cn('rounded-lg border px-3 py-2.5', checked ? 'border-[var(--color-brand-500)]/60' : 'border-[var(--color-ink-100)]')} data-testid={`suggestion-${s.kind}`}>
      <div className="flex items-start gap-2">
        {s.changesAccount ? (
          <input type="checkbox" className="mt-1" checked={checked} disabled={locked} onChange={(e) => onToggle(e.target.checked)} aria-label={s.title} />
        ) : (
          <span className="mt-0.5 text-[var(--color-ink-300)]">
            <FileText size={14} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium text-[var(--color-ink-900)]">{s.title}</p>
            <Badge tone={s.changesAccount ? 'warning' : 'neutral'}>{s.changesAccount ? 'Changes the account' : 'No account change'}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-ink-600)]">{s.detail}</p>
          {s.kind === 'import_attachments' && s.changesAccount && <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">{s.selected.length ? `${s.selected.length} ticked under Documents received.` : 'Tick the files to import under Documents received.'}</p>}
          {blocked && <p className="mt-1 text-xs font-medium text-[var(--color-danger-600)]">{blocked}</p>}
          {date && (
            <label className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--color-ink-600)]">
              {date.label}
              <input type="date" className={smallInputClass} value={date.value} onChange={(e) => onEdit({ date: e.target.value })} aria-label={`${date.label} date`} />
            </label>
          )}
        </div>
      </div>
    </li>
  );
}

function DraftCard({
  s,
  open,
  onToggle,
  onEdit,
  onCopy,
  copied,
  onOpenGmail,
  readOnly,
  linkPending,
}: {
  s: Suggestion;
  open: boolean;
  onToggle: () => void;
  onEdit: (draft: EmailDraft) => void;
  onCopy: () => void;
  copied: 'ok' | 'failed' | null;
  onOpenGmail: () => void;
  readOnly: boolean;
  linkPending: boolean;
}) {
  const draft = draftOf(s)!;
  const to = toOf(s);
  const url = gmailComposeUrl(to, draft);
  const label = s.kind === 'reply_to_sender' ? `Reply to ${to}` : s.kind === 'request_from_client' ? `Request to ${to ?? 'the client'}` : `Reminder to ${to ?? 'the client'}`;
  return (
    <li className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5" data-testid={`draft-${s.kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--color-ink-900)]">{label}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onToggle} className="text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
            {open ? 'Hide' : readOnly ? 'Show' : 'Show / edit'}
          </button>
          <button onClick={onCopy} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-700)] hover:underline cursor-pointer">
            <Copy size={12} /> {copied === 'ok' ? 'Copied' : 'Copy draft'}
          </button>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" onClick={onOpenGmail} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-700)] hover:underline">
              <Mail size={12} /> Open in Gmail
            </a>
          )}
        </div>
      </div>
      {copied === 'failed' && <p className="mt-1 text-xs text-[var(--color-danger-600)]">Couldn’t copy — select the text below and copy it.</p>}
      {linkPending && <p className="mt-1 text-xs text-[var(--color-ink-500)]">Its upload link works once you approve the request above.</p>}
      {open && (
        <div className="mt-2 flex flex-col gap-1.5" data-testid="draft-editor">
          <p className="text-xs text-[var(--color-ink-500)]">To: {to ?? '—'} · You send it yourself; nothing is sent from Renewal IQ.</p>
          <input className={inputClass} value={draft.subject} readOnly={readOnly} onChange={(e) => onEdit({ ...draft, subject: e.target.value })} aria-label="Draft subject" />
          <textarea className={cn(inputClass, 'text-xs')} rows={9} value={draft.body} readOnly={readOnly} onChange={(e) => onEdit({ ...draft, body: e.target.value })} aria-label="Draft body" />
        </div>
      )}
    </li>
  );
}

function AppliedPanel({ applied, onOpenAccount, onAnother }: { applied: { suggestions: Suggestion[]; outcomes: ApplyOutcome[]; accountId: string }; onOpenAccount: () => void; onAnother: () => void }) {
  return (
    <section className="flex flex-col gap-3" data-testid="email-applied">
      <h3 className="text-sm font-semibold text-[var(--color-ink-900)]">Done</h3>
      <ul className="flex flex-col gap-2">
        {applied.outcomes.map((o, i) => {
          const s = applied.suggestions.find((x) => x.id === o.suggestionId);
          return (
            <li key={i} className="flex items-start gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-2" data-testid="email-outcome">
              {o.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--color-success-600)]" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-[var(--color-danger-600)]" />}
              <div className="min-w-0">
                {s && <p className="text-sm font-medium text-[var(--color-ink-900)]">{s.title}</p>}
                <p className="text-xs text-[var(--color-ink-600)]">{o.message}</p>
              </div>
            </li>
          );
        })}
        {applied.suggestions
          .filter((s) => !s.changesAccount && s.kind !== 'reply_to_sender' && s.kind !== 'import_attachments')
          .map((s) => (
            <li key={s.id} className="flex items-start gap-2 rounded-lg border border-dashed border-[var(--color-ink-200)] px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--color-warning-600)]" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink-900)]">{s.title}</p>
                <p className="text-xs text-[var(--color-ink-600)]">{s.detail}</p>
              </div>
            </li>
          ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onOpenAccount}>
          Open the checklist
        </Button>
        <Button variant="ghost" onClick={onAnother}>
          Review another email
        </Button>
      </div>
    </section>
  );
}
