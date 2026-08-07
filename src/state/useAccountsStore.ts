import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Account,
  ActivityEvent,
  ActivityEventType,
  CoverageType,
  FeedbackEntry,
  MatchResult,
  RiskProfile,
  UploadedDocument,
} from '../types';
import { createEmptyRiskProfile, applyExtractionResults, applyManualEdit, mockExtractionProvider } from '../services/extraction';
import { matchAllMarkets } from '../services/appetite';
import { sampleAppetiteRecords } from '../data/carriers';
import { sampleAccount } from '../data/sampleAccounts';
import { sampleDocumentTemplates } from '../data/sampleDocuments';
import { generateId } from '../utils/id';
import { inferCategory, inferFileType, matchKnownSampleDocId } from '../utils/documents';

const MAX_EVENTS_PER_ACCOUNT = 200;

interface AccountsState {
  accounts: Account[];
  documents: Record<string, UploadedDocument[]>;
  riskProfiles: Record<string, RiskProfile>;
  matchResults: Record<string, MatchResult[]>;
  activityLog: Record<string, ActivityEvent[]>;
  feedback: FeedbackEntry[];
  activeAccountId: string | null;

  createAccount: (namedInsured: string, state: string) => string;
  ensureSampleAccount: () => string;
  setActiveAccount: (id: string) => void;
  addFiles: (accountId: string, files: { name: string; size: number }[]) => void;
  loadSampleDocuments: (accountId: string) => void;
  updateField: (accountId: string, section: 'business' | 'transportation', key: string, value: unknown) => void;
  updateCoverage: (accountId: string, coverageType: CoverageType, field: 'currentLimit' | 'requestedLimit', value: string) => void;
  runMatching: (accountId: string) => void;
  renameAccount: (accountId: string, namedInsured: string) => void;
  duplicateAccount: (accountId: string) => string;
  archiveAccount: (accountId: string) => void;
  restoreAccount: (accountId: string) => void;
  deleteAccountPermanently: (accountId: string) => void;
  submitFeedback: (entry: Omit<FeedbackEntry, 'id' | 'submittedAt'>) => void;
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
    archived: false,
  };
}

function touchAccount(accounts: Account[], accountId: string): Account[] {
  return accounts.map((a) => (a.id === accountId ? { ...a, updatedAt: new Date().toISOString() } : a));
}

function appendEvent(log: Record<string, ActivityEvent[]>, accountId: string, type: ActivityEventType, message: string): Record<string, ActivityEvent[]> {
  const event: ActivityEvent = { id: generateId('evt'), accountId, type, message, timestamp: new Date().toISOString() };
  const existing = log[accountId] ?? [];
  return { ...log, [accountId]: [...existing, event].slice(-MAX_EVENTS_PER_ACCOUNT) };
}

