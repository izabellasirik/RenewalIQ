/**
 * Links shown to people outside Renewal IQ (clients, applicants, invitees). They start with the
 * app's public address — VITE_PUBLIC_APP_URL (e.g. https://app.renewaliq.com) when set, so a link
 * never carries a preview deployment's long, personal hostname — and use a short random code.
 */
export function publicAppUrl(): string {
  const configured = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  return (configured || window.location.origin).replace(/\/+$/, '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A link token without dashes (32 random characters) — shorter to read, same token. */
export function compactToken(token: string): string {
  return UUID_RE.test(token) ? token.replace(/-/g, '').toLowerCase() : token;
}

/** Back to the stored form from what's in the address bar (accepts both the short and the long form). */
export function expandToken(token: string): string {
  const t = token.trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(t)) return `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20)}`;
  return token;
}

/** A client's secure document-request link (0030). */
export const clientRequestUrl = (token: string) => `${publicAppUrl()}/r/${compactToken(token)}`;
/** A Submission Intake link. */
export const intakeUrl = (token: string) => `${publicAppUrl()}/i/${compactToken(token)}`;
/** An agency invitation link. */
export const inviteUrl = (token: string) => `${publicAppUrl()}/invite/${token}`;

/**
 * Pages a client, applicant or invitee opens from a link — they must render whether or not someone
 * is (or was) signed in to Renewal IQ in this browser, and must never be sent to the sign-in page.
 */
const PUBLIC_PATH_RE = /^\/(r|i|request|intake|invite)\/[^/]+\/?$/;
export function isPublicLinkPath(pathname: string): boolean {
  return PUBLIC_PATH_RE.test(pathname);
}
