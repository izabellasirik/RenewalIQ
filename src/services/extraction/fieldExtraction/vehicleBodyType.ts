/**
 * Normalizes a vehicle body-type/unit-type column value into a small canonical category set.
 * Never invoked on make/model — only on an explicit type-ish column — so a vehicle schedule with
 * no such column simply has no body type, rather than one guessed from the manufacturer name.
 */
const BODY_TYPE_RULES: { match: RegExp; category: string }[] = [
  { match: /tractor|power\s*unit|day\s*cab|sleeper|semi(?:\s*truck)?/i, category: 'Tractor / Power Unit' },
  { match: /straight\s*truck|box\s*truck|bobtail/i, category: 'Straight Truck' },
  { match: /trailer|reefer|flatbed|dry\s*van\s*trailer|lowboy/i, category: 'Trailer' },
  { match: /pickup|pick-up/i, category: 'Pickup' },
  { match: /\bvan\b/i, category: 'Van' },
];

export function normalizeVehicleBodyType(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const rule = BODY_TYPE_RULES.find((r) => r.match.test(trimmed));
  return rule ? rule.category : null;
}
