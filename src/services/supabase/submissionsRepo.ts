import { supabase } from './client';
import type { Account, AccountStage, ActivityEvent, AssignedBroker, FollowUp, Contact, CoverageType, DriverEntry, FieldValue, LossEntry, MarketQuote, MissingItem, RiskProfile, UploadedDocument, VehicleEntry } from '../../types';
import { emptyField } from '../../types';
import { isDuration, toMonths } from '../../utils/duration';
import { createEmptyRiskProfile } from '../extraction/emptyRiskProfile';

export type RepoResult<T = void> = { ok: true; data: T } | { ok: false; message: string };

/**
 * The cloud persistence layer for broker submissions — see supabase/migrations/0003_broker_workspaces.sql
 * for the schema this reads/writes. Deliberately a "full snapshot mirror" rather than fine-grained
 * per-field sync: every save re-derives and replaces the itemized child rows (field_values,
 * field_alternates, vehicles, drivers, losses, coverage_lines) for one submission from the current
 * local RiskProfile, rather than diffing and patching individual rows. At this app's scale (dozens
 * of fields, a handful of itemized rows per submission) that trade-off buys a much smaller, harder
 * to get subtly wrong sync surface than incremental patching across 20+ call sites — the local
 * Zustand state (already the fully-tested source of truth for merge/conflict logic) is simply
 * mirrored outward as-is. `documents` is the one exception — its rows are upserted by id, never
 * bulk-replaced, so `storage_path` (set once, after the file upload completes) is never clobbered
 * by a later unrelated field edit's snapshot save.
 *
 * Every exported function fails soft with `{ ok: false, message }` — including when Supabase isn't
 * configured — never throws, so a caller always has a clean way to surface "failed to save" instead
 * of an unhandled rejection.
 */

const NOT_CONFIGURED: RepoResult<never> = { ok: false, message: 'Cloud sync is not configured in this environment.' };

function fail(message: string): RepoResult<never> {
  return { ok: false, message };
}

// ---------------------------------------------------------------------------------------------
// Mapping helpers: local RiskProfile <-> flat DB rows
// ---------------------------------------------------------------------------------------------

interface FieldValueRow {
  id: string;
  submission_id: string;
  user_id: string;
  section: 'business' | 'transportation' | 'coverage';
  field_key: string;
  value: unknown;
  confidence: string;
  is_missing: boolean;
  is_conflicting: boolean;
  extraction_method: string | null;
  source_document_id: string | null;
  source_page: number | null;
  source_excerpt: string | null;
  last_updated_at: string | null;
}

interface FieldAlternateRow {
  id: string;
  field_value_id: string;
  user_id: string;
  value: unknown;
  extraction_method: string | null;
  source_document_id: string | null;
  source_page: number | null;
  source_excerpt: string | null;
}

function fieldValueId(submissionId: string, section: string, fieldKey: string): string {
  return `${submissionId}::${section}::${fieldKey}`;
}

function toFieldValueRow(submissionId: string, userId: string, section: FieldValueRow['section'], fieldKey: string, field: FieldValue<unknown>): FieldValueRow {
  return {
    id: fieldValueId(submissionId, section, fieldKey),
    submission_id: submissionId,
    user_id: userId,
    section,
    field_key: fieldKey,
    value: field.value,
    confidence: field.confidence,
    is_missing: field.isMissing,
    is_conflicting: field.isConflicting,
    extraction_method: field.extractionMethod ?? null,
    source_document_id: field.source?.documentId ?? null,
    source_page: field.source?.page ?? null,
    source_excerpt: field.source?.excerpt ?? null,
    last_updated_at: field.lastUpdatedAt ?? null,
  };
}

function fromFieldValueRow<T>(row: FieldValueRow, alternates: FieldAlternateRow[]): FieldValue<T> {
  return {
    value: row.value as T | null,
    confidence: row.confidence as FieldValue<T>['confidence'],
    isMissing: row.is_missing,
    isConflicting: row.is_conflicting,
    extractionMethod: (row.extraction_method as FieldValue<T>['extractionMethod']) ?? undefined,
    lastUpdatedAt: row.last_updated_at ?? undefined,
    source: row.source_document_id
      ? { documentId: row.source_document_id, documentName: '', page: row.source_page ?? undefined, excerpt: row.source_excerpt ?? undefined }
      : undefined,
    alternateValues: alternates.length
      ? alternates.map((a) => ({
          value: a.value as T,
          extractionMethod: (a.extraction_method as FieldValue<T>['extractionMethod']) ?? undefined,
          source: { documentId: a.source_document_id ?? '', documentName: '', page: a.source_page ?? undefined, excerpt: a.source_excerpt ?? undefined },
        }))
      : undefined,
  };
}

