import { Link } from 'react-router-dom';
import { PublicLayout } from './PublicLayout';

/** The public homepage (signed-out visitors at /): what RenewalIQ is, and links to the policies. */
export function HomePage() {
  return (
    <PublicLayout>
      <h1>RenewalIQ</h1>
      <p>
        RenewalIQ is a workspace for commercial insurance agencies. Agents keep each client account in one place — documents, the risk profile,
        markets and quotes, follow-ups, policies and renewals — and see what needs their attention today.
      </p>
      <h2>Related Emails (optional Gmail connection)</h2>
      <p>
        An agent can connect their own Gmail account with read-only access. RenewalIQ then shows, on each client account, the email threads that
        appear to be about that client — for example, because the sender is a saved contact on the account — so the agent can review them and open
        them in Gmail. RenewalIQ never sends, deletes or changes email. Details are in the <Link to="/privacy" className="font-medium text-[var(--color-brand-700)] underline">Privacy Policy</Link>.
      </p>
      <h2>Access</h2>
      <p>RenewalIQ is invitation-only: agencies invite their own agents. Existing users can <Link to="/login" className="font-medium text-[var(--color-brand-700)] underline">sign in</Link>.</p>
    </PublicLayout>
  );
}
