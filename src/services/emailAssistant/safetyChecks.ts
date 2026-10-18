import type { ParsedEmail } from './parseEmail';

/**
 * Signs an email may not be what it looks like. A 'high' signal blocks every account change until
 * the agent confirms — outside email, e.g. by phone — that the email is genuine. Nothing in an
 * email's text is ever followed as an instruction: these checks only report.
 */
export type SafetyLevel = 'high' | 'caution';

export interface SafetySignal {
  code:
    | 'auth_failed'
    | 'reply_to_differs'
    | 'display_name_address'
    | 'payment_or_credentials'
    | 'instructions_to_software'
    | 'dangerous_attachment'
    | 'hidden_text'
    | 'disguised_link'
    | 'link_shortener'
    | 'unreadable_parts';
  level: SafetyLevel;
  message: string;
}

const domainOf = (address: string | undefined) => address?.split('@')[1]?.toLowerCase() ?? '';

/** Registrable-ish domain: the last two labels ("mail.carrier.com" → "carrier.com"). */
export function baseDomain(domain: string): string {
  const parts = domain.toLowerCase().replace(/\.$/, '').split('.');
  return parts.slice(-2).join('.');
}

export const DANGEROUS_EXT = /\.(exe|scr|bat|cmd|com|pif|js|jse|vbs|vbe|wsf|hta|jar|msi|ps1|lnk|iso|img|html?|svg|docm|xlsm|pptm)$/i;

const PAYMENT_OR_CREDENTIALS =
  /\b(wire (transfer|instructions)|bank(ing)? (details|info(rmation)?|account)|routing (number|no\.?)|account number|change (of|to) (our |the )?(bank|payment|remittance)|new (bank|payment) (details|account|instructions)|gift cards?|password|passcode|log ?in (here|to verify)|verify your (account|identity|login)|one[- ]time code|ssn|social security number)\b/i;

/** Text addressed to an automated reader rather than to the agent. */
const INSTRUCTIONS_TO_SOFTWARE =
  /\b(ignore (all |any |the )?(previous|prior|above) (instructions|messages)|disregard (all |the )?(previous|prior) instructions|system prompt|you are (now )?(an? )?(ai|assistant|language model)|as an ai|(mark|set) (all|every|each) (items?|documents?|requests?)[^.]{0,40}\b(received|complete|verified|done)|auto[- ]?(approve|forward|reply)|forward (this|all) (email|messages?|documents?) to)\b/i;

const SHORTENERS = /\bhttps?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rb\.gy|cutt\.ly|shorturl\.at)\//i;

export function safetyChecks(email: ParsedEmail): SafetySignal[] {
  const signals: SafetySignal[] = [];
  const add = (s: SafetySignal) => {
    if (!signals.some((x) => x.code === s.code)) signals.push(s);
  };

  const failed = (['spf', 'dkim', 'dmarc'] as const).filter((k) => {
    const v = email.auth[k];
    return v === 'fail' || v === 'softfail' || v === 'permerror';
  });
  if (failed.length) add({ code: 'auth_failed', level: 'high', message: `The sender couldn’t be verified (${failed.map((f) => f.toUpperCase()).join(', ')} failed) — it may not be from who it says.` });

  const fromDomain = domainOf(email.from.address);
  const replyDomain = domainOf(email.replyTo?.address);
  if (replyDomain && fromDomain && baseDomain(replyDomain) !== baseDomain(fromDomain)) {
    add({ code: 'reply_to_differs', level: 'high', message: `Replies would go to ${email.replyTo!.address}, not the sender (${email.from.address}). Drafts never use that address.` });
  }

  const nameAddress = /[^\s<>()"]+@[^\s<>()"]+\.[a-z]{2,}/i.exec(email.from.name ?? '')?.[0]?.toLowerCase();
  if (nameAddress && email.from.address && nameAddress !== email.from.address) {
    add({ code: 'display_name_address', level: 'high', message: `The sender’s name shows ${nameAddress}, but the email actually came from ${email.from.address}.` });
  }

  const allText = `${email.subject}\n${email.text}`;
  if (PAYMENT_OR_CREDENTIALS.test(allText)) {
    add({ code: 'payment_or_credentials', level: 'high', message: 'Mentions payment details, bank changes or log-in information. Verify by phone using a number you already have; never act on it from the email.' });
  }
  if (INSTRUCTIONS_TO_SOFTWARE.test(allText) || email.html.some((h) => INSTRUCTIONS_TO_SOFTWARE.test(h))) {
    add({ code: 'instructions_to_software', level: 'high', message: 'Contains instructions aimed at automated tools (e.g. “ignore previous instructions”, “mark everything received”). They were ignored.' });
  }

  const risky = email.attachments.filter((a) => DANGEROUS_EXT.test(a.name.trim()) || /\.(pdf|docx?|xlsx?|jpe?g|png)\.(exe|js|scr|bat|cmd|vbs|html?)$/i.test(a.name.trim()));
  if (risky.length) add({ code: 'dangerous_attachment', level: 'high', message: `Attachment${risky.length === 1 ? '' : 's'} that can run code or disguise a page: ${risky.map((a) => a.name).join(', ')}. Don’t open ${risky.length === 1 ? 'it' : 'them'}.` });

  for (const html of email.html) {
    if (/style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|color\s*:\s*(#fff(fff)?|white)\b)/i.test(html)) {
      add({ code: 'hidden_text', level: 'caution', message: 'Contains hidden text (invisible styling). Hidden text was left out of what was read.' });
    }
    for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = m[1];
      const label = m[2].replace(/<[^>]*>/g, '').trim();
      const labelHost = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(?:[/:?#]|$)/i.exec(label)?.[1];
      const hrefHost = /^https?:\/\/([^/:?#]+)/i.exec(href)?.[1];
      if (labelHost && hrefHost && baseDomain(labelHost) !== baseDomain(hrefHost)) {
        add({ code: 'disguised_link', level: 'high', message: `A link shows “${labelHost}” but goes to ${hrefHost}. Links in emails are never opened by Renewal IQ.` });
      }
    }
  }
  if (SHORTENERS.test(allText) || email.html.some((h) => SHORTENERS.test(h))) {
    add({ code: 'link_shortener', level: 'caution', message: 'Contains a shortened link that hides where it goes.' });
  }
  if (email.warnings.length) add({ code: 'unreadable_parts', level: 'caution', message: email.warnings.join(' ') });
  return signals;
}

export const isHighRisk = (signals: SafetySignal[]) => signals.some((s) => s.level === 'high');
