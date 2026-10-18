import { describe, expect, it } from 'vitest';
import { evaluateExtractor, type LabelledEmail } from '../evaluate';
import { RULES_EXTRACTOR } from '../rulesExtractor';
import type { EmailExtractor } from '../types';
import { TODAY } from './world';
import carrierRequest from './fixtures/carrier-request.eml?raw';
import clientSendsDocs from './fixtures/client-sends-docs.eml?raw';
import spoofed from './fixtures/spoofed-sender.eml?raw';
import malicious from './fixtures/malicious.eml?raw';
import crossAgency from './fixtures/cross-agency.eml?raw';
import threadReply from './fixtures/thread-reply.eml?raw';
import sharedContact from './fixtures/shared-contact.txt?raw';
import ambiguousName from './fixtures/ambiguous-name.txt?raw';
import twoNames from './fixtures/two-names.txt?raw';
import decline from './fixtures/decline.txt?raw';
import noMatch from './fixtures/no-match.txt?raw';

/** Labelled by hand: what a careful person would say each synthetic email asks. */
export const CORPUS: LabelledEmail[] = [
  { id: 'carrier-request', raw: carrierRequest, source: 'eml', today: TODAY, expected: { intent: 'document_request', documents: { loss_runs: 'requested', 'mvr|jordan pike': 'requested', 'mvr|casey lin': 'requested', ifta: 'requested' }, deadline: '2026-10-23', suspicious: false } },
  { id: 'client-sends-docs', raw: clientSendsDocs, source: 'eml', today: TODAY, expected: { intent: 'documents_sent', documents: { loss_runs: 'provided', ifta: 'mentioned' }, deadline: null, suspicious: false } },
  { id: 'spoofed-sender', raw: spoofed, source: 'eml', today: TODAY, expected: { intent: 'document_request', documents: { loss_runs: 'requested' }, deadline: null, suspicious: true } },
  { id: 'malicious', raw: malicious, source: 'eml', today: TODAY, expected: { intent: 'document_request', documents: { unit_list: 'requested' }, deadline: null, suspicious: true } },
  { id: 'cross-agency', raw: crossAgency, source: 'eml', today: TODAY, expected: { intent: 'document_request', documents: { 'mvr|all': 'requested' }, deadline: null, suspicious: false } },
  { id: 'thread-reply', raw: threadReply, source: 'eml', today: TODAY, expected: { intent: 'other', documents: { loss_runs: 'mentioned', ifta: 'mentioned' }, deadline: null, suspicious: false } },
  // A client asking whether a document is still needed — not a request for it.
  { id: 'shared-contact', raw: sharedContact, source: 'paste', today: TODAY, expected: { intent: 'status_question', documents: { driver_list: 'mentioned' }, deadline: null, suspicious: false } },
  { id: 'ambiguous-name', raw: ambiguousName, source: 'paste', today: TODAY, expected: { intent: 'document_request', documents: { driver_list: 'requested' }, deadline: '2026-10-21', suspicious: false } },
  { id: 'two-names', raw: twoNames, source: 'paste', today: TODAY, expected: { intent: 'document_request', documents: { ifta: 'requested', unit_list: 'requested' }, deadline: null, suspicious: false } },
  { id: 'decline', raw: decline, source: 'paste', today: TODAY, expected: { intent: 'decline', documents: {}, deadline: null, suspicious: false } },
  { id: 'no-match', raw: noMatch, source: 'paste', today: TODAY, expected: { intent: 'document_request', documents: { loss_runs: 'requested', application: 'requested' }, deadline: null, suspicious: false } },
];

describe('rules vs. labelled synthetic emails', () => {
  it('baseline for the fixed rules (the number any later extractor is compared against)', async () => {
    const score = await evaluateExtractor(RULES_EXTRACTOR, CORPUS);
    expect(score.extractor).toBe('rules@1');
    // The one known miss: a client's question ("Do you still need the driver list?") read as a request.
    const misses = score.cases.filter((c) => !c.intentCorrect || c.falsePositives.length || c.falseNegatives.length || c.stanceErrors.length || !c.deadlineCorrect || !c.suspiciousCorrect);
    expect(misses.map((c) => [c.id, c.intentCorrect, c.falsePositives])).toEqual([['shared-contact', false, ['driver_list']]]);
    expect(score.documentRecall).toBe(1);
    expect(score.documentPrecision).toBeCloseTo(12 / 13, 5);
    expect(score.intentAccuracy).toBeCloseTo(10 / 11, 5);
    expect(score.deadlineAccuracy).toBe(1);
    expect(score.suspiciousAccuracy).toBe(1);
  });

  it('any extractor with the same interface can be scored the same way', async () => {
    const nothing: EmailExtractor = {
      id: 'empty',
      version: 'test',
      extract: async () => ({ extractor: { id: 'empty', version: 'test' }, intent: 'other', senderRoleGuess: 'unknown', documents: [], deadlines: [], urgent: false, identifiers: { dotNumbers: [], mcNumbers: [] } }),
    };
    const score = await evaluateExtractor(nothing, CORPUS);
    expect(score.documentRecall).toBe(0);
    expect(score.cases.find((c) => c.id === 'carrier-request')!.falseNegatives).toHaveLength(4);
  });
});
