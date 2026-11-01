import type { IntakeAnswers } from '../supabase/intakeRepo';

/** The Quick form (Submission Intake): documents plus any pieces of information the client picks. */
export const QUICK_KINDS = ['namedInsured', 'dotNumber', 'vin', 'contact', 'coverage', 'other'] as const;
export type QuickKind = (typeof QUICK_KINDS)[number];
export const QUICK_LABELS: Record<QuickKind, string> = {
  namedInsured: 'Named insured',
  dotNumber: 'DOT number',
  vin: 'VIN number',
  contact: 'Contact',
  coverage: 'Coverage',
  other: 'Other',
};
export interface QuickRow {
  id: string;
  kind: QuickKind | '';
  /** Other: what the information is. */
  label: string;
  value: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const quickRowFilled = (r: QuickRow) => !!r.kind && !!r.value.trim();

/** The answers the agency receives from a Quick form, on top of anything typed in the Full form. */
export function quickAnswers(base: IntakeAnswers, rows: QuickRow[], notes: string): IntakeAnswers {
  const out: IntakeAnswers = { ...base, vinNumbers: base.vinNumbers.filter((v) => v.trim()) };
  const extra: string[] = [];
  for (const r of rows.filter(quickRowFilled)) {
    const v = r.value.trim();
    if (r.kind === 'namedInsured' && !out.namedInsured.trim()) out.namedInsured = v;
    else if (r.kind === 'dotNumber' && !out.dotNumber.trim()) out.dotNumber = v;
    else if (r.kind === 'vin') out.vinNumbers = [...out.vinNumbers, ...v.split(/[\s,;]+/).filter(Boolean)];
    else if (r.kind === 'contact' && EMAIL_RE.test(v) && !out.contactEmail.trim()) out.contactEmail = v;
    else if (r.kind === 'contact' && /^[\d\s()+.-]{7,}$/.test(v) && !out.contactPhone.trim()) out.contactPhone = v;
    else if (r.kind === 'contact' && !out.contactName.trim()) out.contactName = v;
    else extra.push(`${r.kind === 'other' ? r.label.trim() || 'Other' : QUICK_LABELS[r.kind as QuickKind]}: ${v}`);
  }
  out.additionalNotes = [notes.trim(), base.additionalNotes.trim(), ...extra].filter(Boolean).join('\n');
  if (out.vinNumbers.length === 0) out.vinNumbers = [''];
  return out;
}
