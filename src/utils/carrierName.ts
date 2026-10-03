/**
 * A carrier name as read off a report header, without the page footer or separators that sometimes
 * come with it ("Cover Whale Insurance Solutions, Inc. | Page 1 of 1" → "Cover Whale Insurance
 * Solutions, Inc.").
 */
export function cleanCarrierName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\s*(?:[|·•]\s*)?\bpage\s+\d+(?:\s*(?:of|\/)\s*\d+)?\b/gi, '')
    .replace(/[\s|·•,\-–—]+$/, '')
    .replace(/^[\s|·•\-–—]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
