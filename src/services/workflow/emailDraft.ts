import type { Account, Contact, MissingItem } from '../../types';
import { firstName } from './contacts';
import { formatShortDate } from './dates';
import { carriersFor } from './requirementKey';

export interface EmailDraft {
  subject: string;
  body: string;
}

/**
 * Plain-text request email for one or more missing items. Deterministic template, not AI — the
 * broker edits it before sending, and nothing is ever sent automatically.
 */
export function draftClientRequestEmail({
  account,
  contact,
  items,
  effectiveDate,
  carrierNamesByQuoteId,
  brokerName,
  uploadLink,
}: {
  account: Account;
  contact: Contact | undefined;
  items: Pick<MissingItem, 'label' | 'instructions' | 'neededByQuoteIds' | 'neededByQuoteId'>[];
  effectiveDate?: string | null;
  carrierNamesByQuoteId?: Record<string, string>;
  brokerName?: string;
  /** The request's secure upload link (or its placeholder until it's created). */
  uploadLink?: string;
}): EmailDraft {
  const greeting = contact ? `Hi ${firstName(contact.name)},` : 'Hi,';
  const carriers = [...new Set(items.flatMap((i) => carriersFor(i as MissingItem).map((q) => carrierNamesByQuoteId?.[q])).filter((c): c is string => !!c))];
  const one = items.length === 1;

  const subject = one ? `${account.namedInsured} — ${items[0].label} needed` : `${account.namedInsured} — items needed for your insurance submission`;

  const context =
    carriers.length > 0
      ? `${carriers.join(' and ')} ${carriers.length === 1 ? 'has' : 'have'} asked for ${one ? 'the following' : 'a few more items'} to keep ${account.namedInsured}'s quote moving:`
      : effectiveDate
        ? `To get ${account.namedInsured}'s renewal (effective ${formatShortDate(effectiveDate)}) out to the markets, we still need ${one ? 'the following' : 'the following items'}:`
        : `To finish ${account.namedInsured}'s insurance submission, we still need ${one ? 'the following' : 'the following items'}:`;

  const list = items.map((i) => `  • ${i.label}${i.instructions ? ` — ${i.instructions}` : ''}`).join('\n');

  const body = [
    greeting,
    '',
    context,
    '',
    list,
    '',
    uploadLink ? `Please upload them securely here:\n${uploadLink}` : 'You can reply to this email with the documents attached. Let me know if you have any questions.',
    '',
    'Thank you,',
    brokerName || '',
  ]
    .join('\n')
    .trimEnd();

  return { subject, body };
}

/** A follow-up on a client request: only what's STILL outstanding, and the same secure link. */
export function draftRequestFollowUpEmail({
  account,
  contactName,
  outstanding,
  received,
  uploadLink,
  brokerName,
}: {
  account: Pick<Account, 'namedInsured'>;
  contactName?: string;
  outstanding: { label: string; instructions?: string }[];
  /** How many of the requested items have already come in (thanks the client, never re-asks). */
  received: number;
  uploadLink: string;
  brokerName?: string;
}): EmailDraft {
  const one = outstanding.length === 1;
  const subject = one ? `Reminder: ${outstanding[0].label} still needed — ${account.namedInsured}` : `Reminder: ${outstanding.length} items still needed — ${account.namedInsured}`;
  const body = [
    contactName ? `Hi ${firstName(contactName)},` : 'Hi,',
    '',
    `${received > 0 ? `Thank you for what you've sent so far. ` : ''}We're still missing the following for ${account.namedInsured}'s insurance submission:`,
    '',
    outstanding.map((i) => `  • ${i.label}${i.instructions ? ` — ${i.instructions}` : ''}`).join('\n'),
    '',
    `Please upload ${one ? 'it' : 'them'} securely here:\n${uploadLink}`,
    '',
    'Thank you,',
    brokerName || '',
  ]
    .join('\n')
    .trimEnd();
  return { subject, body };
}

export function mailtoHref(to: string | undefined, draft: EmailDraft): string {
  return `mailto:${encodeURIComponent(to ?? '')}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}