function collectFieldValueRows(userId: string, submissionId: string, profile: RiskProfile): { values: FieldValueRow[]; alternates: FieldAlternateRow[] } {
  const values: FieldValueRow[] = [];
  const alternates: FieldAlternateRow[] = [];

  function push(section: FieldValueRow['section'], fieldKey: string, field: FieldValue<unknown> | undefined) {
    if (!field) return;
    const row = toFieldValueRow(submissionId, userId, section, fieldKey, field);
    values.push(row);
    (field.alternateValues ?? []).forEach((alt, i) => {
      alternates.push({
        id: `${row.id}::alt::${i}`,
        field_value_id: row.id,
        user_id: userId,
        value: alt.value,
        extraction_method: alt.extractionMethod ?? null,
        source_document_id: alt.source?.documentId ?? null,
        source_page: alt.source?.page ?? null,
        source_excerpt: alt.source?.excerpt ?? null,
      });
    });
  }

  const businessFields = profile.business as unknown as Record<string, FieldValue<unknown>>;
  const transportationFields = profile.transportation as unknown as Record<string, FieldValue<unknown>>;
  for (const key of Object.keys(profile.business)) push('business', key, businessFields[key]);
  for (const key of Object.keys(profile.transportation)) push('transportation', key, transportationFields[key]);
  for (const line of profile.coverage) {
    if (line.currentLimit) push('coverage', `${line.type}.currentLimit`, line.currentLimit);
    push('coverage', `${line.type}.requestedLimit`, line.requestedLimit);
  }

  return { values, alternates };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export interface CloudSubmissionBundle {
  account: Account;
  profile: RiskProfile;
  documents: UploadedDocument[];
  activity: ActivityEvent[];
  /** undefined when the workflow columns don't exist yet (migration 0007 not applied) — callers must keep local data in that case rather than treat it as "no items". */
  missingItems?: MissingItem[];
  quotes?: MarketQuote[];
  /** Whether the project has 0007's workflow columns / 0008's stage column — when not, the cloud simply can't hold those fields, and the local values must be kept on hydrate. */
  hasWorkflowColumns: boolean;
  hasStageColumn: boolean;
  /** undefined when 0009 isn't applied. */
  followUps?: FollowUp[];
}

/**
 * Account workflow data (contacts, assigned broker, checklist items, market quotes) lives in jsonb
 * columns on `submissions` (see 0007_account_workflow.sql) rather than new tables: it's always read
 * and written together with the submission, the existing owner-only RLS on `submissions` covers
 * it with no new policies, and it keeps this file's full-snapshot save a single upsert.
 */
const WORKFLOW_COLUMNS = ['contacts', 'assigned_broker', 'missing_items', 'market_quotes', 'stage', 'follow_ups'] as const;

function isMissingWorkflowColumnError(error: { message: string; code?: string }): boolean {
  return error.code === 'PGRST204' || error.code === '42703' || WORKFLOW_COLUMNS.some((c) => error.message.includes(`'${c}'`) || error.message.includes(`"${c}"`));
}

function isMissingColumnError(error: { message: string; code?: string }, columns: string[]): boolean {
  return error.code === 'PGRST204' || error.code === '42703' || columns.some((c) => error.message.includes(`'${c}'`) || error.message.includes(`"${c}"`));
}

function asArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined;
}

function normalizeQuotes(value: unknown, accountId: string): MarketQuote[] | undefined {
  const arr = asArray<Partial<MarketQuote>>(value);
  if (!arr) return undefined;
  return arr
    .filter((q): q is Partial<MarketQuote> & { id: string; marketName: string } => !!q && typeof q.id === 'string' && typeof q.marketName === 'string')
    .map((q) => ({ ...q, accountId, status: q.status ?? 'preparing', notes: Array.isArray(q.notes) ? q.notes : [], createdAt: q.createdAt ?? new Date().toISOString(), updatedAt: q.updatedAt ?? new Date().toISOString() }) as MarketQuote);
}

