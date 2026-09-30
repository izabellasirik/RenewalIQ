import { describe, expect, it } from 'vitest';
import { gmailComposeUrl, isSendableEmail } from '../emailDraft';

const BODY = [
  'Hi Pat,',
  '',
  'To finish the renewal for ABC Trucking & Sons (DOT #1234567) we still need:',
  '  • MVR — John O’Brien',
  '  • Loss runs, 5 yrs: 100% complete? 50/50 + extras',
  '',
  'Upload securely here:',
  'https://app.renewaliq.com/r/4811a116bada4c0da6abc1dbcbb2272c?x=1&y=2#top',
  '',
  'Thank you,',
  'Roman Smith — Adriatic Agency',
].join('\n');

describe('Open in Gmail: compose URL', () => {
  const draft = { subject: 'Documents needed: ABC Trucking & Sons — 2 items (#renewal)', body: BODY };
  const url = gmailComposeUrl('pat.client+ops@client.com', draft)!;
  const params = new URL(url).searchParams;

  it('opens Gmail’s compose window', () => {
    expect(url.startsWith('https://mail.google.com/mail/?view=cm&fs=1')).toBe(true);
  });
  it('recipient populated exactly', () => expect(params.get('to')).toBe('pat.client+ops@client.com'));
  it('subject populated exactly (&, #, — survive)', () => expect(params.get('su')).toBe(draft.subject));
  it('multiline body preserved line for line', () => {
    expect(params.get('body')).toBe(BODY);
    expect(params.get('body')!.split('\n')).toHaveLength(11);
  });
  it('special characters are encoded, not raw in the URL', () => {
    const query = url.split('?')[1];
    // Only our own separators appear raw; nothing from the draft can add or cut a parameter.
    expect(query.split('&').map((p) => p.split('=')[0])).toEqual(['view', 'fs', 'tf', 'to', 'su', 'body']);
    expect(url).not.toMatch(/[\s\n#]/);
    expect(url).toContain('%0A');
    expect(url).toContain('%26');
    expect(url).toContain('%2B');
  });
  it('a different contact gives a different recipient', () => {
    expect(new URL(gmailComposeUrl('  second@client.com ', draft)!).searchParams.get('to')).toBe('second@client.com');
  });
  it('no usable email → no URL (the dialog asks for one instead)', () => {
    expect(gmailComposeUrl(undefined, draft)).toBeNull();
    expect(gmailComposeUrl('', draft)).toBeNull();
    expect(gmailComposeUrl('Pat Client', draft)).toBeNull();
    expect(gmailComposeUrl('a@b.com, c@d.com', draft)).toBeNull();
    expect(gmailComposeUrl('a@b.com\nbcc:x@y.com', draft)).toBeNull();
    expect(isSendableEmail('pat@client.com')).toBe(true);
  });
});
