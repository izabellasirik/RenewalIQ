import { Link } from 'react-router-dom';
import { PUBLIC_FACTS, PublicLayout } from './PublicLayout';

/** A short, plain Terms of Service. The owner should review it (and the governing law) before relying on it. */
export function TermsPage() {
  const { operator, contactEmail, updated } = PUBLIC_FACTS;
  return (
    <PublicLayout>
      <h1>Terms of Service</h1>
      <p className="text-sm text-[var(--color-ink-500)]">Last updated: {updated}</p>
      <p>These terms govern use of RenewalIQ, provided by {operator}. By using RenewalIQ you agree to them.</p>
      <h2>Accounts</h2>
      <p>RenewalIQ is invitation-only. You are responsible for your sign-in credentials and for activity under your account.</p>
      <h2>Your data</h2>
      <p>
        Your agency owns the information it enters into RenewalIQ. We process it to provide the service, as described in the{' '}
        <Link to="/privacy" className="font-medium text-[var(--color-brand-700)] underline">
          Privacy Policy
        </Link>
        .
      </p>
      <h2>Acceptable use</h2>
      <p>Don’t misuse the service, attempt to access data you aren’t permitted to see, or use it in violation of law.</p>
      <h2>Gmail</h2>
      <p>Connecting Gmail is optional and read-only. You can disconnect it at any time.</p>
      <h2>Disclaimer</h2>
      <p>RenewalIQ is provided “as is”. It assists your work; decisions about coverage, quotes and clients remain yours.</p>
      <h2>Contact</h2>
      <p>{contactEmail}</p>
    </PublicLayout>
  );
}
