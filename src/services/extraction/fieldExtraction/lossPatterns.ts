import type { LossStatus } from '../../../types';
import type { TextLine } from './textLines';
import { parseCount } from './money';

/** Matches a loss-run row rendered as text: "MM/DD/YYYY  Claim Type  Open|Closed  $Paid  $Reserve  $Incurred". */
const LOSS_ROW_REGEX = /(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))\s+([A-Za-z][A-Za-z /]*?)\s+(Open|Closed)\s+\$?([\d,]+)\s+\$?([\d,]+)\s+\$?([\d,]+)/i;

function normalizeDate(raw: string): string | null {
  const parts = raw.split('/');
  if (parts.length !== 3) return null;
  const [mStr, dStr, yStr] = parts;
  const month = Number(mStr);
  const day = Number(dStr);
  let year = Number(yStr);
  if (yStr.length === 2) year += year < 50 ? 2000 : 1900;
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface LossRowMatch {
  lossDate: string;
  claimType: string;
  status: LossStatus;
  paid: number;
  reserved: number;
  incurred: number;
  matchedText: string;
  page?: number;
}

/** Scans lines for loss-run table rows rendered as text (PDF/CSV/plain text loss runs). */
export function extractLossRows(lines: TextLine[]): LossRowMatch[] {
  const results: LossRowMatch[] = [];
  for (const line of lines) {
    const m = line.text.match(LOSS_ROW_REGEX);
    if (!m) continue;
    const [, dateStr, claimType, status, paidStr, reservedStr, incurredStr] = m;
    const lossDate = normalizeDate(dateStr);
    const paid = parseCount(paidStr);
    const reserved = parseCount(reservedStr);
    const incurred = parseCount(incurredStr);
    if (lossDate === null || paid === null || reserved === null || incurred === null) continue;
    results.push({
      lossDate,
      claimType: claimType.trim(),
      status: status.toLowerCase() as LossStatus,
      paid,
      reserved,
      incurred,
      matchedText: line.text,
      page: line.page,
    });
  }
  return results;
}

const BLOCK_START_PATTERNS = [/(?:loss date|date of loss)\s*:/i, /^\s*(?:claim|loss)\s*#?\s*\d+\b/i];
const BLOCK_DATE_PATTERNS = [/(?:loss date|date of loss)\s*:\s*(.+)/i, /^date\s*:\s*(.+)/i];
const BLOCK_CLAIM_TYPE_PATTERNS = [/claim type\s*:\s*(.+)/i, /type of loss\s*:\s*(.+)/i, /^type\s*:\s*(.+)/i, /cause\s*:\s*(.+)/i, /peril\s*:\s*(.+)/i];
const BLOCK_PAID_PATTERNS = [/(?:amount )?paid(?: amount)?\s*:\s*\$?([\d,]+)/i];
const BLOCK_RESERVED_PATTERNS = [/reserved?(?: amount)?\s*:\s*\$?([\d,]+)/i];
const BLOCK_INCURRED_PATTERNS = [/(?:total )?incurred\s*:\s*\$?([\d,]+)/i];
const BLOCK_STATUS_PATTERNS = [/(?:claim )?status\s*:\s*(open|closed)/i];

function matchInBlock(blockLines: TextLine[], patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    for (const line of blockLines) {
      const m = line.text.match(pattern);
      if (m && m[1]) return m[1].trim();
    }
  }
  return null;
}

/**
 * Scans for loss runs rendered as repeated labeled claim blocks (one claim per "Claim N" heading
 * or per repeated "Loss Date:" label, with Claim Type/Paid/Reserved/Status on their own lines) —
 * a very common loss-run layout, distinct from the single-line-per-row tabular style extractLossRows
 * handles. Both run over every document; whichever shape matches contributes rows, and the
 * itemized-row dedup in extractionService.ts protects against double-counting if a document
 * happens to satisfy both.
 */
export function extractLossBlocks(lines: TextLine[]): LossRowMatch[] {
  const blocks: TextLine[][] = [];
  let current: TextLine[] = [];

  for (const line of lines) {
    if (!line.text.trim()) continue;
    if (BLOCK_START_PATTERNS.some((p) => p.test(line.text)) && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);

  const results: LossRowMatch[] = [];
  for (const block of blocks) {
    const dateRaw = matchInBlock(block, BLOCK_DATE_PATTERNS);
    if (!dateRaw) continue;
    const lossDate = normalizeDate(dateRaw);
    if (!lossDate) continue;

    const paidRaw = matchInBlock(block, BLOCK_PAID_PATTERNS);
    const reservedRaw = matchInBlock(block, BLOCK_RESERVED_PATTERNS);
    const incurredRaw = matchInBlock(block, BLOCK_INCURRED_PATTERNS);

    const paid = paidRaw !== null ? parseCount(paidRaw) : null;
    const reserved = reservedRaw !== null ? (parseCount(reservedRaw) ?? 0) : 0;
    let incurred = incurredRaw !== null ? parseCount(incurredRaw) : null;

    if (paid === null && incurred === null) continue; // no claim amount anywhere in this block — not confident it's a real claim

    if (incurred === null) incurred = (paid ?? 0) + reserved;

    const claimType = matchInBlock(block, BLOCK_CLAIM_TYPE_PATTERNS) ?? 'Unspecified';
    const statusRaw = matchInBlock(block, BLOCK_STATUS_PATTERNS);
    const status: LossStatus = statusRaw?.toLowerCase() === 'open' ? 'open' : 'closed';

    results.push({
      lossDate,
      claimType,
      status,
      paid: paid ?? 0,
      reserved,
      incurred,
      matchedText: block.map((l) => l.text).join(' · '),
      page: block[0]?.page,
    });
  }

  return results;
}
