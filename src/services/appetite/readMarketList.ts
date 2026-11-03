import { supabase } from '../supabase/client';
import { directoryRows, maskDirectorySecrets } from './directoryFromDocument';
import type { DirectoryMarket } from '../../../supabase/functions/extract-document-vision/directory';
import { todayKey } from '../workflow/dates';

/**
 * A PDF / Word / text market list → import rows: read to text in the browser, secrets removed, the markets listed
 * by AI (extract-document-vision, mode "market_directory"). Nothing is saved here.
 */
export async function readMarketListDocument(file: File): Promise<{ ok: true; rows: string[][] } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'Cloud sync is not configured in this environment.' };
  if (file.size > 15 * 1024 * 1024) return { ok: false, message: 'That file is over 15 MB.' };
  const { parseFile } = await import('../ingestion/parseFile');
  let text = '';
  try {
    text = (await parseFile(file, { ocr: true })).text ?? '';
  } catch {
    return { ok: false, message: 'Couldn’t read that file. Try a PDF, Word, Excel or CSV file.' };
  }
  const masked = maskDirectorySecrets(text);
  if (masked.replace(/\[removed\]/g, '').trim().length < 20) return { ok: false, message: 'No text was found in that file (a scanned image?). Try the original PDF, Word or Excel file.' };
  const { data, error } = await supabase.functions.invoke('extract-document-vision', { body: { mode: 'market_directory', directoryText: masked } });
  const markets = (data as { markets?: DirectoryMarket[] } | null)?.markets;
  if (error || !Array.isArray(markets) || markets.length === 0) return { ok: false, message: 'Couldn’t list the markets in that file right now. Try again in a moment, or use the Excel template.' };
  return { ok: true, rows: directoryRows(markets, todayKey()) };
}
