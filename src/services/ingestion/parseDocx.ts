import mammoth from 'mammoth';
import type { RawDocument, RawTable } from './types';

/** Extracts paragraphs and tables from a DOCX file. */
export async function parseDocx(file: File): Promise<RawDocument> {
  const warnings: string[] = [];
  const arrayBuffer = await file.arrayBuffer();

  let html: string;
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer });
    html = result.value;
  } catch (err) {
    warnings.push(`Could not read this DOCX file: ${err instanceof Error ? err.message : 'unknown error'}.`);
    return { documentName: file.name, fileType: 'docx', text: '', tables: [], warnings };
  }

  const dom = new DOMParser().parseFromString(html, 'text/html');
  const paragraphs: string[] = [];
  dom.body.querySelectorAll('p, h1, h2, h3, h4, li').forEach((el) => {
    const t = el.textContent?.trim();
    if (t) paragraphs.push(t);
  });

  const tables: RawTable[] = [];
  dom.body.querySelectorAll('table').forEach((tableEl, tIdx) => {
    const rows = Array.from(tableEl.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td, th')).map((cell) => cell.textContent?.trim() ?? '')
    );
    const [headers, ...dataRows] = rows;
    if (!headers) return;
    tables.push({ sheetName: `Table ${tIdx + 1}`, headers, rows: dataRows });
  });

  const text = paragraphs.join('\n');
  if (text.trim().length === 0 && tables.length === 0) {
    warnings.push('No extractable text found in this document.');
  }

  return { documentName: file.name, fileType: 'docx', text, tables, warnings };
}