function normalizeItems(value: unknown, accountId: string): MissingItem[] | undefined {
  const arr = asArray<Partial<MissingItem>>(value);
  if (!arr) return undefined;
  return arr
    .filter((i): i is Partial<MissingItem> & { id: string; label: string } => !!i && typeof i.id === 'string' && typeof i.label === 'string')
    .map((i) => ({ ...i, accountId, type: i.type ?? 'document', status: i.status ?? 'missing', createdAt: i.createdAt ?? new Date().toISOString(), updatedAt: i.updatedAt ?? new Date().toISOString() }) as MissingItem);
}

/**
 * Reads every row of a table the signed-in user may see, in pages — Supabase caps a single select at
 * 1000 rows by default, and an agency admin's pull spans every agent's accounts, so a silently
 * truncated read here would later be saved back as data loss. No user filter: Row Level Security
 * (0011_agency_roles.sql) decides what comes back — an agent's own accounts, or the whole agency
 * for an admin.
 */
async function selectAllVisible(table: string) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase!.from(table).select('*').order('id').range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: rows, error: null };
  }
}

/** Fetches every submission the current user can access (RLS-scoped), fully hydrated. Used on sign-in to populate the workspace. */
export async function fetchUserSubmissions(_userId: string): Promise<RepoResult<CloudSubmissionBundle[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const [subsRes, fvRes, faRes, covRes, vehRes, drvRes, lossRes, docRes, actRes] = await Promise.all(
      ['submissions', 'field_values', 'field_alternates', 'coverage_lines', 'vehicles', 'drivers', 'losses', 'documents', 'activity_events'].map(selectAllVisible)
    );
    const errored = [subsRes, fvRes, faRes, covRes, vehRes, drvRes, lossRes, docRes, actRes].find((r) => r.error);
    if (errored?.error) return fail(errored.error.message);

    const bundles: CloudSubmissionBundle[] = (subsRes.data ?? []).map((sub) => {
      const account: Account = {
        id: sub.id,
        namedInsured: sub.named_insured,
        state: sub.state ?? '',
        status: sub.status,
        archived: sub.archived,
        createdAt: sub.created_at,
        updatedAt: sub.updated_at,
        ...(sub.contact_name ? { contactName: sub.contact_name } : {}),
        ...(sub.contact_email ? { contactEmail: sub.contact_email } : {}),
        ...(sub.contact_phone ? { contactPhone: sub.contact_phone } : {}),
        ...(Array.isArray(sub.contacts) ? { contacts: sub.contacts as Contact[] } : {}),
        ...(sub.assigned_broker && typeof sub.assigned_broker === 'object' ? { assignedBroker: sub.assigned_broker as AssignedBroker } : {}),
        ...(sub.stage ? { stage: sub.stage as AccountStage } : {}),
        // Set by the database (0011) — never sent back on save, so the app can't grant itself access.
        ...(sub.organization_id ? { agencyId: sub.organization_id as string } : {}),
        ...(sub.assigned_user_id !== undefined ? { assignedUserId: (sub.assigned_user_id as string | null) ?? null } : {}),
      };

      const fvRowsForSub = (fvRes.data ?? []).filter((r) => r.submission_id === sub.id);
      const business: Record<string, FieldValue<unknown>> = {};
      const transportation: Record<string, FieldValue<unknown>> = {};
      const coverageLimits: Record<string, { currentLimit?: FieldValue<string>; requestedLimit?: FieldValue<string> }> = {};

      for (const row of fvRowsForSub) {
        const alts = (faRes.data ?? []).filter((a) => a.field_value_id === row.id);
        const fv = fromFieldValueRow(row, alts);
        if (row.section === 'business') business[row.field_key] = fv;
        else if (row.section === 'transportation') transportation[row.field_key] = fv;
        else {
          const [type, sub2] = row.field_key.split('.');
          coverageLimits[type] ??= {};
          if (sub2 === 'currentLimit') coverageLimits[type].currentLimit = fv as FieldValue<string>;
          else coverageLimits[type].requestedLimit = fv as FieldValue<string>;
        }
      }

      const coverage = (covRes.data ?? [])
        .filter((c) => c.submission_id === sub.id)
        .map((c) => ({
          type: c.coverage_type as CoverageType,
          currentLimit: coverageLimits[c.coverage_type]?.currentLimit,
          requestedLimit: coverageLimits[c.coverage_type]?.requestedLimit ?? emptyField<string>(),
        }));

      const vehicles: VehicleEntry[] = (vehRes.data ?? [])
        .filter((v) => v.submission_id === sub.id)
        .map((v) => ({
          id: v.id,
          vin: v.vin ?? undefined,
          make: v.make ?? undefined,
          model: v.model ?? undefined,
          year: v.year ?? undefined,
          value: v.value ?? undefined,
          bodyType: v.body_type ?? undefined,
          isManual: v.is_manual,
          lastUpdatedAt: v.last_updated_at ?? undefined,
          source: v.source_document_id ? { documentId: v.source_document_id, documentName: '', page: v.source_page ?? undefined, excerpt: v.source_excerpt ?? undefined } : undefined,
        }));

      const drivers: DriverEntry[] = (drvRes.data ?? [])
        .filter((d) => d.submission_id === sub.id)
        .map((d) => ({
          id: d.id,
          name: d.name ?? undefined,
          dob: d.dob ?? undefined,
          licenseState: d.license_state ?? undefined,
          // 0010's experience_months (exact) when present; otherwise the legacy whole-years int.
          yearsExperience: d.experience_months != null ? (d.experience_or_more ? { months: d.experience_months, orMore: true } : { months: d.experience_months }) : (d.years_experience ?? undefined),
          violations: d.violations ?? undefined,
          isManual: d.is_manual,
          lastUpdatedAt: d.last_updated_at ?? undefined,
          source: d.source_document_id ? { documentId: d.source_document_id, documentName: '', page: d.source_page ?? undefined, excerpt: d.source_excerpt ?? undefined } : undefined,
        }));

      const lossHistory: LossEntry[] = (lossRes.data ?? [])
        .filter((l) => l.submission_id === sub.id)
        .map((l) => ({
          id: l.id,
          lossDate: l.loss_date,
          claimType: l.claim_type,
          paid: Number(l.paid),
          reserved: Number(l.reserved),
          incurred: Number(l.incurred),
          status: l.status,
          isManual: l.is_manual,
          lastUpdatedAt: l.last_updated_at ?? undefined,
          source: l.source_document_id ? { documentId: l.source_document_id, documentName: '', page: l.source_page ?? undefined, excerpt: l.source_excerpt ?? undefined } : undefined,
        }));

      const documents: UploadedDocument[] = (docRes.data ?? [])
        .filter((d) => d.submission_id === sub.id)
        .map((d) => ({
          id: d.id,
          accountId: sub.id,
          name: d.name,
          fileType: d.file_type,
          category: d.category,
          status: d.status,
          sizeBytes: Number(d.size_bytes),
          fieldsExtracted: d.fields_extracted ?? undefined,
          warnings: (d.warnings as string[] | null) ?? undefined,
          previewDataUrl: d.preview_data_url ?? undefined,
          // Needed to fetch the original file for preview — dropping it made every cloud-loaded document unpreviewable.
          storagePath: d.storage_path ?? undefined,
          ...(d.source_url ? { sourceUrl: d.source_url as string } : {}),
          uploadedAt: d.uploaded_at,
        }));

      const activity: ActivityEvent[] = (actRes.data ?? [])
        .filter((e) => e.submission_id === sub.id)
        .map((e) => ({ id: e.id, accountId: sub.id, type: e.type, message: e.message, timestamp: e.occurred_at, actorId: e.user_id ?? undefined, ...(e.actor_name ? { actorName: e.actor_name as string } : {}) }))
        .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

      const emptyProfile = createEmptyRiskProfile(sub.id);
      const profile: RiskProfile = {
        id: `risk_${sub.id}`,
        accountId: sub.id,
        // Start from an empty profile so a field with no row (saved before that field existed) reads
        // as missing instead of undefined.
        business: { ...emptyProfile.business, ...business } as unknown as RiskProfile['business'],
        transportation: { ...emptyProfile.transportation, ...transportation } as unknown as RiskProfile['transportation'],
        coverage,
        vehicles,
        drivers,
        lossHistory,
        updatedAt: sub.updated_at,
      };

      const hasWorkflowColumns = 'missing_items' in sub;
      return {
        account,
        profile,
        documents,
        activity,
        hasWorkflowColumns,
        hasStageColumn: 'stage' in sub,
        followUps: 'follow_ups' in sub ? (Array.isArray(sub.follow_ups) ? (sub.follow_ups as FollowUp[]).filter((f) => f && typeof f.id === 'string').map((f) => ({ ...f, accountId: sub.id })) : []) : undefined,
        missingItems: hasWorkflowColumns ? (normalizeItems(sub.missing_items, sub.id) ?? []) : undefined,
        quotes: hasWorkflowColumns ? (normalizeQuotes(sub.market_quotes, sub.id) ?? []) : undefined,
      };
    });

    return { ok: true, data: bundles };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not load your account data.');
  }
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/** Upserts everything for one submission — the account header, every scalar field + its conflict history, itemized rows, and coverage lines. Documents are handled separately (see upsertDocumentMetadata) since a document's storage_path must never be clobbered by an unrelated field edit. */
export async function saveSubmissionSnapshot(
  userId: string,
  account: Account,
  profile: RiskProfile,
  workflow?: { missingItems: MissingItem[]; quotes: MarketQuote[]; followUps?: FollowUp[] }
): Promise<RepoResult & { headerSaved: boolean; coreSaved: boolean }> {
  if (!supabase) return { ...NOT_CONFIGURED, headerSaved: false, coreSaved: false };
  // headerSaved: whether the `submissions` row itself landed — callers only write rows that
  // reference it (activity_events has a foreign key onto it) once it has, even when some other
  // part of the snapshot couldn't be saved (e.g. a migration not applied yet).
  let headerSaved = false;
  // coreSaved: the row AND the Risk Profile's rows (fields, coverage, vehicles, drivers, losses)
  // all landed — only workflow columns from a not-yet-applied migration may still be missing.
  let coreSaved = false;
  try {
    const legacyRow = {
      id: account.id,
      user_id: userId,
      named_insured: account.namedInsured,
      state: account.state || null,
      status: account.status,
      archived: account.archived,
      created_at: account.createdAt,
      updated_at: account.updatedAt,
      contact_name: account.contactName || null,
      contact_email: account.contactEmail || null,
      contact_phone: account.contactPhone || null,
    };
    const workflowRow = {
      ...legacyRow,
      contacts: account.contacts ?? null,
      assigned_broker: account.assignedBroker ?? null,
      ...(workflow ? { missing_items: workflow.missingItems, market_quotes: workflow.quotes } : {}),
    };
    const stageRow = { ...workflowRow, stage: account.stage ?? null };
    const submissionRow = { ...stageRow, ...(workflow?.followUps ? { follow_ups: workflow.followUps } : {}) };
    // A project that hasn't applied the newest migrations still saves everything it can (so the
    // Risk Profile never stops syncing), stepping down one migration at a time — 0009 (follow-ups),
    // 0008 (stage), then 0007 (workflow) — and reports the gap honestly instead of claiming "Saved".
    const attempts: { row: Record<string, unknown>; missing: string }[] = [
      { row: submissionRow, missing: '' },
      { row: stageRow, missing: 'Follow-ups were not saved to your account — the database needs migration 0009_account_follow_ups.sql.' },
      { row: workflowRow, missing: 'Status and follow-ups were not saved to your account — the database needs migrations 0008_account_stage.sql and 0009_account_follow_ups.sql.' },
      { row: legacyRow, missing: 'Contacts, checklist, quotes, status, and follow-ups were not saved to your account — the database needs migrations 0007, 0008 and 0009 (see SUPABASE_SETUP.md).' },
    ];
    let notSavedMessage: string | null = null;
    let subErr: { message: string; code?: string } | null = null;
    for (const attempt of attempts) {
      ({ error: subErr } = await supabase.from('submissions').upsert(attempt.row));
      notSavedMessage = attempt.missing || null;
      if (!subErr || !isMissingWorkflowColumnError(subErr)) break;
    }
    if (subErr) return { ...fail(subErr.message), headerSaved, coreSaved };
    headerSaved = true;

    const { values, alternates } = collectFieldValueRows(userId, account.id, profile);

    // Delete-then-reinsert for the itemized/child tables — see file header for why this is an
    // acceptable trade-off at this app's scale.
    const del = await Promise.all([
      supabase.from('field_values').delete().eq('submission_id', account.id),
      supabase.from('coverage_lines').delete().eq('submission_id', account.id),
      supabase.from('vehicles').delete().eq('submission_id', account.id),
      supabase.from('drivers').delete().eq('submission_id', account.id),
      supabase.from('losses').delete().eq('submission_id', account.id),
    ]);
    const delErr = del.find((r) => r.error);
    if (delErr?.error) return { ...fail(delErr.error.message), headerSaved, coreSaved };

    const inserts: PromiseLike<{ error: { message: string } | null }>[] = [];
    let driverMonthsNotSaved = false;
    if (values.length) inserts.push(supabase.from('field_values').insert(values));
    if (profile.coverage.length) {
      inserts.push(
        supabase.from('coverage_lines').insert(profile.coverage.map((c) => ({ id: `${account.id}::cov::${c.type}`, submission_id: account.id, user_id: userId, coverage_type: c.type })))
      );
    }
    if (profile.vehicles.length) {
      inserts.push(
        supabase.from('vehicles').insert(
          profile.vehicles.map((v) => ({
            id: v.id,
            submission_id: account.id,
            user_id: userId,
            vin: v.vin ?? null,
            make: v.make ?? null,
            model: v.model ?? null,
            year: v.year ?? null,
            value: v.value ?? null,
            body_type: v.bodyType ?? null,
            is_manual: !!v.isManual,
            source_document_id: v.source?.documentId ?? null,
            source_page: v.source?.page ?? null,
            source_excerpt: v.source?.excerpt ?? null,
            last_updated_at: v.lastUpdatedAt ?? null,
          }))
        )
      );
    }
    if (profile.drivers.length) {
      const driverRows = profile.drivers.map((d) => {
        const months = toMonths(d.yearsExperience);
        return {
          id: d.id,
          submission_id: account.id,
          user_id: userId,
          name: d.name ?? null,
          dob: d.dob ?? null,
          license_state: d.licenseState ?? null,
          // int column: whole years for older readers; the exact months go in 0010's columns.
          years_experience: months === null ? null : Math.floor(months / 12),
          experience_months: months,
          experience_or_more: months === null ? null : isDuration(d.yearsExperience) ? !!d.yearsExperience.orMore : false,
          violations: d.violations ?? null,
          is_manual: !!d.isManual,
          source_document_id: d.source?.documentId ?? null,
          source_page: d.source?.page ?? null,
          source_excerpt: d.source?.excerpt ?? null,
          last_updated_at: d.lastUpdatedAt ?? null,
        };
      });
      inserts.push(
        (async () => {
          const res = await supabase.from('drivers').insert(driverRows);
          if (!res.error || !isMissingColumnError(res.error, ['experience_months', 'experience_or_more'])) return res;
          // 0010 not applied: save whole years like before, and say months weren't kept.
          driverMonthsNotSaved = true;
          return supabase.from('drivers').insert(driverRows.map(({ experience_months: _m, experience_or_more: _o, ...rest }) => rest));
        })()
      );
    }
    if (profile.lossHistory.length) {
      inserts.push(
        supabase.from('losses').insert(
          profile.lossHistory.map((l) => ({
            id: l.id,
            submission_id: account.id,
            user_id: userId,
            loss_date: l.lossDate,
            claim_type: l.claimType,
            paid: l.paid,
            reserved: l.reserved,
            incurred: l.incurred,
            status: l.status,
            is_manual: !!l.isManual,
            source_document_id: l.source?.documentId ?? null,
            source_page: l.source?.page ?? null,
            source_excerpt: l.source?.excerpt ?? null,
            last_updated_at: l.lastUpdatedAt ?? null,
          }))
        )
      );
    }
    if (alternates.length) inserts.push(supabase.from('field_alternates').insert(alternates));

    const insRes = await Promise.all(inserts);
    const insErr = insRes.find((r) => r.error);
    if (insErr?.error) return { ...fail(insErr.error.message), headerSaved, coreSaved };
    coreSaved = true;

    if (notSavedMessage) return { ...fail(notSavedMessage), headerSaved, coreSaved };
    if (driverMonthsNotSaved) return { ...fail('Driver experience was saved as whole years only — the database needs migration 0010_driver_experience_months.sql to keep months.'), headerSaved, coreSaved };
    return { ok: true, data: undefined, headerSaved, coreSaved };
  } catch (err) {
    return { ...fail(err instanceof Error ? err.message : 'Could not save to your account.'), headerSaved, coreSaved };
  }
}

