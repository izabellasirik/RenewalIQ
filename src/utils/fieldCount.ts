const ENTRY_META_KEYS = new Set(['id', 'source', 'isManual', 'lastUpdatedAt', 'fieldConfidence', 'conflicts']);

/** Counts the real, populated data attributes on an itemized-row value (a DriverEntry/VehicleEntry/loss-shaped object) — every key except id/source/isManual/lastUpdatedAt/fieldConfidence/conflicts bookkeeping. */
function countEntryAttributes(entry: unknown): number {
  if (!entry || typeof entry !== 'object') return 1;
  return Object.entries(entry as Record<string, unknown>).filter(([key, value]) => !ENTRY_META_KEYS.has(key) && value !== undefined && value !== null && value !== '').length;
}

/**
 * How many actually-useful data points a batch of extraction results represents — the number the
 * UI should show, not the number of ExtractedFieldResult objects. A scalar result (business.*,
 * transportation.*, coverage.*, coverageLine) is one field, same as before. But a single 'drivers'
 * or 'vehicles' or 'lossHistory' push is ONE ExtractedFieldResult carrying an entire itemized row —
 * e.g. a driver's-license read that populated name/dob/licenseNumber/licenseState/licenseClass/
 * issueDate/expirationDate is 7 real attributes, not 1. Counting it as 1 is what previously made a
 * fully-read license photo report "1 field extracted", which reads as a failure even though most of
 * the card was read correctly. Applied uniformly to vehicles/drivers/losses/scalar fields per the
 * same rule, so the count means the same thing everywhere it's shown.
 */
export function countExtractedFields(results: { fieldPath: string; value: unknown }[]): number {
  let total = 0;
  for (const result of results) {
    if (result.fieldPath === 'drivers' || result.fieldPath === 'vehicles' || result.fieldPath === 'lossHistory') {
      total += countEntryAttributes(result.value);
    } else {
      total += 1;
    }
  }
  return total;
}
