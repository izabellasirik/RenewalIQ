import type { LayoutLine } from '../ingestion/pdfLayout';
import { normalizeDateKey } from '../workflow/dates';

/**
 * QQCatalyst reports (PDF) an admin uploads under Analytics → Endorsement reports: the Endorsements
 * report (amount, effective date, description, business, agent) and the Cancelled policies report
 * (effective, named insured, expiration, status, cancellation date). Read from the PDF's own text —
 * columns by position under the header, a new row wherever the first column has a value — so no AI
 * is needed and nothing is guessed.
 */

export type QqReportKind = 'endorsements' | 'cancellations';

export interface EndorsementRow {
  amountCents: number;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  client: string;
  agent: string;
}

export interface CancellationRow {
  /** YYYY-MM-DD */
  effectiveDate: string;
  insured: string;
  expirationDate: string | null;
  status: string;
  cancellationDate: string;
}

export type ParsedQqReport =
  | { kind: 'endorsements'; title: string; period: string; rows: EndorsementRow[]; recordsStated: number | null }
  | { kind: 'cancellations'; title: string; period: string; rows: CancellationRow[]; recordsStated: number | null };

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const MONEY = /^\(?-?\$?-?[\d,]+\.\d{2}\)?$/;
const DATE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const FOOTER = /\bPage\s*\d+\s*of\s*\d+\b/i;
const TOTAL = /^GRAND TOTAL:?\s*\((\d+)\s+records?\)/i;
const HEADER_WORDS = /^(endorsement|amount|effective|date|description|business|name|agent|on|customer|named|insured|expiration|policy|status|cancellation|number|carrier|premium)$/i;

/** "-$5,402.00" / "($5,402.00)" → -540200. */
export function moneyCents(text: string): number | null {
  const t = text.replace(/\s/g, '');
  if (!MONEY.test(t)) return null;
  const negative = t.includes('-') || t.startsWith('(');
  const cents = Math.round(Number(t.replace(/[^\d.]/g, '')) * 100);
  return Number.isFinite(cents) ? (negative ? -cents : cents) : null;
}

const isHeaderLine = (line: LayoutLine) => line.cells.length >= 2 && line.cells.every((c) => clean(c.text).split(' ').every((w) => HEADER_WORDS.test(w)));

interface Column {
  x0: number;
  label: string;
}

/** The report's columns from its header (one or two lines of labels; the second line continues the first's labels). */
function headerColumns(lines: LayoutLine[], at: number): { columns: Column[]; used: number } | null {
  const first = lines[at];
  if (!first || !isHeaderLine(first)) return null;
  const columns: Column[] = first.cells.map((c) => ({ x0: c.x0, label: clean(c.text) }));
  let used = 1;
  const second = lines[at + 1];
  if (second && second.page === first.page && isHeaderLine(second)) {
    for (const c of second.cells) {
      const col = columnFor(columns, c.x0, c.x1);
      if (col >= 0) columns[col] = { x0: Math.min(columns[col].x0, c.x0), label: clean(`${columns[col].label} ${c.text}`) };
    }
    used = 2;
  }
  return columns.length >= 3 ? { columns, used } : null;
}

/** The column a cell sits in: the one whose header overlaps it most (else the last one starting left of it). */
function columnFor(columns: Column[], x0: number, x1: number): number {
  let best = -1;
  let bestOverlap = 0;
  columns.forEach((c, i) => {
    const end = i + 1 < columns.length ? columns[i + 1].x0 : Infinity;
    const overlap = Math.min(x1, end) - Math.max(x0, c.x0);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = i;
    }
  });
  if (best >= 0) return best;
  for (let i = columns.length - 1; i >= 0; i--) if (columns[i].x0 <= x0 + 2) return i;
  return -1;
}

function kindOf(labels: string[]): QqReportKind | null {
  const l = labels.map((x) => x.toLowerCase());
  if (l.some((x) => x.includes('endorsement amount'))) return 'endorsements';
  if (l.some((x) => x.includes('cancellation'))) return 'cancellations';
  return null;
}

