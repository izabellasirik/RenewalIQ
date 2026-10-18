import { describe, expect, it } from 'vitest';
import { EmailTooLargeError, htmlToText, MAX_EMAIL_BYTES, parseEmailInput, parseEml, parsePastedEmail, stripQuotedHistory } from '../parseEmail';
import { gmailComposeUrl } from '../../workflow/emailDraft';
import carrierRequest from './fixtures/carrier-request.eml?raw';
import clientSendsDocs from './fixtures/client-sends-docs.eml?raw';
import malicious from './fixtures/malicious.eml?raw';
import threadReply from './fixtures/thread-reply.eml?raw';
import sharedContact from './fixtures/shared-contact.txt?raw';

describe('reading a .eml file', () => {
  it('reads headers, quoted-printable text and the date', () => {
    const e = parseEml(carrierRequest);
    expect(e.from).toEqual({ name: 'Morgan Hale', address: 'mhale@granitemutual.example' });
    expect(e.subject).toBe('Northwind Freight LLC - USDOT 3141592 - items needed to quote');
    expect(e.date).toBe('2026-10-14T14:02:00.000Z');
    expect(e.messageId).toBe('<synthetic-carrier-001@granitemutual.example>');
    // The soft line break (=\n) is joined, not left in the text.
    expect(e.text).toContain('(USDOT 3141592). Before we can quote');
    expect(e.text).toContain('hold the Nov 1 effective date.');
    expect(e.auth).toEqual({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
  });

  it('decodes an encoded subject and lower-cases the sender address', () => {
    const e = parseEml(clientSendsDocs);
    expect(e.subject).toBe('Loss runs — Northwind');
    expect(e.from.address).toBe('dana@northwindfreight.example');
  });

  it('lists attachments with their decoded contents (kept in memory for fingerprints and an approved import only)', () => {
    const e = parseEml(clientSendsDocs);
    expect(e.attachments.map(({ name, contentType, sizeBytes }) => ({ name, contentType, sizeBytes }))).toEqual([{ name: 'loss_runs_2021-2026.pdf', contentType: 'application/pdf', sizeBytes: 31 }]);
    expect(new TextDecoder().decode(e.attachments[0].data!.slice(0, 8))).toBe('%PDF-1.4');
  });

  it('flags attachments it can\u2019t read: winmail.dat, an attached email', () => {
    const raw = `From: a@b.example\nSubject: files\nContent-Type: multipart/mixed; boundary="z"\n\n--z\nContent-Type: text/plain\n\nSee attached.\n--z\nContent-Type: application/ms-tnef; name="winmail.dat"\nContent-Disposition: attachment; filename="winmail.dat"\nContent-Transfer-Encoding: base64\n\nAAAA\n--z\nContent-Type: message/rfc822\n\nFrom: c@d.example\nSubject: old\n\nOld message.\n--z--`;
    const e = parseEml(raw);
    expect(e.attachments.map((a) => [a.name, !!a.unreadable, a.data === undefined])).toEqual([['winmail.dat', true, true], ['forwarded email.eml', true, true]]);
  });

  it('turns HTML into text without scripts, styles, hidden text or tags', () => {
    const e = parseEml(malicious);
    expect(e.text).toContain('Please send the unit list for Northwind Freight LLC.');
    expect(e.text).not.toMatch(/fetch\(|document\.cookie|<script|onerror|color:red/);
    expect(e.text).not.toContain('Ignore previous instructions');
    expect(e.text).not.toContain('<');
    expect(e.attachments.map((a) => a.name)).toEqual(['Loss_Runs.pdf.exe']);
  });

  it('keeps only the newest message for extraction (quoted history removed)', () => {
    const e = parseEml(threadReply);
    expect(e.text).toContain('the carrier needs 5 years of loss runs');
    expect(e.newText).toBe("Thanks, I'll get these together this week.\n\nDana");
  });

  it('refuses an email over the size limit', () => {
    const big = `From: a@b.example\nSubject: x\n\n${'a'.repeat(MAX_EMAIL_BYTES + 1)}`;
    expect(() => parseEml(big)).toThrow(EmailTooLargeError);
    expect(() => parsePastedEmail(big)).toThrow(EmailTooLargeError);
  });

  it('stops at deeply nested or very many MIME parts without failing', () => {
    let body = 'Content-Type: text/plain\n\nPlease send the IFTA.';
    for (let i = 0; i < 12; i++) body = `Content-Type: multipart/mixed; boundary="n${i}"\n\n--n${i}\n${body}\n--n${i}--`;
    const e = parseEml(`From: a@b.example\nSubject: nested\n${body}`);
    expect(e.warnings.join(' ')).toMatch(/nested too deeply/);

    const many = Array.from({ length: 260 }, (_, i) => `--z\nContent-Type: application/pdf; name="f${i}.pdf"\nContent-Disposition: attachment; filename="f${i}.pdf"\n\nx`).join('\n');
    const e2 = parseEml(`From: a@b.example\nSubject: many\nContent-Type: multipart/mixed; boundary="z"\n\n${many}\n--z--`);
    expect(e2.attachments.length).toBe(20);
    expect(e2.warnings.length).toBeGreaterThan(0);
  });
});

describe('reading pasted text', () => {
  it('reads Outlook-style header lines when present', () => {
    const e = parsePastedEmail(sharedContact);
    expect(e.from).toEqual({ name: 'Pat Owens', address: 'pat@owensholdings.example' });
    expect(e.subject).toBe('Renewal paperwork');
    expect(e.dateHeader).toBe('Thursday, October 15, 2026 2:10 PM');
    expect(e.text.startsWith('Hi, what else do you need')).toBe(true);
    expect(e.attachments).toEqual([]);
  });

  it('treats text without headers as the body', () => {
    const e = parsePastedEmail('Please send the loss runs.\nThanks');
    expect(e.from).toEqual({});
    expect(e.text).toBe('Please send the loss runs.\nThanks');
  });

  it('recognises a pasted raw .eml', () => {
    expect(parseEmailInput(carrierRequest, 'paste').source).toBe('eml');
  });

  it('a subject with line breaks or URL characters cannot break the Gmail link', () => {
    const e = parsePastedEmail('From: x@y.example\nSubject: Hi&su=evil#\nBcc: victim@z.example\n\nbody');
    const url = gmailComposeUrl('dana@northwindfreight.example', { subject: e.subject, body: 'a\r\nBcc: victim@z.example' })!;
    expect(new URL(url).searchParams.get('su')).toBe('Hi&su=evil#');
    expect(new URL(url).searchParams.get('bcc')).toBeNull();
    expect(new URL(url).searchParams.getAll('to')).toEqual(['dana@northwindfreight.example']);
  });
});

describe('helpers', () => {
  it('stripQuotedHistory stops at Outlook headers and ">" lines', () => {
    expect(stripQuotedHistory('New text\n\nFrom: Pat <p@x.example>\nSent: Monday\nSubject: old\n\nold request: send MVRs')).toBe('New text');
    expect(stripQuotedHistory('Reply\n> quoted MVR request\nmore')).toBe('Reply\nmore');
    expect(stripQuotedHistory('Hi\n-----Original Message-----\nPlease send IFTA')).toBe('Hi');
  });

  it('htmlToText decodes entities and keeps list items on their own lines', () => {
    expect(htmlToText('<ul><li>Loss&nbsp;runs</li><li>IFTA &amp; MVRs</li></ul>')).toBe('• Loss runs\n• IFTA & MVRs');
  });
});
