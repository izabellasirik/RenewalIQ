import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Account,
  ActivityEvent,
  ActivityEventType,
  AppetiteRecord,
  AccountStage,
  AssignedBroker,
  Contact,
  CoverageLine,
  CoverageType,
  DriverEntry,
  LossEntry,
  MarketQuote,
  MatchResult,
  MissingItem,
  MissingItemStatus,
  MissingItemType,
  QuoteStatus,
  RiskProfile,
  UploadedDocument,
  VehicleEntry,
} from '../types';
import { emptyField, ACCOUNT_STAGE_LABELS, AWAITING_CARRIER_STATUSES, MISSING_ITEM_STATUS_LABELS, QUOTE_STATUS_LABELS, WORKFLOW_EVENT_TYPES } from '../types';
import { getAccountContacts } from '../services/workflow/contacts';
import { addBusinessDays, formatShortDate, todayKey } from '../services/workflow/dates';
import type { FieldResolution } from '../services/extraction';
import {
  createEmptyRiskProfile,
  mergeIntoRiskProfile,
  applyManualEdit,
  applyFieldResolution,
  applyCoverageFieldResolution,
  resolveFieldConflict,
  addRecordEntry,
  updateRecordEntry,
  deleteRecordEntry,
  removeDocumentFromRiskProfile,
  extractInsuranceFields,
  reconcileImageExtraction,
} from '../services/extraction';
import { extractViaVision } from '../services/ingestion/visionExtraction';
import { countExtractedFields } from '../utils/fieldCount';
import { matchAllMarkets } from '../services/appetite';
import { applyOverrides } from '../services/appetite/appetiteFieldKeys';
import { fetchAppetiteOverrides } from '../services/appetiteUpdates/appetiteUpdateService';
import { sampleAppetiteRecords } from '../data/carriers';
import { sampleAccount } from '../data/sampleAccounts';
import { sampleDocumentFixtures } from '../data/sampleDocuments';
import { generateId } from '../utils/id';
import { inferCategory, inferCategoryFromText, inferFileType } from '../utils/documents';
import { isSupabaseConfigured } from '../services/supabase/client';
import * as cloudRepo from '../services/supabase/submissionsRepo';

const MAX_EVENTS_PER_ACCOUNT = 200;

interface AccountsState {
  accounts: Account[];
  documents: Record<string, UploadedDocument[]>;
  riskProfiles: Record<string, RiskProfile>;
  matchResults: Record<string, MatchResult[]>;
  activityLog: Record<string, ActivityEvent[]>;
  /** Account workflow (see types/workflow.ts): the submission checklist / missing items per account, including items a carrier asked for. Persisted and cloud-synced with the submission. */
  missingItems: Record<string, MissingItem[]>;
  /** Markets the account has been (or will be) submitted to, and where each one stands. Persisted and cloud-synced with the submission. */
  quotes: Record<string, MarketQuote[]>;
  activeAccountId: string | null;
  /** Base appetite records with any admin-approved Supabase overrides merged on top. Starts as the static base data; `loadEffectiveAppetiteRecords` refreshes it. Never persisted to localStorage — always re-fetched, so a stale override can't get stuck client-side. */
  effectiveAppetiteRecords: AppetiteRecord[];

  // --- Broker cloud sync (see services/supabase/submissionsRepo.ts) -----------------------------
  /** The signed-in broker's id, or null when signed out / Supabase isn't configured. Ephemeral — never persisted, always re-derived from the live Supabase session on load (see App.tsx). */
  currentUserId: string | null;
  /** Which local account ids are mirrored to the signed-in broker's Supabase account. An id absent here is local-only (this browser only), regardless of whether anyone is currently signed in. Persisted, so the distinction survives a reload. */
  cloudAccountIds: Record<string, true>;
  /** Per-account cloud save status, for the "Saving… / Saved / Failed to save" indicator. Ephemeral — never persisted, since a stale "saving" from a previous session would be meaningless. */
  syncStatus: Record<string, 'saving' | 'saved' | 'error'>;
  /** Local accounts the signed-in broker explicitly dismissed ("Not now") from the "import to your account" prompt, or already imported — either way, never prompt again for these ids. Persisted. */
  dismissedImportIds: Record<string, true>;

  setCurrentUserId: (userId: string | null) => void;
  /** Pulls every submission the signed-in broker owns in the cloud and merges it into local state — cloud accounts already known locally are refreshed (cloud wins, per the "cloud becomes authoritative" rule); cloud accounts not yet seen on this device are added and marked cloud. Never touches local-only (not-yet-imported) accounts. */
  hydrateCloudSubmissions: () => Promise<void>;
  /** The broker's explicit "Import to account" action from the local-submissions-found prompt — marks each given local account as cloud and pushes its current state up, without waiting to be asked again. */
  importAccountsToCloud: (accountIds: string[]) => Promise<void>;
  /** The broker's "Not now" action — stops the import prompt from asking about these ids again this device, without changing anything about the accounts themselves. */
  dismissLocalImport: (accountIds: string[]) => void;

