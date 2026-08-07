import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Account, MatchResult, RiskProfile, UploadedDocument } from '../types';
import { createEmptyRiskProfile, applyExtractionResults, applyManualEdit, mockExtractionProvider } from '../services/extraction';
import { matchAllMarkets } from '../services/appetite';
import { sampleAppetiteRecords } from '../data/carriers';
import { sampleAccount } from '../data/sampleAccounts';
import { sampleDocumentTemplates } from '../data/sampleDocuments';
import { generateId } from '../utils/id';
import { inferCategory, inferFileType, matchKnownSampleDocId } from '../utils/documents';

interface AccountsState {
  accounts: Account[];
  documents: Record<string, UploadedDocument[]>;
  riskProfiles: Record<string, RiskProfile>;
  matchResults: Record<string, MatchResult[]>;
  activeAccountId: string | null;

  createAccount: (namedInsured: string, state: string) => string;
  ensureSampleAccount: () => string;
  setActiveAccount: (id: string) => void;
  addFiles: (accountId: string, files: { name: string; size: number }[]) => void;
  loadSampleDocuments: (accountId: string) => void;
  updateField: (accountId: string, section: 'business' | 'transportation', key: string, value: unknown) => void;
  runMatching: (accountId: string) => void;
}

function newAccount(namedInsured: string, state: string): Account {
  const now = new Date().toISOString();
  return {
    id: generateId('acct'),
    namedInsured,
    state,
    createdAt: now,
    updatedAt: now,
    status: 'new',
  };
}

export const useAccountsStore = create<AccountsState>()(
  persist(
    (set, get) => ({
      accounts: [],
      documents: {},
      riskProfiles: {},
      matchResults: {},
      activeAccountId: null,

      createAccount: (namedInsured, state) => {
        const account = newAccount(namedInsured, state);
        set((s) => ({
          accounts: [...s.accounts, account],
          riskProfiles: { ...s.riskProfiles, [account.id]: createEmptyRiskProfile(account.id) },
          documents: { ...s.documents, [account.id]: [] },
          activeAccountId: account.id,
        }));
        return account.id;
      },

      ensureSampleAccount: () => {
        const existing = get().accounts.find((a) => a.id === sampleAccount.id);
        if (existing) {
          set({ activeAccountId: sampleAccount.id });
          return sampleAccount.id;
        }
        set((s) => ({
          accounts: [...s.accounts, sampleAccount],
          riskProfiles: { ...s.riskProfiles, [sampleAccount.id]: createEmptyRiskProfile(sampleAccount.id) },
          documents: { ...s.documents, [sampleAccount.id]: [] },
          activeAccountId: sampleAccount.id,
        }));
        return sampleAccount.id;
      },

      setActiveAccount: (id) => set({ activeAccountId: id }),

      addFiles: (accountId, files) => {
        const newDocs: UploadedDocument[] = files.map((f) => ({
          id: matchKnownSampleDocId(f.name) ?? generateId('doc'),
          accountId,
          name: f.name,
          fileType: inferFileType(f.name),
          category: inferCategory(f.name),
          uploadedAt: new Date().toISOString(),
          status: 'processing',
          sizeBytes: f.size,
        }));

        set((s) => ({
          documents: { ...s.documents, [accountId]: [...(s.documents[accountId] ?? []), ...newDocs] },
          accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, status: 'documents_uploaded', updatedAt: new Date().toISOString() } : a)),
        }));

        for (const doc of newDocs) {
          mockExtractionProvider.extract(doc).then((results) => {
            set((s) => {
              const profile = s.riskProfiles[accountId];
              if (!profile) return {};
              const updatedProfile = applyExtractionResults({ ...profile }, results);
              const updatedDocs = (s.documents[accountId] ?? []).map((d) =>
                d.id === doc.id ? { ...d, status: 'processed' as const, fieldsExtracted: results.length } : d
              );
              return {
                riskProfiles: { ...s.riskProfiles, [accountId]: updatedProfile },
                documents: { ...s.documents, [accountId]: updatedDocs },
              };
            });
            get().runMatching(accountId);
          });
        }
      },

      loadSampleDocuments: (accountId) => {
        get().addFiles(
          accountId,
          sampleDocumentTemplates.map((t) => ({ name: t.name, size: t.sizeBytes }))
        );
      },

      updateField: (accountId, section, key, value) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const updated = applyManualEdit({ ...profile }, section, key, value);
          return { riskProfiles: { ...s.riskProfiles, [accountId]: updated } };
        });
        get().runMatching(accountId);
      },

      runMatching: (accountId) => {
        const profile = get().riskProfiles[accountId];
        if (!profile) return;
        const results = matchAllMarkets(sampleAppetiteRecords, profile);
        set((s) => ({ matchResults: { ...s.matchResults, [accountId]: results } }));
      },
    }),
    { name: 'renewaliq.state.v1' }
  )
);