/** Reads a QQCatalyst Endorsements or Cancelled policies report from a PDF's layout; null when it isn't one. */
export function parseQqReport(lines: LayoutLine[]): ParsedQqReport | null {
  let columns: Column[] | null = null;
  let headerPage = -1;
  const top: string[] = [];
  const records: string[][][] = []; // rows → columns → text lines
  let recordsStated: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = clean(line.cells.map((c) => c.text).join(' '));
    if (!text || FOOTER.test(text)) continue;
    const total = text.match(TOTAL);
    if (total) {
      recordsStated = Number(total[1]);
      continue;
    }
    const header = headerColumns(lines, i);
    if (header) {
      if (!columns) columns = header.columns;
      headerPage = line.page;
      i += header.used - 1;
      continue;
    }
    if (!columns || headerPage !== line.page) {
      // Above the first header: the title and the filter ("Endorsement Effective Date Is Between …").
      if (!columns) top.push(text);
      continue;
    }
    const cells: string[][] = columns.map(() => []);
    for (const c of line.cells) {
      const col = columnFor(columns, c.x0, c.x1);
      if (col >= 0) cells[col].push(clean(c.text));
    }
    const lead = cells[0].join(' ');
    if (lead && (MONEY.test(lead.replace(/\s/g, '')) || DATE.test(lead))) records.push(cells.map((c) => (c.length ? [c.join(' ')] : [])));
    else if (records.length) cells.forEach((c, col) => c.length && records[records.length - 1][col].push(c.join(' ')));
  }
  if (!columns) return null;
  const kind = kindOf(columns.map((c) => c.label));
  if (!kind) return null;

  const idx = (re: RegExp) => columns!.findIndex((c) => re.test(c.label));
  const title = top[0] ?? (kind === 'endorsements' ? 'Endorsements' : 'Cancelled');
  const period = top.slice(1).join(' ');
  const joinName = (parts: string[] | undefined) => clean((parts ?? []).join(' '));
  const joinText = (parts: string[] | undefined) => (parts ?? []).map(clean).join('\n').trim();

  if (kind === 'endorsements') {
    const a = idx(/amount/i), d = idx(/effective/i), desc = idx(/description/i), biz = idx(/business|named|insured|client/i), ag = idx(/agent/i);
    const rows: EndorsementRow[] = [];
    for (const r of records) {
      const amountCents = moneyCents(joinName(r[a]));
      const date = normalizeDateKey(joinName(r[d]));
      if (amountCents === null || !date) continue;
      rows.push({ amountCents, date, description: joinText(r[desc]), client: joinName(r[biz]), agent: joinName(r[ag]) });
    }
    return { kind, title, period, rows, recordsStated };
  }
  const eff = idx(/effective/i), ins = idx(/insured|name/i), exp = idx(/expiration/i), st = idx(/status/i), cx = idx(/cancellation/i);
  const rows: CancellationRow[] = [];
  for (const r of records) {
    const effectiveDate = normalizeDateKey(joinName(r[eff]));
    const cancellationDate = normalizeDateKey(joinName(r[cx]));
    if (!effectiveDate || !cancellationDate) continue;
    rows.push({ effectiveDate, insured: joinName(r[ins]), expirationDate: normalizeDateKey(joinName(r[exp])) ?? null, status: joinName(r[st]) || 'Cancelled', cancellationDate });
  }
  return { kind, title, period, rows, recordsStated };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const ENDORSEMENT_TYPES = ['Add unit', 'Remove unit', 'Add driver', 'Remove driver', 'Loss payee / additional insured', 'Address change', 'Coverage / limits', 'Other'] as const;
export type EndorsementType = (typeof ENDORSEMENT_TYPES)[number];

