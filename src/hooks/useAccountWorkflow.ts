import { useMemo } from 'react';
import { useAccountsStore } from '../state/useAccountsStore';
import { getAccountContacts } from '../services/workflow/contacts';
import { normalizeDateKey } from '../services/workflow/dates';
import { deriveAccountActions, deriveDoneActions } from '../services/workflow/nextActions';
import { EMPTY_DOCUMENTS, EMPTY_FOLLOW_UPS, EMPTY_MISSING_ITEMS, EMPTY_QUOTES } from '../utils/emptyArrays';

/** Everything the Account Workspace needs about one account's workflow, with derived next actions. */
export function useAccountWorkflow(accountId: string) {
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const profile = useAccountsStore((s) => s.riskProfiles[accountId]);
  const documents = useAccountsStore((s) => s.documents[accountId]) ?? EMPTY_DOCUMENTS;
  const items = useAccountsStore((s) => s.missingItems[accountId]) ?? EMPTY_MISSING_ITEMS;
  const quotes = useAccountsStore((s) => s.quotes[accountId]) ?? EMPTY_QUOTES;
  const followUps = useAccountsStore((s) => s.followUps[accountId]) ?? EMPTY_FOLLOW_UPS;

  const contacts = useMemo(() => getAccountContacts(account), [account]);
  // Older persisted profiles may lack these keys entirely — never assume they exist.
  const effectiveDate = normalizeDateKey((profile?.business?.effectiveDate?.value as string | null | undefined) ?? null);
  const dotNumber = (profile?.transportation?.dotNumber?.value as string | null | undefined) ?? null;

  const actions = useMemo(
    () => (account ? deriveAccountActions({ account, items, quotes, contacts, effectiveDate, followUps }) : { now: [], upcoming: [] }),
    [account, items, quotes, contacts, effectiveDate, followUps]
  );

  const doneActions = useMemo(
    () => (account ? deriveDoneActions({ account, items, quotes, contacts, effectiveDate, followUps }) : []),
    [account, items, quotes, contacts, effectiveDate, followUps]
  );

  return { account, profile, documents, items, quotes, followUps, contacts, effectiveDate, dotNumber, actions, doneActions };
}