  createAccount: (namedInsured: string, state: string) => string;
  /** Commits an account whose documents were already parsed/extracted (e.g. by the upload-first New Submission flow) in one transaction, instead of creating an empty account and processing files afterward. `files`, when given, are the original File objects in the same order as `documents` — used only to upload bytes to cloud Storage when this account turns out to be cloud-backed; never required for the local-only path. `contact`, when given (the intake-form import flow — see services/intake/importIntakeSubmission.ts), stamps the applicant's own contact info onto the account envelope. */
  createAccountFromExtraction: (
    namedInsured: string,
    state: string,
    documents: Omit<UploadedDocument, 'accountId'>[],
    profile: RiskProfile,
    files?: File[],
    contact?: { name?: string; email?: string; phone?: string }
  ) => string;
  ensureSampleAccount: () => string;
  setActiveAccount: (id: string) => void;
  /** Returns the new document ids, in the same order as `files`, so a caller can link one to a checklist item. */
  addFiles: (accountId: string, files: File[]) => string[];
  loadSampleDocuments: (accountId: string) => Promise<void>;
  /** Removes an uploaded file and safely retracts any extracted data that depended only on it (see removeDocumentFromRiskProfile) — never leaves stale facts pointing at a source that no longer exists. */
  deleteDocument: (accountId: string, documentId: string) => void;
  updateField: (accountId: string, section: 'business' | 'transportation', key: string, value: unknown) => void;
  resolveField: (accountId: string, section: 'business' | 'transportation', key: string, resolution: FieldResolution<unknown>) => void;
  updateCoverage: (accountId: string, coverageType: CoverageType, field: 'currentLimit' | 'requestedLimit', value: string) => void;
  resolveCoverageConflict: (accountId: string, coverageType: CoverageType, field: 'currentLimit' | 'requestedLimit', resolution: FieldResolution<string>) => void;
  addCoverageLine: (accountId: string, coverageType: CoverageType) => void;
  deleteCoverageLine: (accountId: string, coverageType: CoverageType) => void;
  addVehicle: (accountId: string, entry: Omit<VehicleEntry, 'id'>) => void;
  updateVehicle: (accountId: string, vehicleId: string, patch: Partial<VehicleEntry>) => void;
  deleteVehicle: (accountId: string, vehicleId: string) => void;
  addDriver: (accountId: string, entry: Omit<DriverEntry, 'id'>) => void;
  updateDriver: (accountId: string, driverId: string, patch: Partial<DriverEntry>) => void;
  deleteDriver: (accountId: string, driverId: string) => void;
  addLoss: (accountId: string, entry: Omit<LossEntry, 'id'>) => void;
  updateLoss: (accountId: string, lossId: string, patch: Partial<LossEntry>) => void;
  deleteLoss: (accountId: string, lossId: string) => void;
  runMatching: (accountId: string) => void;
  /** Fetches approved appetite_overrides from Supabase and merges them onto the base records. No-ops (leaves effectiveAppetiteRecords as the base data) if Supabase isn't configured or the fetch fails. */
  loadEffectiveAppetiteRecords: () => Promise<void>;
  renameAccount: (accountId: string, namedInsured: string) => void;
  duplicateAccount: (accountId: string) => string;
  archiveAccount: (accountId: string) => void;
  restoreAccount: (accountId: string) => void;
  /** Returns { ok: false, message } if this account is cloud-backed and the cloud deletion fails — local state is left untouched in that case (see the STOP-and-report note in the implementation), so the broker never sees "deleted" when the cloud copy is still there. */
  deleteAccountPermanently: (accountId: string) => Promise<{ ok: boolean; message?: string }>;

  // --- Account workflow (contacts, checklist, markets & quotes) ------------------------------
  updateAccountInfo: (accountId: string, patch: { namedInsured?: string; state?: string }) => void;
  setAssignedBroker: (accountId: string, broker: AssignedBroker | null) => void;
  addContact: (accountId: string, contact: Omit<Contact, 'id'>) => string;
  updateContact: (accountId: string, contactId: string, patch: Partial<Omit<Contact, 'id'>>) => void;
  deleteContact: (accountId: string, contactId: string) => void;
  addMissingItems: (accountId: string, seeds: MissingItemSeed[]) => string[];
  updateMissingItem: (accountId: string, itemId: string, patch: Partial<Pick<MissingItem, 'label' | 'type' | 'notes' | 'followUpDate' | 'documentId'>>) => void;
  /** The broker sent the client a request (the email itself is sent outside Renewal IQ). */
  markItemsRequested: (accountId: string, itemIds: string[], opts: { contactId?: string; followUpDate?: string }) => void;
  markItemReceived: (accountId: string, itemId: string, opts?: { documentId?: string }) => void;
  /** Set a checklist item's status directly (the broker's manual override of the request/receive flow). */
  setItemStatus: (accountId: string, itemId: string, status: MissingItemStatus) => void;
  /** Set the account's pipeline status by hand; null returns it to automatic. */
  setAccountStage: (accountId: string, stage: AccountStage | null) => void;
  deleteMissingItem: (accountId: string, itemId: string) => void;
  /** A received carrier-requested item was passed on to the carrier that asked for it. */
  markItemSentToCarrier: (accountId: string, itemId: string) => void;
  addQuote: (accountId: string, input: { marketName: string; appetiteRecordId?: string; status?: QuoteStatus; submittedAt?: string; followUpDate?: string }) => string;
  updateQuote: (accountId: string, quoteId: string, patch: Partial<Pick<MarketQuote, 'marketName' | 'status' | 'submittedAt' | 'followUpDate' | 'premium' | 'declineReason'>>) => void;
  addQuoteNote: (accountId: string, quoteId: string, text: string) => void;
  deleteQuote: (accountId: string, quoteId: string) => void;
  /** A carrier/MGA asked for more — creates a linked missing item ("Needed by <carrier>") and flags the quote. */
  recordCarrierRequest: (accountId: string, quoteId: string, input: { label: string; type: MissingItemType; notes?: string }) => string;
}

export interface MissingItemSeed {
  label: string;
  type: MissingItemType;
  templateKey?: string;
  neededByQuoteId?: string;
  notes?: string;
  status?: MissingItemStatus;
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
  return { ...log, [accountId]: trimEvents([...existing, event]) };
}

/**
 * Keeps the local log bounded. Technical events (matching_run fires on every edit) are dropped
 * first, oldest first, so broker-meaningful workflow history isn't pushed out by noise. The cloud
 * copy is append-only and unaffected.
 */
function trimEvents(events: ActivityEvent[]): ActivityEvent[] {
  if (events.length <= MAX_EVENTS_PER_ACCOUNT) return events;
  let excess = events.length - MAX_EVENTS_PER_ACCOUNT;
  const kept = events.filter((e) => {
    if (excess > 0 && !WORKFLOW_EVENT_TYPES.has(e.type)) {
      excess--;
      return false;
    }
    return true;
  });
  return kept.slice(-MAX_EVENTS_PER_ACCOUNT);
}

