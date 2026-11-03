import type { DirectoryMarket } from '../../../supabase/functions/extract-document-vision/directory';
import { MAX_DIRECTORY_TEXT } from '../../../supabase/functions/extract-document-vision/directory';

/**
 * Market Directory → Import of a PDF / Word / text market list (read by AI, then reviewed in the import preview).
 * The file is read to text in the browser; passwords, logins, codes, emails and phone numbers are removed before
 * anything is sent. The AI's list becomes the same rows as the CSV template, so the preview and the database
 * import treat it exactly like a spreadsheet.
 */

export const AI_DIRECTORY_SOURCE = 'Read from the uploaded file by AI';

/** Passwords, logins, codes, emails and phone numbers out of the text before it leaves the browser. */
export function maskDirectorySecrets(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        // "PASS xyz", "Password: xyz", "login abc", "user: abc", "G CODE 123" — the word and what follows it.
        // "PASS xyz", "Password: xyz", "login abc", "G CODE 123 i456" — the word, what follows it, and an ID after that.
        .replace(/\b(pass(word)?|pwd|login|username|credentials?|producer code|agent code|g code)\b\s*[:#-]?\s*\S+(\s+\S*\d\S*)?/gi, '[removed]')
        // Anything with an @ (emails, also ones the PDF layout cut in two).
        .replace(/\S*@\S*/g, '[removed]')
        // Password-looking words: letters, digits and a symbol together (e.g. "Abc10$").
        .replace(/(?<!\S)(?=\S*[A-Za-z])(?=\S*\d)\S*[#$!%^&*]\S*/g, '[removed]')
        .replace(/\(?(?<!\d)\d{3}\)?[\s.-]{0,4}\d{3}[\s.-]{0,4}\d{4}(?!\d)(\s*(ext\.?|x)\s*\d+)?/gi, '[removed]')
        // A 7-digit local number left on its own (its area code on another line).
        .replace(/(?<!\d)\d{3}-\d{4}(?!\d)/g, '[removed]')
    )
    .join('\n')
    .replace(/[ \t]{3,}/g, '  ')
    .slice(0, MAX_DIRECTORY_TEXT);
}

const HEADER = ['record_type', 'market_ref', 'market', 'market_type', 'access_route', 'access_status', 'wholesaler', 'source', 'source_date', 'notes', 'portal_url', 'rule_ref', 'category', 'operator', 'value', 'answer', 'strength'];

/** The AI's markets as import rows (header first), with soft rules for the stated minimums and fleet limits. */
export function directoryRows(markets: DirectoryMarket[], today: string): string[][] {
  const rows: string[][] = [HEADER];
  const used = new Set<string>();
  markets.forEach((m, i) => {
    let ref = m.name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 20) || `M${i + 1}`;
    while (used.has(ref)) ref = `${ref.slice(0, 18)}${i + 1}`;
    used.add(ref);
    const notes = [m.coverages ? `Coverages: ${m.coverages}.` : '', m.notes].filter(Boolean).join(' ');
    const via = m.available_through.join(' | ');
    rows.push(['market', ref, m.name, m.market_type, via ? 'indirect' : 'direct', 'ready', via, AI_DIRECTORY_SOURCE, today, notes, m.website ?? '', '', '', '', '', '', '']);
    let k = 0;
    const rule = (category: string, operator: string, value: number) => rows.push(['rule', ref, '', '', '', '', '', AI_DIRECTORY_SOURCE, today, '', '', `R${++k}`, category, operator, String(value), 'no', 'soft']);
    if (m.min_cdl_years) rule('driver_experience', 'lt', m.min_cdl_years);
    if (m.min_years_in_business) rule('years_in_business', 'lt', m.min_years_in_business);
    if (m.min_units && m.min_units > 1) rule('fleet_size', 'lt', m.min_units);
    if (m.max_units) rule('fleet_size', 'gt', m.max_units);
  });
  return rows;
}