export async function upsertDocumentMetadata(userId: string, accountId: string, doc: UploadedDocument, storagePath: string | null): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const row: Record<string, unknown> = {
      id: doc.id,
      submission_id: accountId,
      user_id: userId,
      name: doc.name,
      file_type: doc.fileType,
      category: doc.category,
      status: doc.status,
      size_bytes: doc.sizeBytes,
      fields_extracted: doc.fieldsExtracted ?? null,
      warnings: doc.warnings ?? null,
      storage_path: storagePath,
      preview_data_url: doc.previewDataUrl ?? null,
      uploaded_at: doc.uploadedAt,
    };
    let { error } = await supabase.from('documents').upsert(doc.sourceUrl ? { ...row, source_url: doc.sourceUrl } : row);
    // 0015 not applied yet: save the document without its link.
    if (error && doc.sourceUrl && isMissingColumnError(error, ['source_url'])) ({ error } = await supabase.from('documents').upsert(row));
    if (error) return fail(error.message);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not save this document.');
  }
}

export async function deleteDocumentRow(documentId: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { error } = await supabase.from('documents').delete().eq('id', documentId);
    if (error) return fail(error.message);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not delete this document.');
  }
}

export async function appendActivityEvents(userId: string, accountId: string, events: ActivityEvent[]): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  if (events.length === 0) return { ok: true, data: undefined };
  try {
    // ignoreDuplicates = INSERT … ON CONFLICT DO NOTHING. activity_events is append-only (no UPDATE
    // policy, by design — see 0003), so a plain upsert re-sending already-saved events was rejected
    // by RLS on every save after the first, failing the whole sync ("Failed to save to your account")
    // and silently dropping every new event from the cloud copy.
    const rows = events.map((e) => ({ id: e.id, submission_id: accountId, user_id: userId, type: e.type, message: e.message, occurred_at: e.timestamp, actor_name: e.actorName ?? null }));
    let { error } = await supabase.from('activity_events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    // 0014 not applied yet: save without the name (user_id still records who).
    if (error && isMissingColumnError(error, ['actor_name'])) {
      ({ error } = await supabase.from('activity_events').upsert(rows.map(({ actor_name: _n, ...rest }) => rest), { onConflict: 'id', ignoreDuplicates: true }));
    }
    if (error) return fail(error.message);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not save activity history.');
  }
}

