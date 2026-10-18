import type { Account, Contact, DocumentRequest, MarketQuote, MissingItem, UploadedDocument } from '../../types';
import { parseEmailInput, type ParsedEmail } from './parseEmail';
import { referenceDateFor } from './rulesExtractor';
import { safetyChecks, type SafetySignal } from './safetyChecks';
import { matchAccount, matchQuote, type AccountMatch, type MatchCandidateInput } from './matchAccount';
import { checkChecklist, type DocumentCheck } from './checklistCheck';
import { alreadyReviewed, buildPlan, emailFingerprint, type Plan, type SenderRole } from './suggestActions';
import { readEmail, type EmailAiClient, type ReadOutcome } from './aiExtractor';
import { classifyEmail, guardDeadlines, type Classification, type DeadlineCheck } from './classify';
import { readAttachments, reviewAttachments, type AttachmentDeps, type AttachmentFacts, type AttachmentReview, type Contradiction, type EarlierAttachment } from './attachments';
import type { LoadedEmail, EmailSourceRef } from './sources';
import type { EmailExtraction } from './types';

export interface EmailReview {
  email: ParsedEmail;
  source: EmailSourceRef;
  read: ReadOutcome;
  /** What the email says, deadlines already checked against its text. */
  extraction: EmailExtraction;
  deadlineCheck: DeadlineCheck;
  safety: SafetySignal[];
  match: AccountMatch;
  fingerprint: string;
  attachmentFacts: AttachmentFacts[];
}

/** Load → read (rules, then AI if unsure and allowed) → deadline check → safety → attachments → account match. Changes nothing. */
export async function analyzeEmail(
  loaded: LoadedEmail,
  candidates: MatchCandidateInput[],
  opts: { agencyId?: string | null; today: string; ai?: EmailAiClient | null; accountId?: string } & AttachmentDeps
): Promise<EmailReview> {
  const email = parseEmailInput(loaded.raw, loaded.format);
  const referenceDate = referenceDateFor(email, opts.today);
  const read = await readEmail(email, { referenceDate, accountId: opts.accountId }, opts.ai ?? null);
  const deadlineCheck = guardDeadlines(email, read.extraction, referenceDate, opts.today);
  const extraction = { ...read.extraction, deadlines: deadlineCheck.deadlines };
  return {
    email,
    source: loaded.ref,
    read,
    extraction,
    deadlineCheck,
    safety: safetyChecks(email),
    match: matchAccount(email, extraction, candidates, { agencyId: opts.agencyId }),
    fingerprint: emailFingerprint(email),
    attachmentFacts: await readAttachments(email, { readText: opts.readText }),
  };
}

export interface AccountContext {
  account: Account;
  items: MissingItem[];
  quotes: MarketQuote[];
  contacts: Contact[];
  requests: DocumentRequest[];
  effectiveDate?: string | null;
  documents?: UploadedDocument[];
  dotNumber?: string | null;
  /** Attachments of emails reviewed before for this account (fingerprints, from the stored reviews). */
  earlierAttachments?: EarlierAttachment[];
  /** When this same email was reviewed before for this account, from the stored reviews. */
  reviewedBefore?: string;
}

export interface AccountReview {
  checks: DocumentCheck[];
  plan: Plan;
  senderRole: SenderRole;
  quoteId?: string;
  quoteCandidates: MarketQuote[];
  classification: Classification;
  attachments: AttachmentReview[];
  contradictions: Contradiction[];
  /** Signs the email is about another client — account changes wait for the agent to confirm. */
  accountWarnings: string[];
}

/** Who the sender is to this account: a contact on file is the client; a named market is a carrier. */
export function senderRoleFor(review: EmailReview, ctx: AccountContext, quoteId: string | undefined): SenderRole {
  const sender = review.email.from.address?.toLowerCase();
  if (sender && ctx.contacts.some((c) => c.email?.trim().toLowerCase() === sender)) return 'client';
  if (quoteId) return 'carrier';
  return review.extraction.senderRoleGuess === 'carrier' ? 'carrier' : 'unknown';
}

/** Why this email may belong to a different account than the one chosen. */
export function accountWarningsFor(review: EmailReview, accountId: string, contradictions: Contradiction[]): string[] {
  const out: string[] = [];
  const { match } = review;
  const other = match.status === 'matched' && match.accountId !== accountId ? match.candidates.find((c) => c.accountId === match.accountId) : undefined;
  if (other) out.push(`This email looks like it’s about ${other.namedInsured} (${match.reason}).`);
  const conflict = match.candidates.find((c) => c.accountId === accountId)?.evidence.find((e) => e.kind === 'dot_conflict');
  if (conflict) out.push(`${conflict.detail}.`);
  else if (!match.candidates.some((c) => c.accountId === accountId) && review.extraction.identifiers.dotNumbers.length && !other) out.push(`The email’s USDOT (${review.extraction.identifiers.dotNumbers.join(', ')}) isn’t this account’s.`);
  for (const c of contradictions) if (c.code === 'insured_mismatch' || c.code === 'dot_mismatch') out.push(c.message);
  return out;
}

export function reviewForAccount(
  review: EmailReview,
  ctx: AccountContext,
  opts: { today: string; agentName?: string; linkFor?: (token: string) => string; newToken: () => string; quoteId?: string | null }
): AccountReview {
  const quoteMatch = matchQuote(review.email, ctx.quotes);
  const quoteId = opts.quoteId === null ? undefined : (opts.quoteId ?? quoteMatch.quoteId);
  const senderRole = senderRoleFor(review, ctx, quoteId);
  const checks = checkChecklist(review.extraction.documents, ctx.items, ctx.requests);
  const { attachments, contradictions } = reviewAttachments(review.email, review.attachmentFacts, review.extraction, {
    documents: ctx.documents ?? [],
    namedInsured: ctx.account.namedInsured,
    dotNumber: ctx.dotNumber,
    earlier: ctx.earlierAttachments,
  });
  const accountWarnings = accountWarningsFor(review, ctx.account.id, contradictions);
  const classification = classifyEmail({ email: review.email, extraction: review.extraction, match: review.match, senderRole, attachments, rulesDoubts: review.read.method === 'rules' ? review.read.rulesDoubts : [] });
  const plan = buildPlan({
    email: review.email,
    extraction: review.extraction,
    safety: review.safety,
    checks,
    account: ctx.account,
    items: ctx.items,
    quotes: ctx.quotes,
    contacts: ctx.contacts,
    requests: ctx.requests,
    senderRole,
    quoteId: senderRole === 'client' ? undefined : quoteId,
    effectiveDate: ctx.effectiveDate,
    agentName: opts.agentName,
    today: opts.today,
    linkFor: opts.linkFor,
    newToken: opts.newToken,
    fingerprint: review.fingerprint,
    alreadyReviewedOn: ctx.reviewedBefore ?? alreadyReviewed(ctx.account, review.fingerprint),
    attachments,
    unrelated: classification.category === 'unrelated',
  });
  return { checks, plan, senderRole, quoteId, quoteCandidates: quoteMatch.candidates, classification, attachments, contradictions, accountWarnings };
}