/** A VIN (letters and digits, 11–17 long — part of one, as reports wrap them) or the word VIN; a long name isn't one. */
const VIN = /\b(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{11,17}\b|\bvin\b/i;
const DRIVER = /\bcdl\b|\bdl\b|\bdl#|\bdriver\b|\bdob\b|\blicen[cs]e\b|\blic#/i;
const UNIT_WORDS = /\bunit\b|\btruck|\btractor|\btrailer|freightliner|\bfrht\b|kenworth|volvo|peterbilt|international|\bmack\b|western star|hyundai|utility|great dane|wabash/;
const STATE_ZIP = /,?\s[A-Z]{2}\s+\d{5}(-\d{4})?\b/;
/** The kind of change, from the endorsement's description (the first action it names). */
export function endorsementType(description: string, amountCents: number): EndorsementType {
  const d = description.toLowerCase();
  if (/loss\s*payee|additional\s+insured|\bai\b|lienholder|certificate holder|isaoa/.test(d)) return 'Loss payee / additional insured';
  if (/address|garag\w* location|mailing/.test(d) || (STATE_ZIP.test(description) && !VIN.test(description))) return 'Address change';
  const unit = VIN.test(description) || UNIT_WORDS.test(d.replace(/trailer interchange/g, ''));
  const driver = DRIVER.test(description);
  if (/\blimit|deductible|coverage|liability|\bcargo\b|interchange|reefer|physical damage/.test(d) && !unit && !driver) return 'Coverage / limits';
  const add = d.search(/\badd(ed|ing)?\b|\binclud\w*/);
  const remove = d.search(/\b(remov\w*|delet\w*|drop\w*|exclud\w*)\b/);
  // The first action named wins ("Add Unit: … Remove Unit: …" is mainly an addition); none named → the sign.
  const removing = remove >= 0 && (add < 0 || remove < add) ? true : add >= 0 ? false : amountCents < 0;
  // Both a unit and a driver: whichever is named first is the change.
  const firstAt = (...at: number[]) => Math.min(...at.filter((i) => i >= 0), Infinity);
  if (unit && (!driver || firstAt(description.search(VIN), d.search(UNIT_WORDS)) < firstAt(description.search(DRIVER)))) return removing ? 'Remove unit' : 'Add unit';
  if (driver) return removing ? 'Remove driver' : 'Add driver';
  if (unit) return removing ? 'Remove unit' : 'Add unit';
  // A person's name and nothing else (e.g. "JORDAN AVERY") is a driver change.
  if (/^[a-z]+(\s+[a-z]+){1,3}$/i.test(description.replace(/\n/g, ' ').trim())) return removing ? 'Remove driver' : 'Add driver';
  return 'Other';
}

export interface EndorsementTotals {
  count: number;
  addedCents: number;
  returnedCents: number;
  netCents: number;
  noChargeCount: number;
}
const emptyTotals = (): EndorsementTotals => ({ count: 0, addedCents: 0, returnedCents: 0, netCents: 0, noChargeCount: 0 });
function addTo(t: EndorsementTotals, cents: number) {
  t.count += 1;
  if (cents > 0) t.addedCents += cents;
  else if (cents < 0) t.returnedCents += cents;
  else t.noChargeCount += 1;
  t.netCents += cents;
}

export function endorsementTotals(rows: EndorsementRow[]): EndorsementTotals {
  const t = emptyTotals();
  for (const r of rows) addTo(t, r.amountCents);
  return t;
}

/** Totals per key (agent, client, type, month), largest net first. */
export function endorsementsBy(rows: EndorsementRow[], key: (r: EndorsementRow) => string): { key: string; totals: EndorsementTotals }[] {
  const map = new Map<string, EndorsementTotals>();
  for (const r of rows) {
    const k = key(r) || '—';
    if (!map.has(k)) map.set(k, emptyTotals());
    addTo(map.get(k)!, r.amountCents);
  }
  return [...map.entries()].map(([k, totals]) => ({ key: k, totals })).sort((a, b) => b.totals.count - a.totals.count || b.totals.netCents - a.totals.netCents);
}

/** Agent names as printed vary in case ("AKIF AKHMEDOV", "Denis Pak"): shown in title case. */
export const displayName = (name: string) => clean(name).toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

/** Days a cancelled policy was in force (cancellation − effective). */
export const daysInForce = (r: CancellationRow) => Math.round((Date.parse(r.cancellationDate) - Date.parse(r.effectiveDate)) / 86_400_000);

/** The same endorsement in two uploaded reports (overlapping dates) counts once. */
export const endorsementKey = (r: EndorsementRow) => [r.date, r.amountCents, r.client.toLowerCase(), r.agent.toLowerCase(), r.description.toLowerCase().replace(/\s+/g, ' ')].join('|');
export const cancellationKey = (r: CancellationRow) => [r.effectiveDate, r.cancellationDate, r.insured.toLowerCase()].join('|');

/**
 * Rows from several uploaded reports. The same row in two reports with overlapping dates counts once;
 * identical rows within one report (two equal charges) all count: per row, the most any one report has.
 */
export function mergeReportRows<T>(reports: T[][], key: (r: T) => string): T[] {
  const most = new Map<string, T[]>();
  for (const rows of reports) {
    const here = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      if (!here.has(k)) here.set(k, []);
      here.get(k)!.push(r);
    }
    for (const [k, list] of here) if ((most.get(k)?.length ?? 0) < list.length) most.set(k, list);
  }
  return [...most.values()].flat();
}

// ---------------------------------------------------------------------------
// Commission on endorsements (as in the agency's monthly producer statements)
// ---------------------------------------------------------------------------

/** The agency's commission on an endorsement unless an admin sets another rate for it. */
export const DEFAULT_AGENCY_RATE = 0.1;

/** Each row's key for its rate: the row itself, numbered when the same row appears more than once. */
export function withRowKeys<T extends EndorsementRow>(rows: T[]): (T & { rowKey: string })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = endorsementKey(r);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { ...r, rowKey: n === 1 ? k : `${k}#${n}` };
  });
}

/** premium × rate, rounded to cents (each line rounded, as the statements do). */
export const commissionCents = (cents: number, rate: number) => Math.round(cents * rate);