/** Deletes a submission and (via ON DELETE CASCADE) every dependent row — field_values, field_alternates, coverage_lines, vehicles, drivers, losses, documents, activity_events. Does not touch Storage objects; callers should list and remove those first (see deleteSubmissionFiles). */
export async function deleteSubmissionCloud(submissionId: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { error } = await supabase.from('submissions').delete().eq('id', submissionId);
    if (error) return fail(error.message);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not delete this submission.');
  }
}

// ---------------------------------------------------------------------------------------------
// Agency access (0011_agency_roles.sql). Roles live in `profiles`, written only from the SQL
// editor; these reads just tell the UI what the database will already allow.
// ---------------------------------------------------------------------------------------------

export interface AgencyAccess {
  agencyId: string;
  agencyName: string | null;
  role: 'agent' | 'admin';
}

export interface AgencyMember {
  userId: string;
  role: 'agent' | 'admin';
  name: string;
  email: string | null;
}

/**
 * The signed-in user's agency role, plus (admins only — RLS returns just your own row to an agent)
 * the agency's members. `access: null` = not in an agency (0011 not applied, or no profile yet):
 * the app behaves exactly as before, owner-only.
 */
export async function fetchAgencyAccess(userId: string): Promise<RepoResult<{ access: AgencyAccess | null; members: AgencyMember[] }>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.from('profiles').select('user_id, agency_id, role, display_name, email');
    if (error) {
      // 0011 not applied yet — no agency features, nothing else changes.
      if (error.code === '42P01' || error.code === 'PGRST205' || /profiles/.test(error.message)) return { ok: true, data: { access: null, members: [] } };
      return fail(error.message);
    }
    const rows = data ?? [];
    const mine = rows.find((r) => r.user_id === userId);
    if (!mine) return { ok: true, data: { access: null, members: [] } };
    const { data: agency } = await supabase.from('agencies').select('name').eq('id', mine.agency_id).maybeSingle();
    const members: AgencyMember[] = rows
      .filter((r) => r.agency_id === mine.agency_id)
      .map((r) => ({ userId: r.user_id, role: r.role, name: (r.display_name as string | null) || (r.email as string | null) || 'Unnamed', email: r.email ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, data: { access: { agencyId: mine.agency_id, agencyName: agency?.name ?? null, role: mine.role }, members } };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not load agency access.');
  }
}

