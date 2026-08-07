import { useMemo } from 'react';
import type { FieldValue, RiskProfile } from '../types';
import { emptyField } from '../types';
import { RISK_PROFILE_GROUPS, type RiskFieldConfig } from '../pages/riskProfileFieldConfig';
import { getFieldValueByPath } from '../utils/riskProfilePath';

export interface FieldStatEntry {
  field: RiskFieldConfig;
  groupTitle: string;
  value: FieldValue<unknown>;
}

export interface RiskProfileStats {
  total: number;
  filled: number;
  missing: FieldStatEntry[];
  conflicting: FieldStatEntry[];
  /** Filled fields with no unresolved conflict — disjoint from missing/conflicting. */
  completed: FieldStatEntry[];
}

function getField(profile: RiskProfile, config: RiskFieldConfig): FieldValue<unknown> {
  return getFieldValueByPath(profile, `${config.section}.${config.key}`) ?? emptyField();
}

/** Pure computation — safe to call per-account in a loop (e.g. cross-account analytics), unlike the hook below. */
export function computeRiskProfileStats(profile: RiskProfile | undefined): RiskProfileStats {
  if (!profile) return { total: 0, filled: 0, missing: [], conflicting: [], completed: [] };

  const missing: FieldStatEntry[] = [];
  const conflicting: FieldStatEntry[] = [];
  const completed: FieldStatEntry[] = [];
  let filled = 0;
  let total = 0;

  for (const group of RISK_PROFILE_GROUPS) {
    for (const field of group.fields) {
      total++;
      const value = getField(profile, field);
      const entry = { field, groupTitle: group.title, value };
      if (value.isMissing) {
        missing.push(entry);
      } else {
        filled++;
        if (value.isConflicting) conflicting.push(entry);
        else completed.push(entry);
      }
    }
  }

  return { total, filled, missing, conflicting, completed };
}

export function useRiskProfileStats(profile: RiskProfile | undefined): RiskProfileStats {
  return useMemo(() => computeRiskProfileStats(profile), [profile]);
}
