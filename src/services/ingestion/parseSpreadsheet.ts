import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { RawDocument, RawTable } from './types';

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
    if ('result' in value) return String(value.result ?? '');
  }
  return String(value);
}

/**
 * Some spreadsheet generators emit every OOXML element under a single namespace prefix (e.g.
 * `<x:workbook>`, `<x:sheetData>`) instead of the unprefixed convention every major writer (Excel,
 * Google Sheets, LibreOffice) uses. exceljs's parser matches element tag names literally
 * ('workbook', not 'x:workbook'), so a prefixed file silently parses to zero sheets and load()
 * throws. This repairs the zip by stripping element-name namespace prefixes — never touching
 * attributes, so relationship ids like `r:id` are preserved — and returns a buffer worth retrying.
 * `xl/theme/*.xml` is skipped: exceljs stores that part raw rather than parsing it, and its `a:`
 * prefix is the standard drawingml convention, not the bug this works around.
 */
async function repairPrefixedWorkbookXml(buffer: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    let changed = false;
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !name.endsWith('.xml') || name.startsWith('xl/theme/')) continue;
      const content = await entry.async('string');
      const stripped = content.replace(/<(\/?)[a-zA-Z_][\w.-]*:/g, '<$1');
      if (stripped !== content) {
        zip.file(name, stripped);
        changed = true;
      }
    }
    if (!changed) return null;
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch {
    return null;
  }
}

const decodeXml = (v: string) =>
  v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`))?.[1];
const textOf = (xml: string) => decodeXml(Array.from(xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (m) => m[1]).join(''));
/** "AB12" → 27 (0-based column). */
function columnIndex(ref: string | undefined): number | null {
  const letters = ref?.match(/^[A-Z]+/i)?.[0];
  if (!letters) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * A plain reader for workbooks exceljs can't open (files saved by other tools): follows the
 * workbook's own relationships to each sheet and reads cell values as text. Null when it isn't a
 * workbook at all.
 */
export async function readWorkbookPlain(buffer: ArrayBuffer): Promise<{ name: string; rows: string[][] }[] | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  const files = new Map<string, JSZip.JSZipObject>();
  for (const [name, entry] of Object.entries(zip.files)) if (!entry.dir) files.set(name.replace(/\\/g, '/').replace(/^\//, '').toLowerCase(), entry);
  const read = async (path: string) => {
    const e = files.get(path.toLowerCase());
    return e ? (await e.async('string')).replace(/<(\/?)[a-zA-Z_][\w.-]*:/g, '<$1') : null;
  };
  const rootRels = (await read('_rels/.rels')) ?? '';
  const officeTarget = Array.from(rootRels.matchAll(/<Relationship\b[^>]*>/g), (m) => m[0]).find((t) => /officeDocument/i.test(attr(t, 'Type') ?? ''));
  const workbookPath = officeTarget ? resolvePath('', attr(officeTarget, 'Target') ?? '') : ([...files.keys()].find((k) => /(^|\/)workbook\.xml$/.test(k)) ?? 'xl/workbook.xml');
  const workbook = await read(workbookPath);
  if (!workbook) return null;
  const relsPath = workbookPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = new Map<string, string>();
  let sharedTarget: string | undefined;
  for (const m of ((await read(relsPath)) ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) rels.set(id, resolvePath(workbookPath, target));
    if (target && /sharedStrings/i.test(attr(m[0], 'Type') ?? target)) sharedTarget = resolvePath(workbookPath, target);
  }
  const sharedPath = sharedTarget ?? resolvePath(workbookPath, 'sharedStrings.xml');
  const shared = Array.from(((await read(sharedPath)) ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), (m) => textOf(m[1]));

  const sheets: { name: string; rows: string[][] }[] = [];
  const sheetTags = Array.from(workbook.matchAll(/<sheet\b[^>]*>/g), (m) => m[0]);
  for (const [i, tag] of sheetTags.entries()) {
    const id = attr(tag, 'id') ?? attr(tag, 'r:id');
    const path = (id && rels.get(id)) ?? resolvePath(workbookPath, `worksheets/sheet${i + 1}.xml`);
    const xml = await read(path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = ` ${c[1]}`;
        const col = columnIndex(attr(at, 'r')) ?? row.length;
        const type = attr(at, 't');
        const body = c[2] ?? '';
        const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
        const value = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? textOf(body) : decodeXml(v ?? '');
        while (row.length < col) row.push('');
        row[col] = value;
      }
      if (row.some((x) => x.trim())) rows.push(row);
    }
    sheets.push({ name: decodeXml(attr(tag, 'name') ?? `Sheet${i + 1}`), rows });
  }
  return sheets;
}

/** Reads every sheet of an XLSX/XLS workbook, preserving headers (first non-empty row) and data rows. */
export async function parseSpreadsheet(file: File): Promise<RawDocument> {
  const warnings: string[] = [];
  const arrayBuffer = await file.arrayBuffer();

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(arrayBuffer);
  } catch (err) {
    const repaired = await repairPrefixedWorkbookXml(arrayBuffer);
    try {
      if (!repaired) throw err;
      await workbook.xlsx.load(repaired);
    } catch {
      const plain = await readWorkbookPlain(arrayBuffer);
      if (!plain) {
        warnings.push(`Could not read this spreadsheet: ${err instanceof Error ? err.message : 'unknown error'}.`);
        return { documentName: file.name, fileType: 'xlsx', text: '', tables: [], warnings };
      }
      return toDocument(file.name, plain.map((sh) => ({ sheetName: sh.name, rows: sh.rows })), warnings);
    }
  }

  const sheets: { sheetName: string; rows: string[][] }[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      // row.values is sparse — empty cells are holes (Google Sheets exports skip them), and .map()
      // keeps holes, so every cell is visited with Array.from to make each one a string.
      const values = (row.values as ExcelJS.CellValue[]).slice(1);
      rows.push(Array.from(values, cellToString));
    });
    sheets.push({ sheetName: sheet.name, rows });
  });
  // Opened but empty: some tools store the workbook where exceljs doesn't look — read it plainly.
  if (!sheets.some((sh) => sh.rows.length)) {
    const plain = await readWorkbookPlain(arrayBuffer);
    if (plain?.some((sh) => sh.rows.length)) return toDocument(file.name, plain.map((sh) => ({ sheetName: sh.name, rows: sh.rows })), warnings);
  }
  return toDocument(file.name, sheets, warnings);
}

function toDocument(documentName: string, sheets: { sheetName: string; rows: string[][] }[], warnings: string[]): RawDocument {
  const tables: RawTable[] = [];
  for (const { sheetName, rows } of sheets) {
    const [headers, ...dataRows] = rows;
    if (!headers || headers.every((h) => h === '')) continue;
    tables.push({ sheetName, headers, rows: dataRows });
  }

  if (tables.length === 0) {
    warnings.push('No data found in this spreadsheet.');
  }

  const text = tables.map((t) => `${t.sheetName}\n${t.headers.join(', ')}\n${t.rows.map((r) => r.join(', ')).join('\n')}`).join('\n\n');

  return { documentName, fileType: 'xlsx', text, tables, warnings };
}
