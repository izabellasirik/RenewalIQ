import type { LossStatus } from '../../../types';
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
export function extractLossRows(lines: { text: string; page?: number }[]): LossRowMatch[] {
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
