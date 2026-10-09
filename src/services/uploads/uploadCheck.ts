import { SIGNATURE_BYTES, checkUpload, contentTypeFor, type UploadCheck } from '../../../api/_lib/fileSignature';

export { MAX_UPLOAD_BYTES, contentTypeFor } from '../../../api/_lib/fileSignature';

/**
 * Before uploading: the same check the server makes (api/verify-upload), so a wrong or oversized
 * file is refused at once with a clear reason instead of after the upload. The server's check is
 * the one that counts — this one only saves the client a wasted upload.
 */
export async function precheckUpload(file: File): Promise<UploadCheck> {
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  } catch {
    return { ok: false, reason: `${file.name} couldn't be read on this device.` };
  }
  return checkUpload(file.name, file.size, head);
}

/** An error the upload retry loop must not retry: the file itself is the problem. */
export function rejectedFileError(reason: string): Error {
  return Object.assign(new Error(reason), { status: 422, rejectedFile: true });
}

export type ServerCheck = { status: 'ok' } | { status: 'rejected'; message: string } | { status: 'unavailable' };

/**
 * After uploading: has the server check the stored file's real contents (deleting it if it isn't
 * what it claims). 'unavailable' when the check isn't deployed/configured or can't be reached —
 * the upload then goes on as before; once the database enforces verification (0048), an
 * unverified file simply can't be attached.
 */
export async function verifyUploadOnServer(bucket: 'intake-uploads' | 'submission-documents', path: string, accessToken?: string): Promise<ServerCheck> {
  try {
    const res = await fetch('/api/verify-upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ bucket, path }),
    });
    if (res.status === 422) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { status: 'rejected', message: body?.error ?? 'This file was not accepted.' };
    }
    if (!res.ok) return { status: 'unavailable' };
    // Only the route's own answer counts (a dev server answers unknown paths with the app's page).
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return body?.ok === true ? { status: 'ok' } : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

/** The content type to store a file with: from its extension (the buckets only accept these), else what the browser says. */
export function storageContentType(file: File): string | undefined {
  return contentTypeFor(file.name) ?? (file.type || undefined);
}
