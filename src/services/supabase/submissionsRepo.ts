import { supabase } from './client';
import type { Account, ActivityEvent, CoverageType, DriverEntry, FieldValue, LossEntry, RiskProfile, UploadedDocument, VehicleEntry } from '../../types';
import { emptyField } from '../../types';

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
}

/** Fetches every submission owned by the current user, fully hydrated. Used on sign-in to populate the workspace. */
export async function fetchUserSubmissions(userId: string): Promise<RepoResult<CloudSubmissionBundle[]>> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const [subsRes, fvRes, faRes, covRes, vehRes, drvRes, lossRes, docRes, actRes] = await Promise.all([
      supabase.from('submissions').select('*').eq('user_id', userId),
      supabase.from('field_values').select('*').eq('user_id', userId),
      supabase.from('field_alternates').select('*').eq('user_id', userId),
      supabase.from('coverage_lines').select('*').eq('user_id', userId),
      supabase.from('vehicles').select('*').eq('user_id', userId),
      supabase.from('drivers').select('*').eq('user_id', userId),
      supabase.from('losses').select('*').eq('user_id', userId),
      supabase.from('documents').select('*').eq('user_id', userId),
      supabase.from('activity_events').select('*').eq('user_id', userId),
    ]);
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
          yearsExperience: d.years_experience ?? undefined,
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
          uploadedAt: d.uploaded_at,
        }));

      const activity: ActivityEvent[] = (actRes.data ?? [])
        .filter((e) => e.submission_id === sub.id)
        .map((e) => ({ id: e.id, accountId: sub.id, type: e.type, message: e.message, timestamp: e.occurred_at }))
        .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

      const profile: RiskProfile = {
        id: `risk_${sub.id}`,
        accountId: sub.id,
        business: business as unknown as RiskProfile['business'],
        transportation: transportation as unknown as RiskProfile['transportation'],
        coverage,
        vehicles,
        drivers,
        lossHistory,
        updatedAt: sub.updated_at,
      };

      return { account, profile, documents, activity };
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
  profile: RiskProfile
): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const submissionRow = {
      id: account.id,
      user_id: userId,
      named_insured: account.namedInsured,
      state: account.state || null,
      status: account.status,
      archived: account.archived,
      created_at: account.createdAt,
      updated_at: account.updatedAt,
    };
    const { error: subErr } = await supabase.from('submissions').upsert(submissionRow);
    if (subErr) return fail(subErr.message);

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
    if (delErr?.error) return fail(delErr.error.message);

    const inserts: PromiseLike<{ error: { message: string } | null }>[] = [];
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
      inserts.push(
        supabase.from('drivers').insert(
          profile.drivers.map((d) => ({
            id: d.id,
            submission_id: account.id,
            user_id: userId,
            name: d.name ?? null,
            dob: d.dob ?? null,
            license_state: d.licenseState ?? null,
            years_experience: d.yearsExperience ?? null,
            violations: d.violations ?? null,
            is_manual: !!d.isManual,
            source_document_id: d.source?.documentId ?? null,
            source_page: d.source?.page ?? null,
            source_excerpt: d.source?.excerpt ?? null,
            last_updated_at: d.lastUpdatedAt ?? null,
          }))
        )
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
    if (insErr?.error) return fail(insErr.error.message);

    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not save to your account.');
  }
}

export async function upsertDocumentMetadata(userId: string, accountId: string, doc: UploadedDocument, storagePath: string | null): Promise<RepoResult> {
  if (!supabase) return NOT_CONFIGURED;
  try {
    const { error } = await supabase.from('documents').upsert({
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
    });
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
    const { error } = await supabase.from('activity_events').upsert(
      events.map((e) => ({ id: e.id, submission_id: accountId, user_id: userId, type: e.type, message: e.message, occurred_at: e.timestamp }))
    );
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