export const useAccountsStore = create<AccountsState>()(
  persist(
    (set, get) => ({
      accounts: [],
      documents: {},
      riskProfiles: {},
      matchResults: {},
      activityLog: {},
      feedback: [],
      activeAccountId: null,

      createAccount: (namedInsured, state) => {
        const account = newAccount(namedInsured, state);
        set((s) => ({
          accounts: [...s.accounts, account],
          riskProfiles: { ...s.riskProfiles, [account.id]: createEmptyRiskProfile(account.id) },
          documents: { ...s.documents, [account.id]: [] },
          activityLog: appendEvent(s.activityLog, account.id, 'account_created', `Submission created for ${namedInsured}.`),
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
          activityLog: appendEvent(s.activityLog, sampleAccount.id, 'account_created', `Sample submission loaded for ${sampleAccount.namedInsured}.`),
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

        set((s) => {
          let log = s.activityLog;
          for (const doc of newDocs) log = appendEvent(log, accountId, 'document_uploaded', `Uploaded ${doc.name}.`);
          return {
            documents: { ...s.documents, [accountId]: [...(s.documents[accountId] ?? []), ...newDocs] },
            accounts: touchAccount(
              s.accounts.map((a) => (a.id === accountId ? { ...a, status: 'documents_uploaded' as const } : a)),
              accountId
            ),
            activityLog: log,
          };
        });

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
                activityLog: appendEvent(s.activityLog, accountId, 'document_processed', `Extracted ${results.length} field${results.length === 1 ? '' : 's'} from ${doc.name}.`),
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
          const bucket = profile[section] as unknown as Record<string, { isMissing: boolean; isConflicting: boolean; confidence: string }>;
          const before = bucket[key];

          let type: ActivityEventType = 'field_completed';
          let message = `Filled in "${key}".`;
          if (before && !before.isMissing) {
            if (before.isConflicting) {
              type = 'conflict_resolved';
              message = `Resolved a conflicting value for "${key}".`;
            } else if (before.confidence !== 'manual') {
              type = 'field_corrected';
              message = `Corrected an extracted value for "${key}".`;
            } else {
              message = `Updated "${key}".`;
            }
          }

          const updated = applyManualEdit({ ...profile }, section, key, value);
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: updated },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, type, message),
          };
        });
        get().runMatching(accountId);
      },

      updateCoverage: (accountId, coverageType, field, value) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const coverage = profile.coverage.map((line) =>
            line.type === coverageType
              ? { ...line, [field]: { value, confidence: 'manual' as const, isMissing: value.trim() === '', isConflicting: false } }
              : line
          );
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, coverage, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'coverage_edited', `Updated ${field === 'currentLimit' ? 'current' : 'requested'} limit for ${coverageType.replace(/_/g, ' ')}.`),
          };
        });
      },

      runMatching: (accountId) => {
        const profile = get().riskProfiles[accountId];
        if (!profile) return;
        const results = matchAllMarkets(sampleAppetiteRecords, profile);
        const strong = results.filter((r) => r.verdict === 'strong_match').length;
        set((s) => ({
          matchResults: { ...s.matchResults, [accountId]: results },
          activityLog: appendEvent(s.activityLog, accountId, 'matching_run', `Matched against ${results.length} markets — ${strong} strong match${strong === 1 ? '' : 'es'}.`),
        }));
      },

      renameAccount: (accountId, namedInsured) => {
        set((s) => ({
          accounts: touchAccount(
            s.accounts.map((a) => (a.id === accountId ? { ...a, namedInsured } : a)),
            accountId
          ),
        }));
      },

      duplicateAccount: (accountId) => {
        const s = get();
        const source = s.accounts.find((a) => a.id === accountId);
        const sourceProfile = s.riskProfiles[accountId];
        if (!source || !sourceProfile) return '';

        const newId = generateId('acct');
        const now = new Date().toISOString();
        const clonedAccount: Account = { ...source, id: newId, namedInsured: `${source.namedInsured} (Copy)`, createdAt: now, updatedAt: now, archived: false };
        const clonedProfile: RiskProfile = { ...sourceProfile, id: generateId('risk'), accountId: newId, updatedAt: now };
        const clonedDocs = (s.documents[accountId] ?? []).map((d) => ({ ...d, id: generateId('doc'), accountId: newId }));

        set((state) => ({
          accounts: [...state.accounts, clonedAccount],
          riskProfiles: { ...state.riskProfiles, [newId]: clonedProfile },
          documents: { ...state.documents, [newId]: clonedDocs },
          activityLog: appendEvent(state.activityLog, newId, 'account_duplicated', `Duplicated from "${source.namedInsured}".`),
          activeAccountId: newId,
        }));
        get().runMatching(newId);
        return newId;
      },

      archiveAccount: (accountId) => {
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, archived: true } : a)) }));
      },

      restoreAccount: (accountId) => {
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, archived: false } : a)) }));
      },

      deleteAccountPermanently: (accountId) => {
        set((s) => {
          const { [accountId]: _doc, ...documents } = s.documents;
          const { [accountId]: _profile, ...riskProfiles } = s.riskProfiles;
          const { [accountId]: _matches, ...matchResults } = s.matchResults;
          const { [accountId]: _log, ...activityLog } = s.activityLog;
          return {
            accounts: s.accounts.filter((a) => a.id !== accountId),
            documents,
            riskProfiles,
            matchResults,
            activityLog,
            activeAccountId: s.activeAccountId === accountId ? null : s.activeAccountId,
          };
        });
      },

      submitFeedback: (entry) => {
        const feedback: FeedbackEntry = { ...entry, id: generateId('fb'), submittedAt: new Date().toISOString() };
        set((s) => ({ feedback: [...s.feedback, feedback] }));
      },
    }),
    { name: 'renewaliq.state.v1' }
  )
);
