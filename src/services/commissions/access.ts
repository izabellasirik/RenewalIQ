/**
 * Who may open Commissions, and whether the section is switched on at all.
 *
 * The section is OFF in production builds unless VITE_FEATURE_COMMISSIONS=true is set, and ON in
 * local development unless it is set to false. When on, only agency admins may open it; agents and
 * people without an agency never see the figures.
 *
 * This preview holds FICTIONAL sample data only, kept in the browser, so this app-side check is the
 * whole boundary. Real commission data must not be connected until the database enforces the same
 * rule (row-level security) — see CARRIER_103_PLAN.
 */
export type CommissionsAccess = 'allowed' | 'feature-off' | 'no-agency' | 'not-admin';

export function commissionsFeatureEnabled(env: { DEV?: boolean; VITE_FEATURE_COMMISSIONS?: string } = import.meta.env): boolean {
  const flag = String(env.VITE_FEATURE_COMMISSIONS ?? '').trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return env.DEV === true;
}

export function commissionsAccess(agencyAccess: { role: string } | null | undefined, featureEnabled = commissionsFeatureEnabled()): CommissionsAccess {
  if (!featureEnabled) return 'feature-off';
  if (!agencyAccess) return 'no-agency';
  return agencyAccess.role === 'admin' ? 'allowed' : 'not-admin';
}
