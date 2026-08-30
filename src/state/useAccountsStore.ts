import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Account,
  ActivityEvent,
  ActivityEventType,
  AppetiteRecord,
  CoverageType,
  FeedbackEntry,
  MatchResult,
  RiskProfile,
  UploadedDocument,
} from '../types';
import type { FieldResolution } from '../services/extraction';
import { createEmptyRiskProfile, mergeIntoRiskProfile, applyManualEdit, applyFieldResolution, extractInsuranceFields } from '../services/extraction';
import { matchAllMarkets } from '../services/appetite';
import { applyOverrides } from '../services/appetite/appetiteFieldKeys';
import { fetchAppetiteOverrides } from '../services/appetiteUpdates/appetiteUpdateService';
import { sampleAppetiteRecords } from '../data/carriers';
import { sampleAccount } from '../data/sampleAccounts';
import { sampleDocumentFixtures } from '../data/sampleDocuments';
import { generateId } from '../utils/id';
import { inferCategory, inferFileType } from '../utils/documents';

const MAX_EVENTS_PER_ACCOUNT = 200;

interface AccountsState {
  accounts: Account[];
  documents: Record<string, UploadedDocument[]>;
  riskProfiles: Record<string, RiskProfile>;
  matchResults: Record<string, MatchResult[]>;
  activityLog: Record<string, ActivityEvent[]>;
  feedback: FeedbackEntry[];
  activeAccountId: string | null;
  /** Base appetite records with any admin-approved Supabase overrides merged on top. Starts as the static base data; `loadEffectiveAppetiteRecords` refreshes it. Never persisted to localStorage — always re-fetched, so a stale override can't get stuck client-side. */
  effectiveAppetiteRecords: AppetiteRecord[];

  createAccount: (namedInsured: string, state: string) => string;
  /** Commits an account whose documents were already parsed/extracted (e.g. by the upload-first New Submission flow) in one transaction, instead of creating an empty account and processing files afterward. */
  createAccountFromExtraction: (namedInsured: string, state: string, documents: Omit<UploadedDocument, 'accountId'>[], profile: RiskProfile) => string;
  ensureSampleAccount: () => string;
  setActiveAccount: (id: string) => void;
  addFiles: (accountId: string, files: File[]) => void;
  loadSampleDocuments: (accountId: string) => Promise<void>;
  updateField: (accountId: string, section: 'business' | 'transportation', key: string, value: unknown) => void;
  resolveField: (accountId: string, section: 'business' | 'transportation', key: string, resolution: FieldResolution<unknown>) => void;
  updateCoverage: (accountId: string, coverageType: CoverageType, field: 'currentLimit' | 'requestedLimit', value: string) => void;
  runMatching: (accountId: string) => void;
  /** Fetches approved appetite_overrides from Supabase and merges them onto the base records. No-ops (leaves effectiveAppetiteRecords as the base data) if Supabase isn't configured or the fetch fails. */
  loadEffectiveAppetiteRecords: () => Promise<void>;
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
      effectiveAppetiteRecords: sampleAppetiteRecords,

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

      createAccountFromExtraction: (namedInsured, state, documents, profile) => {
        const account = { ...newAccount(namedInsured, state), status: 'documents_uploaded' as const };
        const finalDocs: UploadedDocument[] = documents.map((d) => ({ ...d, accountId: account.id }));
        const finalProfile: RiskProfile = { ...profile, accountId: account.id };

        set((s) => {
          let log = appendEvent(
            s.activityLog,
            account.id,
            'account_created',
            `Submission created for ${namedInsured} from ${documents.length} uploaded document${documents.length === 1 ? '' : 's'}.`
          );
          for (const doc of finalDocs) {
            log = appendEvent(log, account.id, 'document_uploaded', `Uploaded ${doc.name}.`);
            if (doc.status === 'processed') {
              log = appendEvent(log, account.id, 'document_processed', `Extracted ${doc.fieldsExtracted ?? 0} field${doc.fieldsExtracted === 1 ? '' : 's'} from ${doc.name}.`);
            }
          }
          return {
            accounts: [...s.accounts, account],
            riskProfiles: { ...s.riskProfiles, [account.id]: finalProfile },
            documents: { ...s.documents, [account.id]: finalDocs },
            activityLog: log,
            activeAccountId: account.id,
          };
        });
        get().runMatching(account.id);
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
          id: generateId('doc'),
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

        newDocs.forEach((doc, i) => {
          const file = files[i];
          import('../services/ingestion').then(({ parseFile }) => parseFile(file)).then((raw) => {
            const results = extractInsuranceFields(raw, { documentId: doc.id, documentName: doc.name });
            set((s) => {
              const profile = s.riskProfiles[accountId];
              if (!profile) return {};
              const updatedProfile = mergeIntoRiskProfile({ ...profile }, results);
              const updatedDocs = (s.documents[accountId] ?? []).map((d) =>
                d.id === doc.id
                  ? { ...d, status: 'processed' as const, fieldsExtracted: results.length, warnings: raw.warnings.length > 0 ? raw.warnings : undefined }
                  : d
              );
              return {
                riskProfiles: { ...s.riskProfiles, [accountId]: updatedProfile },
                documents: { ...s.documents, [accountId]: updatedDocs },
                activityLog: appendEvent(s.activityLog, accountId, 'document_processed', `Extracted ${results.length} field${results.length === 1 ? '' : 's'} from ${doc.name}.`),
              };
            });
            get().runMatching(accountId);
          });
        });
      },

      loadSampleDocuments: async (accountId) => {
        const files = await Promise.all(
          sampleDocumentFixtures.map(async (fixture) => {
            const res = await fetch(fixture.url);
            const blob = await res.blob();
            return new File([blob], fixture.name, { type: blob.type });
          })
        );
        get().addFiles(accountId, files);
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

      resolveField: (accountId, section, key, resolution) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const updated = applyFieldResolution({ ...profile }, section, key, resolution);
          const message =
            resolution.type === 'manual'
              ? `Resolved a conflicting value for "${key}" by entering it manually.`
              : `Resolved a conflicting value for "${key}".`;
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: updated },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'conflict_resolved', message),
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
              ? { ...line, [field]: { value, confidence: 'manual' as const, isMissing: value.trim() === '', isConflicting: false, extractionMethod: 'manual_entry' as const, lastUpdatedAt: new Date().toISOString() } }
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
        const results = matchAllMarkets(get().effectiveAppetiteRecords, profile);
        const likely = results.filter((r) => r.verdict === 'likely_match').length;
        set((s) => ({
          matchResults: { ...s.matchResults, [accountId]: results },
          activityLog: appendEvent(s.activityLog, accountId, 'matching_run', `Matched against ${results.length} markets — ${likely} likely match${likely === 1 ? '' : 'es'}.`),
        }));
      },

      loadEffectiveAppetiteRecords: async () => {
        const result = await fetchAppetiteOverrides();
        if (!result.ok) return; // not configured, or a transient fetch failure — base records stay in effect, nothing breaks
        set({ effectiveAppetiteRecords: applyOverrides(sampleAppetiteRecords, result.data) });
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
    {
      name: 'renewaliq.state.v1',
      // effectiveAppetiteRecords is derived (base + fetched overrides), re-loaded on demand — never
      // persisted, so a stale override can't get stuck in one broker's browser after an admin change.
      partialize: (state) => {
        const { effectiveAppetiteRecords: _effectiveAppetiteRecords, ...rest } = state;
        return rest;
      },
    }
  )
);
