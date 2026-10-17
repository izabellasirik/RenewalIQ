import type { AgencyAccess } from '../supabase/submissionsRepo';

/**
 * The Commissions demo build (demo/commissions-sample branch only, see vite.config.ts): no database
 * connection, so nobody signs in. The visitor acts as the admin of a fictional agency so the
 * admin-only Commissions section opens.
 */
export const COMMISSIONS_DEMO = import.meta.env.VITE_COMMISSIONS_DEMO === 'true';

export const DEMO_AGENCY: AgencyAccess = { agencyId: 'demo-agency', agencyName: 'Sample Agency', role: 'admin' };
