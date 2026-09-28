import { requirementKey } from '../workflow/requirementKey';
import { normalizePersonName, REQUIREMENT_KIND_LABELS, type DocumentSignals, type RequirementKind } from './documentSignals';

/**
 * Does a client's upload satisfy the item they uploaded it for? The client chose the item, so the
 * question is only whether the document CONFIRMS it — the right kind of document, for the right
 * driver, for the right quarter. Anything that can't be confirmed goes to the broker as "Needs
 * review" with the reason; nothing is marked received on a guess.
 */

export interface RequestedRequirement {
  requestItemId: string;
  label: string;
  templateKey?: string;
}

export type MatchDecision = { outcome: 'satisfied' } | { outcome: 'needs_review'; note: string; suggestedRequestItemId?: string };

interface RequirementShape {
  kind?: RequirementKind;
  /** The driver it's for, lower-case "first last" — absent when not per-driver or "all drivers". */
  entity?: string;
  quarter?: string;
}

const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function requirementShape(r: Pick<RequestedRequirement, 'label' | 'templateKey'>): RequirementShape {
  const key = requirementKey({ label: r.label, templateKey: r.templateKey });
  const [base, entity] = key.split('|');
  const quarterMatch = r.label.match(/\bQ\s?([1-4])\b|\b([1-4])(?:st|nd|rd|th)\s+(?:qtr|quarter)\b/i);
  const quarter = quarterMatch ? `Q${quarterMatch[1] ?? quarterMatch[2]}` : undefined;
  if (base === 'mvr') return { kind: 'mvr', entity: entity && entity !== 'all' ? normalizePersonName(entity) : undefined };
  if (base === 'ifta') return { kind: 'ifta', quarter };
  if (base === 'loss_runs' || base === 'application' || base === 'unit_list' || base === 'driver_list') return { kind: base };
  const license = r.label.match(/^(?:current\s+|updated\s+|copy\s+of\s+)?(?:driver'?s?\s+licen[cs]e|cdl|dl)\b\s*(?:[—–:-]\s*(.+))?$/i);
  if (license) return { kind: 'driver_license', entity: license[1] ? normalizePersonName(license[1]) : undefined };
  if (/\bregistration\b/i.test(r.label)) return { kind: 'vehicle_registration' };
  return {};
}

function sameDriver(entity: string, name: string): boolean {
  const e = entity.split(' ');
  const n = name.split(' ');
  if (e.length < 2 || n.length < 2) return e.join(' ') === n.join(' ');
  // Same last name and the same first name or first initial.
  return e[e.length - 1] === n[n.length - 1] && (e[0] === n[0] || e[0][0] === n[0][0]);
}

export function matchRequestUpload(input: { signals: DocumentSignals | undefined; slot: RequestedRequirement; others: RequestedRequirement[] }): MatchDecision {
  const { signals, slot, others } = input;
  const want = requirementShape(slot);
  if (!want.kind) return { outcome: 'needs_review', note: `Check this is the ${slot.label} — this kind of document can't be recognized automatically.` };
  if (!signals || signals.kinds.length === 0) return { outcome: 'needs_review', note: `Couldn't tell what this document is — check it's the ${slot.label}.` };

  if (!signals.kinds.includes(want.kind)) {
    const other = others.find((o) => o.requestItemId !== slot.requestItemId && requirementShape(o).kind && signals.kinds.includes(requirementShape(o).kind!));
    const looks = REQUIREMENT_KIND_LABELS[signals.kinds[0]];
    return other
      ? { outcome: 'needs_review', note: `Uploaded for ${slot.label}, but it looks like ${looks} — was it meant for ${other.label}?`, suggestedRequestItemId: other.requestItemId }
      : { outcome: 'needs_review', note: `Uploaded for ${slot.label}, but it looks like ${looks}.` };
  }

  if (want.entity) {
    if (signals.names.length === 0) return { outcome: 'needs_review', note: `It's ${REQUIREMENT_KIND_LABELS[want.kind]}, but the driver's name couldn't be read — check it's for ${title(want.entity)}.` };
    if (!signals.names.some((n) => sameDriver(want.entity!, n))) {
      const other = others.find((o) => o.requestItemId !== slot.requestItemId && requirementShape(o).kind === want.kind && signals.names.some((n) => requirementShape(o).entity && sameDriver(requirementShape(o).entity!, n)));
      return {
        outcome: 'needs_review',
        note: `It's ${REQUIREMENT_KIND_LABELS[want.kind]} for ${title(signals.names[0])}, not ${title(want.entity)}.${other ? ` Was it meant for ${other.label}?` : ''}`,
        ...(other ? { suggestedRequestItemId: other.requestItemId } : {}),
      };
    }
  }

  if (want.quarter && signals.quarters.length > 0 && !signals.quarters.some((q) => q.startsWith(want.quarter!))) {
    return { outcome: 'needs_review', note: `It looks like ${signals.quarters[0]}, not ${want.quarter}.` };
  }
  return { outcome: 'satisfied' };
}
