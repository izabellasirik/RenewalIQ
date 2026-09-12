/**
 * Cosmetic branding for a generated application PDF — deliberately the ONLY place these strings
 * live, so supporting a white-labeled brokerage later is swapping this one object for a
 * brokerage-specific one (passed into generateApplicationPdf's `branding` parameter), never editing
 * the PDF layout code itself. Kept intentionally small (two short strings) since that's all the
 * current design calls for; a real multi-tenant settings UI can build on top of this later without
 * changing exportApplication.ts again.
 */
export interface ApplicationBranding {
  /** Small line directly under the dynamic "{Named Insured} Application" title. */
  headerTagline: string;
  /** Printed at the bottom of every page. */
  footerText: string;
}

export const DEFAULT_APPLICATION_BRANDING: ApplicationBranding = {
  headerTagline: 'Prepared with RenewalIQ',
  footerText: 'Powered by RenewalIQ • Intelligent Commercial Insurance Submissions',
};
