import { PUBLIC_FACTS, PublicLayout } from './PublicLayout';

/**
 * Privacy Policy. The Gmail section describes what the code does (supabase/functions/gmail,
 * migration 0068, RelatedEmailsCard): keep it in step when that changes.
 */
export function PrivacyPage() {
  const { operator, contactEmail, siteUrl, updated } = PUBLIC_FACTS;
  const mail = <a href={`mailto:${contactEmail}`} className="font-medium text-[var(--color-brand-700)] underline">{contactEmail}</a>;
  return (
    <PublicLayout>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-[var(--color-ink-500)]">Last updated: {updated}</p>
      <p>
        This policy explains what information {operator} (“we”) collects when agencies and their agents use RenewalIQ at {siteUrl}, how it is used,
        and the choices you have.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>Account details: your name, work email, and optional phone number and job title; your agency membership and role.</li>
        <li>Work you enter or upload: client accounts, contacts, documents, risk profiles, markets, quotes, policies, notes and follow-ups.</li>
        <li>Product usage events (for example, “a quote was added”), used to understand and improve RenewalIQ. These don’t include document contents.</li>
        <li>Gmail information, only if you choose to connect Gmail — described in the next section.</li>
      </ul>

      <h2>Gmail (Related Emails)</h2>
      <p>Connecting Gmail is optional, done by each agent for their own mailbox, and available only to members of an agency on RenewalIQ.</p>
      <ul>
        <li>
          <strong>Access requested:</strong> read-only access to Gmail (<code>https://www.googleapis.com/auth/gmail.readonly</code>) and your Google email
          address. RenewalIQ never sends, drafts, deletes, labels or otherwise changes your email.
        </li>
        <li>
          <strong>What is read:</strong> for each thread from the last 90 days and newer mail after that (excluding drafts, spam, trash and chats), the
          message headers needed to match it to a client — the subject, sender and recipient names and addresses, dates and message identifiers — and
          Gmail’s short preview of the latest message.
        </li>
        <li>
          <strong>What is stored:</strong> per thread, its Gmail identifiers, subject, the name and address of the person you’re corresponding with, the time
          of the latest message and the number of messages; the links you or RenewalIQ make between a thread and a client account, with their review
          status and history; and your Gmail address and sync position. Email bodies and attachments are never stored. The preview is used only in your
          browser, at the moment of matching, and is not stored.
        </li>
        <li>
          <strong>Tokens:</strong> Google’s access token is used only on our server. The refresh token is stored encrypted (AES-256-GCM) in a table that only
          our server can read; it is never sent to your browser.
        </li>
        <li>
          <strong>Who can see it:</strong> only you. Other users in your agency, including admins, cannot see your mailbox data or your email links.
        </li>
        <li>
          <strong>How it is used:</strong> only to show you, on each client account, the threads that appear related to that client, so you can review them
          and open them in Gmail. Matching uses fixed rules (for example, the sender is a saved contact on the account); Gmail data is not sent to any
          AI or machine-learning service, and is not used to train models.
        </li>
        <li>
          <strong>Disconnecting deletes your Gmail data:</strong> you can disconnect Gmail at any time in Your profile. RenewalIQ then revokes its access at
          Google and deletes, from its database, everything it stored for your mailbox: the encrypted token, any unfinished connection, the stored thread
          details, the links between threads and client accounts, and their review history. Your client accounts, documents and other work are not
          affected, and other users’ Gmail data is not touched. You can also remove RenewalIQ’s access in your Google Account settings; RenewalIQ then
          stops syncing, and you can disconnect in Your profile to delete the stored data.
        </li>
      </ul>

      <h2>Google API Services User Data Policy — Limited Use</h2>
      <p>
        RenewalIQ’s use and transfer of information received from Google APIs to any other app will adhere to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" className="font-medium text-[var(--color-brand-700)] underline" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. In particular, Gmail data is used only to provide and improve the user-facing Related Emails feature
        described above; it is not transferred to others except as needed to provide that feature, to comply with law, or as part of a merger or
        acquisition with notice; it is not used for advertising; it is not sold; and no human reads it unless you give explicit consent for specific
        messages, it is necessary for security (such as investigating abuse), to comply with law, or it is aggregated and anonymized for internal
        operations.
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>To provide RenewalIQ to your agency and to you, and to keep it secure.</li>
        <li>To read documents you upload and suggest fields (described in the app where it happens).</li>
        <li>To send service emails, such as invitations and client document requests.</li>
        <li>To understand how RenewalIQ is used, in order to improve it.</li>
      </ul>
      <p>We don’t sell personal information and don’t use it for advertising.</p>

      <h2>Service providers</h2>
      <ul>
        <li>Supabase — database, sign-in, file storage and server functions.</li>
        <li>Vercel — hosting of the web app.</li>
        <li>Google — Gmail access, only if you connect Gmail.</li>
        <li>Anthropic — reading documents that users upload, when that feature is used. Gmail data is never sent to it.</li>
        <li>Resend — sending service emails such as invitations.</li>
      </ul>

      <h2>Access within your agency</h2>
      <p>
        Agency admins can see the agency’s client accounts; agents see the accounts assigned to them or shared with them. Connected Gmail data is always
        private to the agent who connected it.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Information is kept while your agency uses RenewalIQ. Gmail information is kept only while Gmail is connected: disconnecting deletes it
        immediately from our database (see above), and deleting your user account also deletes it. To have your account deleted, contact us at {mail}.
        Copies may remain in our hosting provider’s database backups until those backups expire under its backup schedule.
      </p>

      <h2>Security</h2>
      <p>
        Data is transmitted over HTTPS. Access is enforced in the database for every request, so users can only reach their own agency’s data and their own
        mailbox data. Gmail tokens are encrypted at rest.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We will update this page when our practices change. Questions or requests: {mail}.
      </p>
    </PublicLayout>
  );
}
