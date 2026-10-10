import { describe, expect, it, vi } from 'vitest';
import { checkUpload, contentTypeFor, detectKind } from '../../api/_lib/fileSignature';
import { handleVerifyUpload } from '../../api/verify-upload';

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const PDF = bytes('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], 'JFIF');
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const HEIC = bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0]);
const DOCX = bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0], '[Content_Types].xml');
const XLS = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const CSV = bytes('name,dob,license\nJordan Avery,07/24/1985,A1234567\n');
const EXE = bytes('MZ', [0x90, 0, 3, 0, 0, 0, 4, 0]);
const HTML = bytes('<!doctype html><html><script>alert(1)</script></html>');

describe('file contents, not names (api/_lib/fileSignature)', () => {
  it('recognises every accepted kind by its bytes', () => {
    expect([PDF, JPEG, PNG, HEIC, DOCX, XLS, CSV].map(detectKind)).toEqual(['pdf', 'jpeg', 'png', 'heic', 'zip', 'ole', 'text']);
    expect(detectKind(EXE)).toBeNull();
  });

  it('accepts a file whose contents match its extension', () => {
    expect(checkUpload('loss run.pdf', 120_000, PDF)).toMatchObject({ ok: true, kind: 'pdf', mime: 'application/pdf' });
    expect(checkUpload('IMG_1272.HEIC', 2_000_000, HEIC)).toMatchObject({ ok: true, kind: 'heic' });
    expect(checkUpload('drivers.xlsx', 9_000, DOCX)).toMatchObject({ ok: true, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(checkUpload('drivers.csv', CSV.length, CSV)).toMatchObject({ ok: true, mime: 'text/csv' });
  });

  it('refuses renamed files, disguised web pages, unknown types, empty and oversized files', () => {
    expect(checkUpload('invoice.pdf', 5_000, EXE)).toMatchObject({ ok: false });
    expect((checkUpload('photo.pdf', 5_000, JPEG) as { reason: string }).reason).toContain('looks like a JPEG image');
    expect(checkUpload('notes.txt', HTML.length, HTML)).toMatchObject({ ok: false });
    expect(checkUpload('page.html', 100, HTML)).toMatchObject({ ok: false });
    expect(checkUpload('drawing.svg', 100, bytes('<svg>'))).toMatchObject({ ok: false });
    expect(checkUpload('setup.exe', 100, EXE)).toMatchObject({ ok: false });
    // programs without zero bytes in their first 4 KB still aren't "text"
    expect(checkUpload('notes.txt', 300, bytes('MZ', new Array(200).fill(0x90)))).toMatchObject({ ok: false });
    expect(checkUpload('notes.txt', 300, bytes([0x7f], 'ELF', new Array(50).fill(0x41)))).toMatchObject({ ok: false });
    expect(checkUpload('run.csv', 300, bytes('#!/bin/sh\ncurl x | sh\n'))).toMatchObject({ ok: false });
    expect(checkUpload('empty.pdf', 0, new Uint8Array())).toMatchObject({ ok: false });
    expect((checkUpload('huge.pdf', 26 * 1024 * 1024, PDF) as { reason: string }).reason).toContain('25 MB');
  });

  it('stores files with the type their extension implies', () => {
    expect(contentTypeFor('a.JPG')).toBe('image/jpeg');
    expect(contentTypeFor('a.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(contentTypeFor('a.html')).toBeUndefined();
  });
});

describe('POST /api/verify-upload', () => {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', VITE_SUPABASE_ANON_KEY: 'anon' };
  const clientPath = '5b0c8a7e-1111-4111-8111-000000000001/key-aaaa-0001/loss run.pdf';
  const req = (body: unknown, auth?: string) => new Request('https://app/api/verify-upload', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

  function storage(content: Uint8Array, total = content.length, lastModified: string | null = new Date().toUTCString()) {
    const calls: { url: string; method: string; body?: string; range?: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body as string | undefined, range: new Headers(init?.headers).get('range') });
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: '00000000-0000-0000-0000-00000000000a' }));
      if (url.includes('/storage/v1/object/') && method === 'GET') return new Response(content.slice(0, 4096), { status: 206, headers: { 'content-range': `bytes 0-${Math.min(content.length, 4096) - 1}/${total}`, ...(lastModified ? { 'last-modified': lastModified } : {}) } });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it('reads only the first 4 KB, records a genuine file as verified', async () => {
    const { fetchImpl, calls } = storage(PDF, 250_000);
    const res = await handleVerifyUpload(req({ bucket: 'intake-uploads', path: clientPath }), env, fetchImpl);
    expect(res.status).toBe(200);
    expect(calls[0].range).toBe('bytes=0-4095');
    const recorded = calls.find((c) => c.url.endsWith('/rest/v1/upload_verifications'))!;
    expect(JSON.parse(recorded.body!)).toEqual({ bucket_id: 'intake-uploads', object_name: clientPath, kind: 'pdf', size_bytes: 250_000 });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('deletes a file that is not what its name says, and says why', async () => {
    const { fetchImpl, calls } = storage(EXE);
    const res = await handleVerifyUpload(req({ bucket: 'intake-uploads', path: clientPath }), env, fetchImpl);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toContain('loss run.pdf');
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(JSON.parse(del.body!)).toEqual({ prefixes: [clientPath] });
    expect(calls.some((c) => c.url.includes('upload_verifications'))).toBe(false);
  });

  it('never deletes an older file — a re-check of a known path can only refuse it', async () => {
    for (const lastModified of [new Date(Date.now() - 60 * 60_000).toUTCString(), null]) {
      const { fetchImpl, calls } = storage(PDF, 30 * 1024 * 1024, lastModified);
      expect((await handleVerifyUpload(req({ bucket: 'intake-uploads', path: clientPath }), env, fetchImpl)).status).toBe(422);
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
      expect(calls.some((c) => c.url.includes('upload_verifications'))).toBe(false);
    }
  });

  it('uses the stored size, so an oversized file is refused even if the first bytes look fine', async () => {
    const { fetchImpl } = storage(PDF, 30 * 1024 * 1024);
    expect((await handleVerifyUpload(req({ bucket: 'intake-uploads', path: clientPath }), env, fetchImpl)).status).toBe(422);
  });

  it('broker uploads: signed in, and only inside their own folder', async () => {
    const { fetchImpl } = storage(PDF);
    const own = '00000000-0000-0000-0000-00000000000a/acct_1/doc_1/a.pdf';
    const other = '00000000-0000-0000-0000-00000000000b/acct_1/doc_1/a.pdf';
    expect((await handleVerifyUpload(req({ bucket: 'submission-documents', path: own }), env, fetchImpl)).status).toBe(401);
    expect((await handleVerifyUpload(req({ bucket: 'submission-documents', path: other }, 'Bearer t'), env, fetchImpl)).status).toBe(403);
    expect((await handleVerifyUpload(req({ bucket: 'submission-documents', path: own }, 'Bearer t'), env, fetchImpl)).status).toBe(200);
  });

  it("refuses '.' and '..' segments before touching storage", async () => {
    const { fetchImpl, calls } = storage(PDF);
    for (const path of ['00000000-0000-0000-0000-00000000000a/../00000000-0000-0000-0000-00000000000b/a.pdf', '00000000-0000-0000-0000-00000000000a/acct_1/../a.pdf', '00000000-0000-0000-0000-00000000000a/./doc_1/a.pdf']) {
      expect((await handleVerifyUpload(req({ bucket: 'submission-documents', path }, 'Bearer t'), env, fetchImpl)).status).toBe(400);
    }
    expect((await handleVerifyUpload(req({ bucket: 'intake-uploads', path: '5b0c8a7e-1111-4111-8111-000000000001/key-aaaa-0001/..' }), env, fetchImpl)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('refuses unknown buckets and malformed paths; 501 until configured', async () => {
    const { fetchImpl } = storage(PDF);
    expect((await handleVerifyUpload(req({ bucket: 'other', path: clientPath }), env, fetchImpl)).status).toBe(400);
    expect((await handleVerifyUpload(req({ bucket: 'intake-uploads', path: '../../etc/passwd' }), env, fetchImpl)).status).toBe(400);
    expect((await handleVerifyUpload(req({ bucket: 'intake-uploads', path: clientPath }), {}, fetchImpl)).status).toBe(501);
  });
});