/** Admin: give an account to another agent (or null = unassigned, admins only). The database trigger rejects this for non-admins and for users outside the agency. */
export async function assignSubmission(submissionId: string, userId: string | null): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.from('submissions').update({ assigned_user_id: userId }).eq('id', submissionId).select('id');
    if (error) return fail(error.message);
    if (!data || data.length === 0) return fail('This account could not be reassigned — it may not be saved to the cloud yet, or you no longer have access to it.');
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not reassign this account.');
  }
}

/**
 * For accounts this device has but the cloud didn't return: true = the account exists but this
 * user can no longer see it (reassigned away / access removed) → drop the local copy; false = it
 * never reached the cloud (or was deleted) → keep it, exactly as before. Unknown on any error.
 */
export async function submissionsRevoked(ids: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (!supabase || ids.length === 0) return out;
  await Promise.all(
    ids.map(async (id) => {
      const { data, error } = await supabase!.rpc('submission_exists', { p_submission_id: id });
      if (!error && data === true) out[id] = true;
    })
  );
  return out;
}

// ---------------------------------------------------------------------------------------------
// Storage (private submission-documents bucket)
// ---------------------------------------------------------------------------------------------

const BUCKET = 'submission-documents';

function storagePathFor(userId: string, accountId: string, documentId: string, filename: string): string {
  return `${userId}/${accountId}/${documentId}/${filename}`;
}