function updateInList<T extends { id: string }>(list: T[] | undefined, id: string, fn: (item: T) => T): T[] {
  return (list ?? []).map((x) => (x.id === id ? fn(x) : x));
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

export const useAccountsStore = create<AccountsState>()(
  persist(
    (set, get) => {
      /**
       * Fire-and-forget cloud mirror for one submission — a no-op unless Supabase is configured,
       * a broker is signed in, and this specific account has been marked cloud (created while
       * signed in, or explicitly imported). Never blocks the caller: local state is always the
       * immediate source of truth for the current session (see file header in submissionsRepo.ts),
       * this just pushes the resulting state outward and reflects success/failure via syncStatus.
       */
      function syncNow(accountId: string) {
        const s = get();
        if (!isSupabaseConfigured || !s.currentUserId || !s.cloudAccountIds[accountId]) return;
        const account = s.accounts.find((a) => a.id === accountId);
        const profile = s.riskProfiles[accountId];
        if (!account || !profile) return;
        const userId = s.currentUserId;
        set((st) => ({ syncStatus: { ...st.syncStatus, [accountId]: 'saving' } }));
        const workflow = { missingItems: s.missingItems[accountId] ?? [], quotes: s.quotes[accountId] ?? [] };
        Promise.all([cloudRepo.saveSubmissionSnapshot(userId, account, profile, workflow), cloudRepo.appendActivityEvents(userId, accountId, get().activityLog[accountId] ?? [])]).then(([snapRes, actRes]) => {
          const ok = snapRes.ok && actRes.ok;
          set((st) => ({ syncStatus: { ...st.syncStatus, [accountId]: ok ? 'saved' : 'error' } }));
        });
      }

      /**
       * Uploads one file's bytes to the private Storage bucket and records the resulting path on
       * its document row, then pushes the full submission snapshot (so the document metadata and
       * every field extracted from it land together). A no-op unless this account is cloud-backed.
       * Runs after local processing finishes (success or failure) so even a document that failed
       * to read still has its original bytes preserved in the broker's account, not just discarded.
       */
      async function syncDocumentToCloud(accountId: string, documentId: string, file: File) {
        const s = get();
        if (!isSupabaseConfigured || !s.currentUserId || !s.cloudAccountIds[accountId]) return;
        const userId = s.currentUserId;
        const uploadResult = await cloudRepo.uploadDocumentFile(userId, accountId, documentId, file);
        if (uploadResult.ok) {
          set((st) => ({
            documents: {
              ...st.documents,
              [accountId]: (st.documents[accountId] ?? []).map((d) => (d.id === documentId ? { ...d, storagePath: uploadResult.data } : d)),
            },
          }));
        }
        const doc = (get().documents[accountId] ?? []).find((d) => d.id === documentId);
        if (doc) await cloudRepo.upsertDocumentMetadata(userId, accountId, doc, uploadResult.ok ? uploadResult.data : null);
        syncNow(accountId);
      }

      return {
      accounts: [],
      documents: {},
      riskProfiles: {},
      currentUserId: null,
      cloudAccountIds: {},
      syncStatus: {},
      dismissedImportIds: {},
      matchResults: {},
      activityLog: {},
      missingItems: {},
      quotes: {},
      activeAccountId: null,
      effectiveAppetiteRecords: sampleAppetiteRecords,

      createAccount: (namedInsured, state) => {
        const account = newAccount(namedInsured, state);
        const cloud = isSupabaseConfigured && !!get().currentUserId;
        set((s) => ({
          accounts: [...s.accounts, account],
          riskProfiles: { ...s.riskProfiles, [account.id]: createEmptyRiskProfile(account.id) },
          documents: { ...s.documents, [account.id]: [] },
          activityLog: appendEvent(s.activityLog, account.id, 'account_created', `Submission created for ${namedInsured}.`),
          activeAccountId: account.id,
          cloudAccountIds: cloud ? { ...s.cloudAccountIds, [account.id]: true } : s.cloudAccountIds,
        }));
        if (cloud) syncNow(account.id);
        return account.id;
      },

      createAccountFromExtraction: (namedInsured, state, documents, profile, files, contact) => {
        const account = {
          ...newAccount(namedInsured, state),
          status: 'documents_uploaded' as const,
          ...(contact?.name ? { contactName: contact.name } : {}),
          ...(contact?.email ? { contactEmail: contact.email } : {}),
          ...(contact?.phone ? { contactPhone: contact.phone } : {}),
          ...(contact?.name || contact?.email || contact?.phone
            ? { contacts: [{ id: generateId('contact'), name: contact.name || contact.email || 'Primary contact', email: contact.email, phone: contact.phone, primary: true }] }
            : {}),
        };
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
          const cloud = isSupabaseConfigured && !!s.currentUserId;
          return {
            accounts: [...s.accounts, account],
            riskProfiles: { ...s.riskProfiles, [account.id]: finalProfile },
            documents: { ...s.documents, [account.id]: finalDocs },
            activityLog: log,
            activeAccountId: account.id,
            cloudAccountIds: cloud ? { ...s.cloudAccountIds, [account.id]: true } : s.cloudAccountIds,
          };
        });
        get().runMatching(account.id);
        syncNow(account.id);
        if (isSupabaseConfigured && get().currentUserId && files) {
          finalDocs.forEach((doc, i) => {
            const file = files[i];
            if (file) syncDocumentToCloud(account.id, doc.id, file);
          });
        }
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
          import('../services/ingestion')
            .then(async ({ parseFile }) => {
              const raw = await parseFile(file);
              const isImageSource = raw.fileType === 'image';
              const ocrResults = extractInsuranceFields(raw, { documentId: doc.id, documentName: doc.name, isImageSource });

              // Images are the primary case vision extraction exists for — a layout-aware model
              // reads the photo directly instead of relying only on OCR text + regex. Attempted
              // only when Supabase is configured and the broker is signed in (see
              // isVisionExtractionAvailable); resolves to null on any failure (not configured,
              // function not deployed, provider error, malformed response) so OCR is always there
              // as a fallback — this call never throws and never blocks the OCR path.
              const visionResult = isImageSource ? await extractViaVision(file, get().currentUserId) : null;

              const { results, documentCategory, candidateNotes } = isImageSource
                ? reconcileImageExtraction({ documentId: doc.id, documentName: doc.name, ocrResults, visionResult })
                : { results: ocrResults, documentCategory: null, candidateNotes: undefined };

              const fieldsExtracted = countExtractedFields(results);
              // "Unreadable" now means BOTH extraction paths came up empty — vision succeeding on a
              // photo OCR's own confidence gate rejected (a common phone-photo-quality case) is a
              // real success, not a failure, even though raw.text is empty in that case.
              const ocrFoundNothing = raw.text.trim().length === 0 && raw.warnings.length > 0;
              const readFailed = ocrFoundNothing && fieldsExtracted === 0;
              // The "partially readable" warning describes Tesseract's own confidence, which stops
              // being an accurate description of the document once a vision read has taken over as
              // the primary source — only surfaced when OCR is what the final result actually rests on.
              const warnings = isImageSource && visionResult && fieldsExtracted > 0 ? [] : raw.warnings;
              const contentCategory = documentCategory ?? (isImageSource && raw.text ? inferCategoryFromText(raw.text) : null);

              if (import.meta.env.DEV) {
                // Counts and metadata only — never the OCR'd/vision text or any extracted field
                // value, so this can't leak a driver's-license/PII payload into the console even in dev.
                console.debug('[RenewalIQ] document processed', {
                  documentId: doc.id,
                  fileType: raw.fileType,
                  detectedCategory: contentCategory ?? doc.category,
                  visionAttempted: isImageSource,
                  visionSucceeded: !!visionResult,
                  ocrConfidence: raw.ocrConfidence,
                  ocrTextLength: raw.text.length,
                  fieldsExtracted,
                  warningCount: warnings.length,
                });
              }

              set((s) => {
                const profile = s.riskProfiles[accountId];
                if (!profile) return {};
                const updatedProfile = mergeIntoRiskProfile({ ...profile }, results);
                const updatedDocs = (s.documents[accountId] ?? []).map((d) =>
                  d.id === doc.id
                    ? {
                        ...d,
                        status: readFailed ? ('error' as const) : ('processed' as const),
                        fieldsExtracted,
                        warnings: warnings.length > 0 ? warnings : undefined,
                        previewDataUrl: raw.imagePreviewDataUrl,
                        category: contentCategory ?? d.category,
                        extractedFields: results.map((r) => ({ fieldPath: r.fieldPath, value: r.value, confidence: r.confidence, extractionMethod: r.extractionMethod })),
                        candidateNotes,
                      }
                    : d
                );
                return {
                  riskProfiles: { ...s.riskProfiles, [accountId]: updatedProfile },
                  documents: { ...s.documents, [accountId]: updatedDocs },
                  activityLog: appendEvent(
                    s.activityLog,
                    accountId,
                    'document_processed',
                    readFailed ? `Could not read ${doc.name}.` : `Extracted ${fieldsExtracted} field${fieldsExtracted === 1 ? '' : 's'} from ${doc.name}.`
                  ),
                };
              });
              get().runMatching(accountId);
              syncDocumentToCloud(accountId, doc.id, file);
            })
            .catch((err) => {
              const message = err instanceof Error ? err.message : 'Could not process this file.';
              set((s) => ({
                documents: {
                  ...s.documents,
                  [accountId]: (s.documents[accountId] ?? []).map((d) => (d.id === doc.id ? { ...d, status: 'error' as const, warnings: [message] } : d)),
                },
                activityLog: appendEvent(s.activityLog, accountId, 'document_processed', `Could not read ${doc.name}.`),
              }));
              syncDocumentToCloud(accountId, doc.id, file);
            });
        });
        return newDocs.map((d) => d.id);
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

      deleteDocument: (accountId, documentId) => {
        const before = get().documents[accountId] ?? [];
        const doc = before.find((d) => d.id === documentId);
        set((s) => {
          const docs = s.documents[accountId] ?? [];
          if (!doc) return {};
          const profile = s.riskProfiles[accountId];
          const updatedProfile = profile ? removeDocumentFromRiskProfile({ ...profile }, documentId) : profile;
          return {
            documents: { ...s.documents, [accountId]: docs.filter((d) => d.id !== documentId) },
            missingItems: s.missingItems[accountId]
              ? { ...s.missingItems, [accountId]: s.missingItems[accountId].map((i) => (i.documentId === documentId ? { ...i, documentId: undefined } : i)) }
              : s.missingItems,
            riskProfiles: updatedProfile ? { ...s.riskProfiles, [accountId]: updatedProfile } : s.riskProfiles,
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'document_deleted', `Deleted ${doc.name}. Data that depended only on this file was removed or updated; broker-confirmed values were kept.`),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
        const s = get();
        if (isSupabaseConfigured && s.currentUserId && s.cloudAccountIds[accountId] && doc) {
          Promise.all([doc.storagePath ? cloudRepo.deleteDocumentFile(doc.storagePath) : Promise.resolve({ ok: true as const, data: undefined }), cloudRepo.deleteDocumentRow(documentId)]).then(
            ([fileRes, rowRes]) => {
              const ok = fileRes.ok && rowRes.ok;
              set((st) => ({ syncStatus: { ...st.syncStatus, [accountId]: ok ? 'saved' : 'error' } }));
            }
          );
        }
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
        syncNow(accountId);
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
        syncNow(accountId);
      },

      updateCoverage: (accountId, coverageType, field, value) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const coverage = profile.coverage.map((line) => {
            if (line.type !== coverageType) return line;
            const existing = line[field] ?? emptyField<string>();
            const nextValue = value.trim() === '' ? null : value;
            return { ...line, [field]: resolveFieldConflict(existing, { type: 'manual', value: nextValue } as FieldResolution<string>) };
          });
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, coverage, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'coverage_edited', `Updated ${field === 'currentLimit' ? 'current' : 'requested'} limit for ${coverageType.replace(/_/g, ' ')}.`),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },

      resolveCoverageConflict: (accountId, coverageType, field, resolution) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const updated = applyCoverageFieldResolution({ ...profile }, coverageType, field, resolution);
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: updated },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'conflict_resolved', `Resolved a conflicting ${field === 'currentLimit' ? 'current' : 'requested'} limit for ${coverageType.replace(/_/g, ' ')}.`),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },

      addCoverageLine: (accountId, coverageType) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile || profile.coverage.some((c) => c.type === coverageType)) return {};
          const line: CoverageLine = { type: coverageType, requestedLimit: emptyField<string>() };
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, coverage: [...profile.coverage, line], updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'coverage_added', `Added ${coverageType.replace(/_/g, ' ')} coverage.`),
          };
        });
        syncNow(accountId);
      },

      deleteCoverageLine: (accountId, coverageType) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const coverage = profile.coverage.filter((c) => c.type !== coverageType);
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, coverage, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'coverage_deleted', `Removed ${coverageType.replace(/_/g, ' ')} coverage.`),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },

      addVehicle: (accountId, entry) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const vehicles = addRecordEntry(profile.vehicles, entry, 'veh');
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, vehicles, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'record_added', `Added a vehicle${entry.vin ? ` (VIN ${entry.vin})` : ''}.`),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },
      updateVehicle: (accountId, vehicleId, patch) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const vehicles = updateRecordEntry(profile.vehicles, vehicleId, patch);
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, vehicles, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'record_edited', 'Edited a vehicle.'),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },
      deleteVehicle: (accountId, vehicleId) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const vehicles = deleteRecordEntry(profile.vehicles, vehicleId);
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, vehicles, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'record_deleted', 'Deleted a vehicle.'),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },

      addDriver: (accountId, entry) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const drivers = addRecordEntry(profile.drivers, entry, 'drv');
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, drivers, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'record_added', `Added a driver${entry.name ? ` (${entry.name})` : ''}.`),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },
      updateDriver: (accountId, driverId, patch) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const drivers = updateRecordEntry(profile.drivers, driverId, patch);
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, drivers, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'record_edited', 'Edited a driver.'),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },
      deleteDriver: (accountId, driverId) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const drivers = deleteRecordEntry(profile.drivers, driverId);
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, drivers, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'record_deleted', 'Deleted a driver.'),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },

      addLoss: (accountId, entry) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const lossHistory = addRecordEntry(profile.lossHistory, entry, 'loss');
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, lossHistory, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'record_added', 'Added a loss.'),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },
      updateLoss: (accountId, lossId, patch) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const lossHistory = updateRecordEntry(profile.lossHistory, lossId, patch);
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, lossHistory, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'record_edited', 'Edited a loss.'),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
      },
      deleteLoss: (accountId, lossId) => {
        set((s) => {
          const profile = s.riskProfiles[accountId];
          if (!profile) return {};
          const lossHistory = deleteRecordEntry(profile.lossHistory, lossId);
          return {
            riskProfiles: { ...s.riskProfiles, [accountId]: { ...profile, lossHistory, updatedAt: new Date().toISOString() } },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'record_deleted', 'Deleted a loss.'),
          };
        });
        get().runMatching(accountId);
        syncNow(accountId);
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
        syncNow(accountId);
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
        syncNow(accountId);
      },

      restoreAccount: (accountId) => {
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, archived: false } : a)) }));
        syncNow(accountId);
      },

      deleteAccountPermanently: async (accountId) => {
        const s = get();
        // A cloud-backed submission: remove the cloud copy FIRST (Storage objects, then the
        // database row, which cascades to every dependent table) before touching local state. If
        // either cloud step fails, local state is left completely untouched and the broker sees a
        // real error — never a "deleted" submission that quietly still exists in their account.
        if (isSupabaseConfigured && s.currentUserId && s.cloudAccountIds[accountId]) {
          const filesResult = await cloudRepo.deleteSubmissionFiles(s.currentUserId, accountId);
          if (!filesResult.ok) return { ok: false, message: `Couldn't remove this submission's files from your account: ${filesResult.message}` };
          const deleteResult = await cloudRepo.deleteSubmissionCloud(accountId);
          if (!deleteResult.ok) return { ok: false, message: `Couldn't delete this submission from your account: ${deleteResult.message}` };
        }

        set((st) => {
          const { [accountId]: _doc, ...documents } = st.documents;
          const { [accountId]: _profile, ...riskProfiles } = st.riskProfiles;
          const { [accountId]: _matches, ...matchResults } = st.matchResults;
          const { [accountId]: _log, ...activityLog } = st.activityLog;
          const { [accountId]: _items, ...missingItems } = st.missingItems;
          const { [accountId]: _quotes, ...quotes } = st.quotes;
          const { [accountId]: _cloud, ...cloudAccountIds } = st.cloudAccountIds;
          const { [accountId]: _sync, ...syncStatus } = st.syncStatus;
          return {
            accounts: st.accounts.filter((a) => a.id !== accountId),
            documents,
            riskProfiles,
            matchResults,
            activityLog,
            missingItems,
            quotes,
            cloudAccountIds,
            syncStatus,
            activeAccountId: st.activeAccountId === accountId ? null : st.activeAccountId,
          };
        });
        return { ok: true };
      },

      // --- Account workflow -------------------------------------------------------------------
      // Every action below updates the record, appends a broker-meaningful activity event, and
      // pushes the submission to the cloud (a no-op for local-only accounts) — same pattern as the
      // Risk Profile edits above.

      updateAccountInfo: (accountId, patch) => {
        const before = get().accounts.find((a) => a.id === accountId);
        if (!before) return;
        const changes: string[] = [];
        if (patch.namedInsured !== undefined && patch.namedInsured.trim() && patch.namedInsured.trim() !== before.namedInsured) changes.push(`named insured to "${patch.namedInsured.trim()}"`);
        if (patch.state !== undefined && patch.state !== before.state) changes.push(`state to ${patch.state || '—'}`);
        if (changes.length === 0) return;
        set((s) => ({
          accounts: touchAccount(
            s.accounts.map((a) =>
              a.id === accountId
                ? { ...a, ...(patch.namedInsured?.trim() ? { namedInsured: patch.namedInsured.trim() } : {}), ...(patch.state !== undefined ? { state: patch.state } : {}) }
                : a
            ),
            accountId
          ),
          activityLog: appendEvent(s.activityLog, accountId, 'account_updated', `Changed ${changes.join(' and ')}.`),
        }));
        syncNow(accountId);
      },

      setAssignedBroker: (accountId, broker) => {
        set((s) => ({
          accounts: touchAccount(
            s.accounts.map((a) => (a.id === accountId ? { ...a, assignedBroker: broker ?? undefined } : a)),
            accountId
          ),
          activityLog: appendEvent(s.activityLog, accountId, 'broker_assigned', broker ? `Assigned to ${broker.name}.` : 'Removed the assigned broker.'),
        }));
        syncNow(accountId);
      },

      addContact: (accountId, contact) => {
        const id = generateId('contact');
        set((s) => {
          const account = s.accounts.find((a) => a.id === accountId);
          if (!account) return {};
          let contacts = [...getAccountContacts(account)];
          const makePrimary = contact.primary || contacts.length === 0;
          if (makePrimary) contacts = contacts.map((c) => ({ ...c, primary: false }));
          contacts.push({ ...contact, id, primary: makePrimary });
          return {
            accounts: touchAccount(s.accounts.map((a) => (a.id === accountId ? { ...a, contacts } : a)), accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'contact_added', `Added contact ${contact.name}${contact.role ? ` (${contact.role})` : ''}.`),
          };
        });
        syncNow(accountId);
        return id;
      },

      updateContact: (accountId, contactId, patch) => {
        set((s) => {
          const account = s.accounts.find((a) => a.id === accountId);
          if (!account) return {};
          let contacts = getAccountContacts(account).map((c) => (c.id === contactId ? { ...c, ...patch } : c));
          if (patch.primary) contacts = contacts.map((c) => ({ ...c, primary: c.id === contactId }));
          const name = contacts.find((c) => c.id === contactId)?.name ?? 'contact';
          return {
            accounts: touchAccount(s.accounts.map((a) => (a.id === accountId ? { ...a, contacts } : a)), accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'contact_updated', patch.primary && Object.keys(patch).length === 1 ? `Made ${name} the primary contact.` : `Updated contact ${name}.`),
          };
        });
        syncNow(accountId);
      },

      deleteContact: (accountId, contactId) => {
        set((s) => {
          const account = s.accounts.find((a) => a.id === accountId);
          if (!account) return {};
          const existing = getAccountContacts(account);
          const removed = existing.find((c) => c.id === contactId);
          let contacts = existing.filter((c) => c.id !== contactId);
          if (removed?.primary && contacts.length > 0 && !contacts.some((c) => c.primary)) contacts = contacts.map((c, i) => ({ ...c, primary: i === 0 }));
          return {
            // Legacy single-contact fields are cleared too, so a removed legacy contact doesn't reappear via the fallback.
            accounts: touchAccount(
              s.accounts.map((a) => (a.id === accountId ? { ...a, contacts, contactName: undefined, contactEmail: undefined, contactPhone: undefined } : a)),
              accountId
            ),
            activityLog: appendEvent(s.activityLog, accountId, 'contact_removed', `Removed contact ${removed?.name ?? ''}.`.replace(' .', '.')),
          };
        });
        syncNow(accountId);
      },

      addMissingItems: (accountId, seeds) => {
        if (seeds.length === 0) return [];
        const now = new Date().toISOString();
        const created: MissingItem[] = seeds.map((seed) => ({
          id: generateId('item'),
          accountId,
          type: seed.type,
          label: seed.label,
          status: seed.status ?? 'missing',
          templateKey: seed.templateKey,
          neededByQuoteId: seed.neededByQuoteId,
          notes: seed.notes,
          ...(seed.status === 'received' ? { receivedAt: now } : {}),
          createdAt: now,
          updatedAt: now,
        }));
        set((s) => ({
          missingItems: { ...s.missingItems, [accountId]: [...(s.missingItems[accountId] ?? []), ...created] },
          accounts: touchAccount(s.accounts, accountId),
          activityLog: appendEvent(
            s.activityLog,
            accountId,
            'item_added',
            created.length === 1 ? `Added "${created[0].label}" to the checklist.` : `Added ${created.length} items to the checklist: ${created.map((i) => i.label).join(', ')}.`
          ),
        }));
        syncNow(accountId);
        return created.map((i) => i.id);
      },

      updateMissingItem: (accountId, itemId, patch) => {
        const before = (get().missingItems[accountId] ?? []).find((i) => i.id === itemId);
        if (!before) return;
        set((s) => {
          let log = s.activityLog;
          if (patch.followUpDate !== undefined && patch.followUpDate !== before.followUpDate) {
            log = appendEvent(
              log,
              accountId,
              'follow_up_scheduled',
              patch.followUpDate ? `Client follow-up for "${before.label}" set for ${formatShortDate(patch.followUpDate)}.` : `Cleared the follow-up date for "${before.label}".`
            );
          }
          if (patch.label !== undefined && patch.label !== before.label) log = appendEvent(log, accountId, 'item_added', `Renamed checklist item "${before.label}" to "${patch.label}".`);
          return {
            missingItems: { ...s.missingItems, [accountId]: updateInList(s.missingItems[accountId], itemId, (i) => ({ ...i, ...patch, updatedAt: new Date().toISOString() })) },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: log,
          };
        });
        syncNow(accountId);
      },

      markItemsRequested: (accountId, itemIds, { contactId, followUpDate }) => {
        const s0 = get();
        const account = s0.accounts.find((a) => a.id === accountId);
        const items = (s0.missingItems[accountId] ?? []).filter((i) => itemIds.includes(i.id));
        if (!account || items.length === 0) return;
        const contact = getAccountContacts(account).find((c) => c.id === contactId);
        const now = new Date().toISOString();
        set((s) => {
          let log = appendEvent(
            s.activityLog,
            accountId,
            'item_requested',
            `Requested ${items.map((i) => i.label).join(', ')} from ${contact ? contact.name : 'the client'}.`
          );
          if (followUpDate) log = appendEvent(log, accountId, 'follow_up_scheduled', `Client follow-up scheduled for ${formatShortDate(followUpDate)}.`);
          return {
            missingItems: {
              ...s.missingItems,
              [accountId]: (s.missingItems[accountId] ?? []).map((i) =>
                itemIds.includes(i.id) ? { ...i, status: 'requested' as const, requestedAt: now, requestedFromContactId: contactId, followUpDate: followUpDate || undefined, updatedAt: now } : i
              ),
            },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: log,
          };
        });
        syncNow(accountId);
      },

      markItemReceived: (accountId, itemId, opts) => {
        const s0 = get();
        const item = (s0.missingItems[accountId] ?? []).find((i) => i.id === itemId);
        if (!item) return;
        const doc = opts?.documentId ? (s0.documents[accountId] ?? []).find((d) => d.id === opts.documentId) : undefined;
        const quote = item.neededByQuoteId ? (s0.quotes[accountId] ?? []).find((q) => q.id === item.neededByQuoteId) : undefined;
        const now = new Date().toISOString();
        set((s) => ({
          missingItems: {
            ...s.missingItems,
            [accountId]: updateInList(s.missingItems[accountId], itemId, (i) => ({
              ...i,
              status: 'received' as const,
              receivedAt: now,
              documentId: opts?.documentId ?? i.documentId,
              updatedAt: now,
            })),
          },
          accounts: touchAccount(s.accounts, accountId),
          activityLog: appendEvent(
            s.activityLog,
            accountId,
            'item_received',
            `Received ${item.label}${doc ? ` (${doc.name})` : ''}.${quote ? ` Ready to send to ${quote.marketName}.` : ''}`
          ),
        }));
        syncNow(accountId);
      },

      setItemStatus: (accountId, itemId, status) => {
        const item = (get().missingItems[accountId] ?? []).find((i) => i.id === itemId);
        if (!item || item.status === status) return;
        if (status === 'received') return get().markItemReceived(accountId, itemId);
        const now = new Date().toISOString();
        if (status === 'requested') {
          // Marked by hand (e.g. asked on the phone) — stamp it and arm a follow-up so it still lands on Today's Plate.
          const followUpDate = item.followUpDate ?? addBusinessDays(new Date(), 3);
          set((s) => ({
            missingItems: {
              ...s.missingItems,
              [accountId]: updateInList(s.missingItems[accountId], itemId, (i) => ({
                ...i,
                status,
                requestedAt: i.requestedAt ?? now,
                followUpDate,
                receivedAt: undefined,
                forwardedToCarrierAt: undefined,
                updatedAt: now,
              })),
            },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: appendEvent(s.activityLog, accountId, 'item_requested', `Marked "${item.label}" as ${MISSING_ITEM_STATUS_LABELS.requested.toLowerCase()} — follow up ${formatShortDate(followUpDate)}.`),
          }));
          syncNow(accountId);
          return;
        }
        set((s) => ({
          missingItems: {
            ...s.missingItems,
            [accountId]: updateInList(s.missingItems[accountId], itemId, (i) =>
              status === 'missing'
                ? { ...i, status, receivedAt: undefined, requestedAt: undefined, followUpDate: undefined, forwardedToCarrierAt: undefined, updatedAt: now }
                : { ...i, status, updatedAt: now }
            ),
          },
          accounts: touchAccount(s.accounts, accountId),
          activityLog: appendEvent(
            s.activityLog,
            accountId,
            status === 'waived' ? 'item_waived' : 'item_added',
            status === 'waived' ? `Waived "${item.label}" — not needed.` : `Moved "${item.label}" back to missing.`
          ),
        }));
        syncNow(accountId);
      },

      setAccountStage: (accountId, stage) => {
        const account = get().accounts.find((a) => a.id === accountId);
        if (!account || (account.stage ?? null) === stage) return;
        set((s) => ({
          accounts: touchAccount(
            s.accounts.map((a) => (a.id === accountId ? { ...a, stage: stage ?? undefined } : a)),
            accountId
          ),
          activityLog: appendEvent(
            s.activityLog,
            accountId,
            'stage_changed',
            stage ? `Status set to ${ACCOUNT_STAGE_LABELS[stage]}.` : 'Status set back to automatic.'
          ),
        }));
        syncNow(accountId);
      },

      deleteMissingItem: (accountId, itemId) => {
        const item = (get().missingItems[accountId] ?? []).find((i) => i.id === itemId);
        if (!item) return;
        set((s) => ({
          missingItems: { ...s.missingItems, [accountId]: (s.missingItems[accountId] ?? []).filter((i) => i.id !== itemId) },
          accounts: touchAccount(s.accounts, accountId),
          activityLog: appendEvent(s.activityLog, accountId, 'item_removed', `Removed "${item.label}" from the checklist.`),
        }));
        syncNow(accountId);
      },

      markItemSentToCarrier: (accountId, itemId) => {
        const s0 = get();
        const items = s0.missingItems[accountId] ?? [];
        const item = items.find((i) => i.id === itemId);
        const quote = item?.neededByQuoteId ? (s0.quotes[accountId] ?? []).find((q) => q.id === item.neededByQuoteId) : undefined;
        if (!item || !quote) return;
        const nowIso = new Date().toISOString();
        // Once nothing else this carrier asked for is still outstanding, the ball is back in the
        // carrier's court — flip the quote back to waiting and (re)arm a follow-up.
        const stillOutstanding = items.some((i) => i.id !== itemId && i.neededByQuoteId === quote.id && i.status !== 'waived' && !i.forwardedToCarrierAt);
        const reopen = quote.status === 'additional_info_requested' && !stillOutstanding;
        const followUp = reopen && (!quote.followUpDate || quote.followUpDate <= todayKey()) ? addBusinessDays(new Date(), 3) : quote.followUpDate;
        set((s) => {
          let log = appendEvent(s.activityLog, accountId, 'item_sent_to_carrier', `Sent ${item.label} to ${quote.marketName}.`);
          if (reopen) log = appendEvent(log, accountId, 'quote_status_changed', `${quote.marketName}: all requested items sent — waiting on carrier${followUp ? `, follow up ${formatShortDate(followUp)}` : ''}.`);
          return {
            missingItems: { ...s.missingItems, [accountId]: updateInList(s.missingItems[accountId], itemId, (i) => ({ ...i, forwardedToCarrierAt: nowIso, updatedAt: nowIso })) },
            quotes: {
              ...s.quotes,
              [accountId]: updateInList(s.quotes[accountId], quote.id, (q) => ({
                ...q,
                ...(reopen ? { status: 'waiting_on_carrier' as const, followUpDate: followUp } : {}),
                notes: [...q.notes, { id: generateId('note'), text: `Sent ${item.label}.`, createdAt: nowIso }],
                updatedAt: nowIso,
              })),
            },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: log,
          };
        });
        syncNow(accountId);
      },

      addQuote: (accountId, input) => {
        const now = new Date().toISOString();
        const status = input.status ?? 'preparing';
        const awaiting = AWAITING_CARRIER_STATUSES.includes(status);
        const quote: MarketQuote = {
          id: generateId('quote'),
          accountId,
          marketName: input.marketName.trim(),
          appetiteRecordId: input.appetiteRecordId,
          status,
          submittedAt: input.submittedAt ?? (awaiting ? todayKey() : undefined),
          followUpDate: input.followUpDate ?? (awaiting ? addBusinessDays(new Date(), 3) : undefined),
          notes: [],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => {
          let log = appendEvent(s.activityLog, accountId, 'market_added', `Added ${quote.marketName} to Markets & Quotes.`);
          if (awaiting) log = appendEvent(log, accountId, 'submission_sent', `Submission sent to ${quote.marketName}${quote.submittedAt ? ` on ${formatShortDate(quote.submittedAt)}` : ''}.`);
          if (quote.followUpDate) log = appendEvent(log, accountId, 'follow_up_scheduled', `Carrier follow-up with ${quote.marketName} set for ${formatShortDate(quote.followUpDate)}.`);
          return {
            quotes: { ...s.quotes, [accountId]: [...(s.quotes[accountId] ?? []), quote] },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: log,
          };
        });
        syncNow(accountId);
        return quote.id;
      },

      updateQuote: (accountId, quoteId, patch) => {
        const before = (get().quotes[accountId] ?? []).find((q) => q.id === quoteId);
        if (!before) return;
        const next: MarketQuote = { ...before, ...patch, updatedAt: new Date().toISOString() };
        const name = next.marketName;
        const statusChanged = patch.status !== undefined && patch.status !== before.status;

        // Moving into a "waiting on the carrier" state: default the sent date to today and arm a
        // follow-up, unless the broker already gave one.
        if (statusChanged && AWAITING_CARRIER_STATUSES.includes(next.status)) {
          if (!next.submittedAt) next.submittedAt = todayKey();
          if (patch.followUpDate === undefined && (!next.followUpDate || next.followUpDate < todayKey())) next.followUpDate = addBusinessDays(new Date(), 3);
        }
        if (patch.premium !== undefined && (patch.premium === null || Number.isNaN(patch.premium))) next.premium = undefined;

        const events: [ActivityEventType, string][] = [];
        if (statusChanged) {
          switch (next.status) {
            case 'submitted':
              events.push(['submission_sent', `Submission sent to ${name}${next.submittedAt ? ` on ${formatShortDate(next.submittedAt)}` : ''}.`]);
              break;
            case 'quoted':
              events.push(['quote_received', `${name} quoted${next.premium ? ` ${money(next.premium)}` : ''}.`]);
              break;
            case 'declined':
              events.push(['carrier_declined', `${name} declined${next.declineReason ? `: ${next.declineReason}` : '.'}`]);
              break;
            case 'bound':
              events.push(['policy_bound', `Bound with ${name}${next.premium ? ` at ${money(next.premium)}` : ''}.`]);
              break;
            default:
              events.push(['quote_status_changed', `${name}: ${QUOTE_STATUS_LABELS[before.status]} → ${QUOTE_STATUS_LABELS[next.status]}.`]);
          }
        } else {
          if (patch.premium !== undefined && next.premium !== before.premium && next.premium) events.push(['quote_received', `Recorded ${name} premium of ${money(next.premium)}.`]);
          if (patch.declineReason !== undefined && patch.declineReason !== before.declineReason && next.declineReason) events.push(['carrier_declined', `${name} decline reason: ${next.declineReason}`]);
          if (patch.submittedAt !== undefined && patch.submittedAt !== before.submittedAt && next.submittedAt) events.push(['submission_sent', `Recorded submission to ${name} as sent ${formatShortDate(next.submittedAt)}.`]);
          if (patch.marketName !== undefined && patch.marketName !== before.marketName) events.push(['quote_status_changed', `Renamed market ${before.marketName} to ${name}.`]);
        }
        if (next.followUpDate !== before.followUpDate && AWAITING_CARRIER_STATUSES.includes(next.status)) {
          events.push(['follow_up_scheduled', next.followUpDate ? `Carrier follow-up with ${name} set for ${formatShortDate(next.followUpDate)}.` : `Cleared the follow-up date for ${name}.`]);
        }

        set((s) => {
          let log = s.activityLog;
          for (const [type, message] of events) log = appendEvent(log, accountId, type, message);
          return {
            quotes: { ...s.quotes, [accountId]: updateInList(s.quotes[accountId], quoteId, () => next) },
            accounts: touchAccount(s.accounts, accountId),
            activityLog: log,
          };
        });
        syncNow(accountId);
      },

      addQuoteNote: (accountId, quoteId, text) => {
        const trimmed = text.trim();
        const quote = (get().quotes[accountId] ?? []).find((q) => q.id === quoteId);
        if (!trimmed || !quote) return;
        const now = new Date().toISOString();
        set((s) => ({
          quotes: {
            ...s.quotes,
            [accountId]: updateInList(s.quotes[accountId], quoteId, (q) => ({ ...q, notes: [...q.notes, { id: generateId('note'), text: trimmed, createdAt: now }], updatedAt: now })),
          },
          accounts: touchAccount(s.accounts, accountId),
          activityLog: appendEvent(s.activityLog, accountId, 'carrier_note_added', `Note on ${quote.marketName}: ${trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed}`),
        }));
        syncNow(accountId);
      },

      deleteQuote: (accountId, quoteId) => {
        const quote = (get().quotes[accountId] ?? []).find((q) => q.id === quoteId);
        if (!quote) return;
        set((s) => ({
          quotes: { ...s.quotes, [accountId]: (s.quotes[accountId] ?? []).filter((q) => q.id !== quoteId) },
          // Items this carrier asked for stay on the checklist (the client may still owe them), just no longer tied to a carrier.
          missingItems: { ...s.missingItems, [accountId]: (s.missingItems[accountId] ?? []).map((i) => (i.neededByQuoteId === quoteId ? { ...i, neededByQuoteId: undefined } : i)) },
          accounts: touchAccount(s.accounts, accountId),
          activityLog: appendEvent(s.activityLog, accountId, 'market_removed', `Removed ${quote.marketName} from Markets & Quotes.`),
        }));
        syncNow(accountId);
      },

      recordCarrierRequest: (accountId, quoteId, input) => {
        const quote = (get().quotes[accountId] ?? []).find((q) => q.id === quoteId);
        const label = input.label.trim();
        if (!quote || !label) return '';
        const now = new Date().toISOString();
        const item: MissingItem = {
          id: generateId('item'),
          accountId,
          type: input.type,
          label,
          status: 'missing',
          neededByQuoteId: quoteId,
          notes: input.notes?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          missingItems: { ...s.missingItems, [accountId]: [...(s.missingItems[accountId] ?? []), item] },
          quotes: {
            ...s.quotes,
            [accountId]: updateInList(s.quotes[accountId], quoteId, (q) => ({
              ...q,
              status: q.status === 'quoted' || q.status === 'bound' ? q.status : ('additional_info_requested' as const),
              notes: [...q.notes, { id: generateId('note'), text: `Requested ${label}.`, createdAt: now }],
              updatedAt: now,
            })),
          },
          accounts: touchAccount(s.accounts, accountId),
          activityLog: appendEvent(s.activityLog, accountId, 'carrier_requested_item', `${quote.marketName} requested ${label}.`),
        }));
        syncNow(accountId);
        return item.id;
      },

      setCurrentUserId: (userId) => set({ currentUserId: userId }),

      hydrateCloudSubmissions: async () => {
        const userId = get().currentUserId;
        if (!isSupabaseConfigured || !userId) return;
        const result = await cloudRepo.fetchUserSubmissions(userId);
        if (!result.ok) return; // transient fetch failure — leave local state exactly as it was, never clobber it with nothing
        set((s) => {
          const accounts = [...s.accounts];
          const documents = { ...s.documents };
          const riskProfiles = { ...s.riskProfiles };
          const activityLog = { ...s.activityLog };
          const missingItems = { ...s.missingItems };
          const quotes = { ...s.quotes };
          const cloudAccountIds = { ...s.cloudAccountIds };
          for (const bundle of result.data) {
            const idx = accounts.findIndex((a) => a.id === bundle.account.id);
            if (idx === -1) accounts.push(bundle.account);
            else accounts[idx] = bundle.account; // cloud is authoritative for an already-known cloud account
            documents[bundle.account.id] = bundle.documents;
            riskProfiles[bundle.account.id] = bundle.profile;
            activityLog[bundle.account.id] = bundle.activity;
            // undefined = the workflow columns don't exist yet (migration 0007 not applied) — keep
            // whatever this device has rather than wiping it with an empty list.
            if (bundle.missingItems) missingItems[bundle.account.id] = bundle.missingItems;
            if (bundle.quotes) quotes[bundle.account.id] = bundle.quotes;
            cloudAccountIds[bundle.account.id] = true;
          }
          return { accounts, documents, riskProfiles, activityLog, missingItems, quotes, cloudAccountIds };
        });
        for (const bundle of result.data) get().runMatching(bundle.account.id);
      },

      importAccountsToCloud: async (accountIds) => {
        const userId = get().currentUserId;
        if (!isSupabaseConfigured || !userId) return;
        set((s) => ({
          cloudAccountIds: { ...s.cloudAccountIds, ...Object.fromEntries(accountIds.map((id) => [id, true as const])) },
          dismissedImportIds: { ...s.dismissedImportIds, ...Object.fromEntries(accountIds.map((id) => [id, true as const])) },
        }));
        for (const accountId of accountIds) syncNow(accountId);
      },

      dismissLocalImport: (accountIds) => {
        set((s) => ({ dismissedImportIds: { ...s.dismissedImportIds, ...Object.fromEntries(accountIds.map((id) => [id, true as const])) } }));
      },
      };
    },
    {
      name: 'renewaliq.state.v1',
      // effectiveAppetiteRecords is derived (base + fetched overrides), re-loaded on demand — never
      // persisted, so a stale override can't get stuck in one broker's browser after an admin change.
      partialize: (state) => {
        // effectiveAppetiteRecords: derived, always re-fetched — see its own comment above.
        // currentUserId: re-derived from the live Supabase session on load, never trusted from a
        // stale persisted value (see App.tsx's bootstrap effect).
        // syncStatus: a snapshot of in-flight/last save outcome — meaningless across a reload.
        const { effectiveAppetiteRecords: _effectiveAppetiteRecords, currentUserId: _currentUserId, syncStatus: _syncStatus, ...rest } = state;
        return rest;
      },
    }
  )
);
