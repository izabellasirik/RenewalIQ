/**
 * False for text that isn't really text: a barcode, a rule line or a smudge read by OCR ("|||||",
 * "{=a", "IIIII", "—"). Such a cell or value is treated as empty — it's never put into the account
 * as a vehicle's make, an address, a name, ...
 */
export function isReadableText(raw: string): boolean {
  const t = raw.replace(/\s+/g, '');
  if (!t) return false;
  const alnum = (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alnum === 0 || alnum / t.length < 0.5) return false;
  // Bars and strokes OCR makes of a barcode or a ruled line.
  if (t.length >= 3 && /^[|Il1!/\\[\]()]+$/.test(t) && !/^\d+$/.test(t)) return false;
  // One character repeated ("xxxxx", "-----").
  if (t.length >= 4 && /^(.)\1+$/.test(t) && !/^\d+$/.test(t)) return false;
  return true;
}
