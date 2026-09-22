import type { Account, Contact } from '../../types';

/**
 * The account's contacts, falling back to the legacy single-contact fields (contactName /
 * contactEmail / contactPhone, set by the intake-import flow before contacts existed) so an old
 * account shows its one contact instead of none. The synthesized contact has a stable id, so a
 * request recorded against it still resolves after the broker edits it (which materializes the
 * `contacts` array).
 */
export function getAccountContacts(account: Account | undefined): Contact[] {
  if (!account) return [];
  if (account.contacts) return account.contacts;
  if (account.contactName || account.contactEmail || account.contactPhone) {
    return [
      {
        id: legacyContactId(account.id),
        name: account.contactName || account.contactEmail || 'Primary contact',
        email: account.contactEmail,
        phone: account.contactPhone,
        primary: true,
      },
    ];
  }
  return [];
}

export function legacyContactId(accountId: string): string {
  return `contact_legacy_${accountId}`;
}

export function getPrimaryContact(account: Account | undefined): Contact | undefined {
  const contacts = getAccountContacts(account);
  return contacts.find((c) => c.primary) ?? contacts[0];
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
