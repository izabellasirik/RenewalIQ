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
}: {
  account: Account;
  contact: Contact | undefined;
  items: MissingItem[];
  effectiveDate?: string | null;
  carrierNamesByQuoteId?: Record<string, string>;
  brokerName?: string;
}): EmailDraft {
  const greeting = contact ? `Hi ${firstName(contact.name)},` : 'Hi,';
  const carriers = [...new Set(items.flatMap((i) => carriersFor(i).map((q) => carrierNamesByQuoteId?.[q])).filter((c): c is string => !!c))];
  const one = items.length === 1;

  const subject = one ? `${account.namedInsured} — ${items[0].label} needed` : `${account.namedInsured} — items needed for your insurance submission`;

  const context =
    carriers.length > 0
      ? `${carriers.join(' and ')} ${carriers.length === 1 ? 'has' : 'have'} asked for ${one ? 'the following' : 'a few more items'} to keep ${account.namedInsured}'s quote moving:`
      : effectiveDate
        ? `To get ${account.namedInsured}'s renewal (effective ${formatShortDate(effectiveDate)}) out to the markets, we still need ${one ? 'the following' : 'the following items'}:`
        : `To finish ${account.namedInsured}'s insurance submission, we still need ${one ? 'the following' : 'the following items'}:`;

  const list = items.map((i) => `  • ${i.label}`).join('\n');

  const body = [
    greeting,
    '',
    context,
    '',
    list,
    '',
    'You can reply to this email with the documents attached. Let me know if you have any questions.',
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
