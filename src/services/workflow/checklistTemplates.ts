import type { DocumentCategory, MissingItemType, RiskProfile } from '../../types';

/**
 * Submission checklists, keyed by line. Only trucking exists today, but items carry a
 * `templateKey` so requirements can later vary by line or by carrier without changing the
 * MissingItem shape — add another entry here (or a carrier-specific one) rather than hard-coding
 * anything in the UI.
 */
export interface ChecklistTemplateItem {
  key: string;
  label: string;
  type: MissingItemType;
  /** Uploaded documents in this category are offered as "already received?" evidence. */
  documentCategories?: DocumentCategory[];
  /** Expand into one item per driver on the Risk Profile (falls back to a single item when none are known yet). */
  perDriver?: boolean;
}

export interface ChecklistTemplate {
  key: string;
  label: string;
  items: ChecklistTemplateItem[];
}

export const CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
  {
    key: 'trucking_submission',
    label: 'Trucking submission',
    items: [
      { key: 'application', label: 'Application', type: 'document', documentCategories: ['application'] },
      { key: 'loss_runs', label: 'Loss Runs', type: 'document', documentCategories: ['loss_run'] },
      { key: 'mvr', label: 'MVR', type: 'document', perDriver: true },
      { key: 'ifta', label: 'IFTA — last 4 quarters', type: 'document' },
      { key: 'unit_list', label: 'Unit List', type: 'document', documentCategories: ['vehicle_schedule'] },
      { key: 'driver_list', label: 'Driver List', type: 'document', documentCategories: ['driver_schedule'] },
    ],
  },
];

export function getTemplate(key: string): ChecklistTemplate | undefined {
  return CHECKLIST_TEMPLATES.find((t) => t.key === key);
}

export function findTemplateItem(templateKey: string | undefined): ChecklistTemplateItem | undefined {
  if (!templateKey) return undefined;
  const base = templateKey.split(':')[0];
  for (const t of CHECKLIST_TEMPLATES) {
    const hit = t.items.find((i) => i.key === base);
    if (hit) return hit;
  }
  return undefined;
}

/** Expands a template into concrete item seeds for an account — per-driver items use the drivers already on the Risk Profile. */
export function expandTemplate(template: ChecklistTemplate, profile: RiskProfile | undefined): { label: string; type: MissingItemType; templateKey: string }[] {
  const drivers = (profile?.drivers ?? []).filter((d) => d.name && d.name.trim());
  const out: { label: string; type: MissingItemType; templateKey: string }[] = [];
  for (const item of template.items) {
    if (item.perDriver && drivers.length > 0) {
      for (const d of drivers) out.push({ label: `${item.label} — ${d.name!.trim()}`, type: item.type, templateKey: `${item.key}:${d.id}` });
    } else {
      out.push({ label: item.perDriver ? `${item.label}s — all drivers` : item.label, type: item.type, templateKey: item.key });
    }
  }
  return out;
}
