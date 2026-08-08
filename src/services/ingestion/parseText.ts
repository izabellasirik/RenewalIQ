import type { RawDocument } from './types';

/** Reads a plain-text file (e.g. a client email pasted/exported as .txt). */
export async function parseText(file: File): Promise<RawDocument> {
  const warnings: string[] = [];
  const text = await file.text();
  if (text.trim().length === 0) {
    warnings.push('This file appears to be empty.');
  }
  return { documentName: file.name, fileType: 'txt', text, warnings };
}