export async function uploadDocumentFile(userId: string, accountId: string, documentId: string, file: File): Promise<RepoResult<string>> {
  if (!supabase) return NOT_CONFIGURED;
  const path = storagePathFor(userId, accountId, documentId, file.name);
  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
    if (error) return fail(error.message);
    return { ok: true, data: path };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not upload this file.');
  }
}

export async function deleteDocumentFile(storagePath: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (error) return fail(error.message);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not delete this file from storage.');
  }
}

/** Removes every stored object under a submission's folder — called before deleting the submission's database row, so an orphaned file never lingers in Storage after "Delete submission." */
export async function deleteSubmissionFiles(userId: string, accountId: string): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const prefix = `${userId}/${accountId}`;
    const { data: docFolders, error: listErr } = await supabase.storage.from(BUCKET).list(prefix);
    if (listErr) return fail(listErr.message);
    const paths: string[] = [];
    for (const folder of docFolders ?? []) {
      const { data: files } = await supabase.storage.from(BUCKET).list(`${prefix}/${folder.name}`);
      for (const f of files ?? []) paths.push(`${prefix}/${folder.name}/${f.name}`);
    }
    if (paths.length === 0) return { ok: true, data: undefined };
    const { error: removeErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeErr) return fail(removeErr.message);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not remove stored files.');
  }
}

/** The original file's bytes from the private bucket — for the in-app document preview (nothing is saved to the broker's disk). */
export async function downloadDocumentFile(storagePath: string): Promise<RepoResult<Blob>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) return fail(error?.message ?? 'Could not load this file.');
    return { ok: true, data };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not load this file.');
  }
}

/** A short-lived signed URL for previewing a private document — never a permanent public URL. */
export async function getSignedDocumentUrl(storagePath: string, expiresInSeconds = 300): Promise<RepoResult<string>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data) return fail(error?.message ?? 'Could not create a preview link.');
    return { ok: true, data: data.signedUrl };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not create a preview link.');
  }
}
