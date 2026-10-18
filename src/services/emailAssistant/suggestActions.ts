import type { Account, Contact, DocumentRequest, MarketQuote, MissingItem } from '../../types';
import { outstandingRequestItems } from '../../types/documentRequest';
import { draftClientRequestEmail, draftRequestFollowUpEmail, isSendableEmail, type EmailDraft } from '../workflow/emailDraft';
import { addBusinessDays, addDays, formatShortDate, parseDateKey } from '../workflow/dates';
import { firstName } from '../workflow/contacts';
import { carriersFor } from '../workflow/requirementKey';
import type { ParsedEmail } from './parseEmail';
import type { AttachmentReview } from './attachments';
import type { DocumentCheck } from './checklistCheck';
import { isHighRisk, type SafetySignal } from './safetyChecks';
import type { EmailExtraction, ExtractedDocument } from './types';

/**
 * Suggested next actions for one email and one account — a plan, nothing done. Each suggestion
 * says whether approving it changes the account; nothing changes until the agent approves, and
 * nothing is ever emailed (drafts are copied or opened in the agent's own Gmail). A document is
 * never marked received from an email: an attachment is imported only if the agent approves, and
 * stays to be verified on the account.
 */

export type SenderRole = 'carrier' | 'client' | 'unknown';

interface Base {
  id: string;
  title: string;
  detail: string;
  changesAccount: boolean;
  /** Ticked when the review opens. */
  defaultSelected: boolean;
}

export interface ChecklistAddition {
  doc: ExtractedDocument;
  /**
   * add      — not on the checklist: a new requirement;
   * reopen   — waived/not applicable on this account, but now needed;
   * link     — already on the checklist: only links the carrier asking for it.
   * (A newer copy of a received document is not added here — see the note in buildPlan.)
   */
  action: 'add' | 'reopen' | 'link';
  itemId?: string;
}

export type Suggestion =
  | (Base & { kind: 'add_to_checklist'; additions: ChecklistAddition[]; quoteId?: string; marketName?: string })
  | (Base & { kind: 'request_from_client'; docs: ExtractedDocument[]; existingItemIds: Record<string, string>; contactId?: string; to?: string; followUpDate: string; token: string; draft: EmailDraft; blocked?: string })
  | (Base & { kind: 'follow_up_request'; requestId?: string; itemIds: string[]; to?: string; nextFollowUp: string; draft: EmailDraft; blocked?: string })
  | (Base & { kind: 'schedule_follow_up'; subject: string; dueDate: string; notes: string })
  | (Base & { kind: 'import_attachments'; attachments: AttachmentReview[]; selected: number[]; docs: ExtractedDocument[]; waitingItems: MissingItem[] })
  | (Base & { kind: 'verify_received'; items: MissingItem[] })
  | (Base & { kind: 'reply_to_sender'; to: string; draft: EmailDraft })
  | (Base & { kind: 'open_quotes'; reason: string })
  | (Base & { kind: 'record_note'; text: string });

export interface PlanInput {
  email: ParsedEmail;
  extraction: EmailExtraction;
  safety: SafetySignal[];
  checks: DocumentCheck[];
  account: Account;
  items: MissingItem[];
  quotes: MarketQuote[];
  contacts: Contact[];
  requests: DocumentRequest[];
  senderRole: SenderRole;
  /** The market the email is from, when one fits (matchQuote) or the agent chose it. */
  quoteId?: string;
  effectiveDate?: string | null;
  agentName?: string;
  today: string;
  /** The secure upload link for a new request's token (only for cloud accounts). */
  linkFor?: (token: string) => string;
  newToken: () => string;
  fingerprint: string;
  /** This email was already reviewed for this account (a stored review, or its reference in the account notes). */
  alreadyReviewedOn?: string;
  /** Each attachment's fingerprint check (attachments.ts). */
  attachments?: AttachmentReview[];
  /** The email doesn't look related to the account: nothing is pre-selected. */
  unrelated?: boolean;
}

export interface Plan {
  suggestions: Suggestion[];
  /** Account changes need the agent to confirm, outside email, that the email is genuine. */
  requiresVerification: boolean;
  /** Plain-language notes on what was deliberately not suggested. */
  notes: string[];
}

const list = (labels: string[]) => (labels.length <= 2 ? labels.join(' and ') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`);

/** A follow-up a few business days out — sooner when the email has a deadline, never before tomorrow. */
function followUpDateFor(today: string, deadline: string | undefined): string {
  const base = parseDateKey(today) ?? new Date();
  const normal = addBusinessDays(base, 3);
  if (!deadline) return normal;
  const beforeDeadline = addDays(deadline, -2);
  const tomorrow = addDays(today, 1);
  const pick = beforeDeadline < normal ? beforeDeadline : normal;
  return pick < tomorrow ? tomorrow : pick;
}

export function buildPlan(input: PlanInput): Plan {
  const { email, extraction, checks, account, quotes, contacts, senderRole, today } = input;
  const suggestions: Suggestion[] = [];
  const notes: string[] = [];
  const highRisk = isHighRisk(input.safety);
  const quote = quotes.find((q) => q.id === input.quoteId);
  const deadline = extraction.deadlines[0]?.date;
  const fresh = !input.alreadyReviewedOn && !input.unrelated;

  const requested = checks.filter((c) => c.doc.stance === 'requested');
  const fromClient = senderRole === 'client';
  if (fromClient && requested.length) notes.push('The sender is the client, so documents they mention asking about are not added as requests.');

  // 1. Requirements the carrier (or an unknown sender) asks for → the checklist.
  const asks = fromClient ? [] : requested;
  const additions: ChecklistAddition[] = [];
  for (const c of asks) {
    if (c.outcome === 'new') additions.push({ doc: c.doc, action: 'add' });
    else if (c.outcome === 'waived') additions.push({ doc: c.doc, action: 'reopen', itemId: c.item?.id });
    else if (quote && c.item && !carriersFor(c.item).includes(quote.id)) additions.push({ doc: c.doc, action: 'link', itemId: c.item.id });
  }
  if (additions.length) {
    const label = (a: ChecklistAddition) => a.doc.label;
    const of = (action: ChecklistAddition['action']) => additions.filter((a) => a.action === action).map(label);
    const parts = [
      of('add').length ? `Add ${list(of('add'))} to the checklist` : '',
      of('reopen').length ? `reopen ${list(of('reopen'))} (was waived)` : '',
      of('link').length ? `link ${list(of('link'))} to ${quote!.marketName}` : '',
    ].filter(Boolean);
    const title = parts.join('; ');
    suggestions.push({
      id: 'add',
      kind: 'add_to_checklist',
      additions,
      quoteId: quote?.id,
      marketName: quote?.marketName,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      detail: quote ? `Recorded as ${quote.marketName}’s request; the market shows “Additional info requested”.` : 'Added as Missing — nothing is requested from the client until you approve that below.',
      changesAccount: true,
      defaultSelected: fresh,
    });
  }

  // 2. Ask the client — only for what isn't received and isn't already asked for.
  const toRequest = asks.filter((c) => c.outcome === 'new' || c.outcome === 'on_checklist' || c.outcome === 'waived');
  // A newer copy of something already received: the checklist keeps one row per requirement and
  // folds a second row back into the received one on the next save or reload, so a "newer copy"
  // row would silently disappear. Left to the agent on the account rather than suggested here.
  const newer = asks.filter((c) => c.wantsNewerCopy);
  if (newer.length) notes.push(`${list(newer.map((c) => c.doc.label))} ${newer.length === 1 ? 'is' : 'are'} already received, but the email asks for a newer copy. Handle that on the account — it isn’t suggested here.`);
  const contact = contacts.find((c) => c.primary && isSendableEmail(c.email)) ?? contacts.find((c) => isSendableEmail(c.email));
  if (toRequest.length) {
    const token = input.newToken();
    const followUpDate = followUpDateFor(today, deadline);
    const carrierNames: Record<string, string> = quote ? { [quote.id]: quote.marketName } : {};
    const draft = draftClientRequestEmail({
      account,
      contact,
      items: toRequest.map((c) => ({ label: c.doc.label, instructions: c.doc.instructions, neededByQuoteIds: quote ? [quote.id] : undefined })),
      effectiveDate: input.effectiveDate,
      carrierNamesByQuoteId: carrierNames,
      brokerName: input.agentName,
      uploadLink: input.linkFor ? input.linkFor(token) : undefined,
    });
    if (deadline) draft.body = draft.body.replace(/\n\nThank you,/, `\n\nWe need ${toRequest.length === 1 ? 'it' : 'these'} by ${formatShortDate(addDays(deadline, -1))} to meet the carrier’s deadline.\n\nThank you,`);
    suggestions.push({
      id: 'request',
      kind: 'request_from_client',
      docs: toRequest.map((c) => c.doc),
      existingItemIds: Object.fromEntries(toRequest.filter((c) => c.item).map((c) => [c.doc.requirementKey, c.item!.id])),
      contactId: contact?.id,
      to: contact?.email,
      followUpDate,
      token,
      draft,
      blocked: contact ? undefined : 'No contact on this account has an email address. Add one on the account first.',
      title: `Request ${list(toRequest.map((c) => c.doc.label))} from ${contact ? contact.name : 'the client'}`,
      detail: `${input.linkFor ? 'Creates a secure upload link (Prepared) and drafts the email' : 'Drafts the email'} to ${contact?.email ?? '—'} (the contact on file, never an address from this email), adding anything not on the checklist yet. Follow up ${formatShortDate(followUpDate)}. You send it from Gmail, then mark it sent.`,
      changesAccount: true,
      defaultSelected: fresh && !!contact,
    });
  }

  // 3. Already asked for → a reminder on the SAME request, not a second request.
  const pending = asks.filter((c) => c.outcome === 'already_requested');
  const byRequest = new Map<string, DocumentCheck[]>();
  const loose: DocumentCheck[] = [];
  for (const c of pending) {
    if (c.openRequest) byRequest.set(c.openRequest.id, [...(byRequest.get(c.openRequest.id) ?? []), c]);
    else loose.push(c);
  }
  const nextFollowUp = followUpDateFor(today, deadline);
  for (const [requestId, group] of byRequest) {
    const r = group[0].openRequest!;
    const outstanding = outstandingRequestItems(r);
    const link = input.linkFor ? input.linkFor(r.token) : '';
    const to = r.contactEmail && isSendableEmail(r.contactEmail) ? r.contactEmail : contact?.email;
    const draft = draftRequestFollowUpEmail({ account, contactName: r.contactName, outstanding: outstanding.map((i) => ({ label: i.label, instructions: i.instructions })), received: r.items.length - outstanding.length, uploadLink: link, brokerName: input.agentName });
    const prepared = r.deliveryStatus === 'prepared';
    suggestions.push({
      id: `followup:${requestId}`,
      kind: 'follow_up_request',
      requestId,
      itemIds: group.map((c) => c.item!.id),
      to,
      nextFollowUp,
      draft,
      blocked: prepared ? 'That request was prepared but never marked sent. Open the account and send (or mark sent) the original first.' : undefined,
      title: `Remind ${r.contactName ?? 'the client'} about ${list(group.map((c) => c.doc.label))} (already requested)`,
      detail: `Uses the existing request and its link — no duplicate request. Records the reminder and sets the next follow-up to ${formatShortDate(nextFollowUp)}.`,
      changesAccount: true,
      defaultSelected: fresh && !prepared,
    });
  }
  if (loose.length) {
    const draft = draftClientRequestEmail({ account, contact, items: loose.map((c) => ({ label: c.item!.label, instructions: c.item!.instructions })), effectiveDate: input.effectiveDate, brokerName: input.agentName });
    draft.subject = `Reminder: ${draft.subject}`;
    suggestions.push({
      id: 'followup:items',
      kind: 'follow_up_request',
      itemIds: loose.map((c) => c.item!.id),
      to: contact?.email,
      nextFollowUp,
      draft,
      blocked: contact ? undefined : 'No contact on this account has an email address.',
      title: `Remind the client about ${list(loose.map((c) => c.doc.label))} (already requested)`,
      detail: `No new request. Moves the follow-up date to ${formatShortDate(nextFollowUp)}.`,
      changesAccount: true,
      defaultSelected: fresh && !!contact,
    });
  }

  // 4. Received but not checked yet / already received and ready.
  const unverified = asks.filter((c) => c.outcome === 'received_unverified' && !c.wantsNewerCopy).map((c) => c.item!);
  if (unverified.length) {
    suggestions.push({ id: 'verify', kind: 'verify_received', items: unverified, title: `Verify ${list(unverified.map((i) => i.label))} before sending it on`, detail: 'It arrived but nobody has checked it yet. Open the account’s checklist to verify.', changesAccount: false, defaultSelected: false });
  }
  const onFile = asks.filter((c) => c.outcome === 'received' && !c.wantsNewerCopy);
  if (onFile.length && !quote) notes.push(`${list(onFile.map((c) => c.doc.label))} ${onFile.length === 1 ? 'is' : 'are'} already received — nothing to request.`);

  // 5. A carrier deadline → a dated follow-up on Today's Plate.
  if (deadline && asks.length) {
    const due = addDays(deadline, -1) < today ? today : addDays(deadline, -1);
    suggestions.push({
      id: 'deadline',
      kind: 'schedule_follow_up',
      subject: `Send ${list(asks.map((c) => c.doc.label))} to ${quote?.marketName ?? (email.from.name || email.from.address || 'the carrier')} (due ${formatShortDate(deadline)})`,
      dueDate: due,
      notes: `From the email “${email.subject || '(no subject)'}”: ${extraction.deadlines[0].evidence}`,
      title: `Follow up ${formatShortDate(due)} — the deadline is ${formatShortDate(deadline)}`,
      detail: 'Shows on Today’s Plate the day before the deadline.',
      changesAccount: true,
      defaultSelected: fresh,
    });
  }

  // 6. Attachments: imported only if the agent approves (new files ticked, duplicates not); never "received" until verified on the account.
  const provided = checks.filter((c) => c.doc.stance === 'provided');
  const reviewed = input.attachments ?? [];
  if (email.attachments.length || provided.length) {
    const waitingItems = provided.map((c) => c.item).filter((i): i is MissingItem => !!i && i.status !== 'received' && i.status !== 'waived');
    const importable = reviewed.filter((a) => a.importable);
    const selected = importable.filter((a) => a.defaultSelected).map((a) => a.index);
    const stays = waitingItems.length ? ` ${list(waitingItems.map((i) => i.label))} stay${waitingItems.length === 1 ? 's' : ''} open until you verify the file on the account.` : '';
    suggestions.push({
      id: 'attachments',
      kind: 'import_attachments',
      attachments: reviewed,
      selected: fresh ? selected : [],
      docs: provided.map((c) => c.doc),
      waitingItems,
      title: importable.length
        ? `Import ${importable.length === 1 ? 'the attachment' : `attachments (${importable.length})`} to the account’s documents`
        : email.attachments.length
          ? 'No attachment can be imported'
          : `The sender says ${list(provided.map((c) => c.doc.label))} ${provided.length === 1 ? 'was' : 'were'} sent — nothing is attached here`,
      detail: importable.length
        ? `Only the files you tick are uploaded, with the account’s normal checks.${stays} Nothing is marked received from an email.`
        : email.attachments.length
          ? 'They are already on the account, or can’t be imported (see Documents received).'
          : 'Check your inbox or the client’s upload link. Nothing is marked received from an email.',
      changesAccount: importable.length > 0,
      defaultSelected: fresh && selected.length > 0,
    });
  }

  // 7. Quote / decline → the agent records it in Markets & Quotes.
  if (extraction.intent === 'quote' || extraction.intent === 'decline') {
    suggestions.push({
      id: 'quotes',
      kind: 'open_quotes',
      reason: extraction.intent,
      title: extraction.intent === 'quote' ? `Record the quote${quote ? ` from ${quote.marketName}` : ''} in Markets & Quotes` : `Record the decline${quote ? ` from ${quote.marketName}` : ''} in Markets & Quotes`,
      detail: 'Premiums and declines are entered by you, from the carrier’s document — not read from the email.',
      changesAccount: false,
      defaultSelected: false,
    });
  }

  // 8. A short acknowledgement to the carrier.
  const senderAddress = email.from.address;
  if (senderRole === 'carrier' && asks.length && senderAddress && isSendableEmail(senderAddress) && !highRisk) {
    const who = email.from.name ? firstName(email.from.name.replace(/^"|"$/g, '')) : '';
    const promise = deadline ? ` by ${formatShortDate(deadline)}` : ' as soon as we have them';
    const body = [
      who ? `Hi ${who},` : 'Hi,',
      '',
      `Thanks — we’re on it. We’ve asked ${account.namedInsured} for ${list(asks.map((c) => c.doc.label))} and will send ${asks.length === 1 ? 'it' : 'them'} over${promise}.`,
      '',
      'Thank you,',
      input.agentName || '',
    ]
      .join('\n')
      .trimEnd();
    suggestions.push({
      id: 'reply',
      kind: 'reply_to_sender',
      to: senderAddress,
      draft: { subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject || account.namedInsured}`, body },
      title: `Draft a reply to ${senderAddress}`,
      detail: 'Opens in your Gmail to review and send. Nothing is sent from Renewal IQ.',
      changesAccount: false,
      defaultSelected: false,
    });
  } else if (senderRole === 'carrier' && highRisk) notes.push('No reply is drafted to a sender that may not be genuine.');

  // 9. A note on the account: what was reviewed, with a reference that spots the same email later.
  const sender = email.from.name ? `${email.from.name} <${email.from.address ?? ''}>` : (email.from.address ?? 'unknown sender');
  suggestions.push({
    id: 'note',
    kind: 'record_note',
    text: `Email reviewed: “${email.subject || '(no subject)'}” from ${sender}${email.date ? ` (${formatShortDate(email.date.slice(0, 10))})` : ''}. [email ref ${input.fingerprint}]`,
    title: 'Add a note that this email was reviewed',
    detail: 'Keeps a record on the account and lets Renewal IQ recognise the same email if it’s reviewed again.',
    changesAccount: true,
    defaultSelected: fresh,
  });

  if (input.alreadyReviewedOn) notes.unshift(`This email was already reviewed for this account on ${formatShortDate(input.alreadyReviewedOn.slice(0, 10))}. Nothing is pre-selected.`);
  else if (input.unrelated) notes.unshift('This email doesn’t look related to the account. Nothing is pre-selected.');
  return { suggestions, requiresVerification: highRisk, notes };
}

/** A stable reference for the same email (its Message-ID, else its sender, subject, date and text). */
export function emailFingerprint(email: ParsedEmail): string {
  const basis = email.messageId?.trim() || [email.from.address ?? '', email.subject, email.dateHeader ?? '', email.newText.replace(/\s+/g, ' ').trim()].join('\u0001');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < basis.length; i++) {
    const c = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** When this email (by reference) was already noted on the account. */
export function alreadyReviewed(account: Pick<Account, 'notes'>, fingerprint: string): string | undefined {
  return (account.notes ?? []).find((n) => n.text.includes(`[email ref ${fingerprint}]`))?.createdAt;
}
