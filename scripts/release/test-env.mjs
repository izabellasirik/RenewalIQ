// Test-project helpers for test-env.sh (the isolated TEST Supabase project only — test-env.sh runs
// guard.sh first). Synthetic users and files; nothing here can reach production.
//
//   node scripts/release/test-env.mjs users   create/refresh the synthetic users (password = TEST_USER_PASSWORD)
//   node scripts/release/test-env.mjs files   upload the seeded documents' files + one client upload
//
// Env: TEST_URL, TEST_SERVICE_KEY, TEST_ANON_KEY, TEST_USER_PASSWORD.
import { readFileSync } from 'node:fs';

const URL_ = process.env.TEST_URL.replace(/\/$/, '');
const SERVICE = process.env.TEST_SERVICE_KEY;
const ANON = process.env.TEST_ANON_KEY;
const ROOT = new URL('../../', import.meta.url).pathname;
const svc = { apikey: SERVICE, authorization: `Bearer ${SERVICE}` };

export const TEST_USERS = {
  'admin@example.com': 'Test Admin',
  'broker1@example.com': 'Test Broker One',
  'broker2@example.com': 'Test Broker Two',
  'outsider@example.com': 'Other Agency Admin',
  'anism.academy@gmail.com': 'Founder (test project)',
};

async function call(path, init = {}) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { ...svc, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function users() {
  const password = process.env.TEST_USER_PASSWORD;
  if (!password || password.length < 12) throw new Error('TEST_USER_PASSWORD missing');
  const { users: existing } = await call('/auth/v1/admin/users?page=1&per_page=1000');
  for (const [email, fullName] of Object.entries(TEST_USERS)) {
    const u = existing.find((x) => x.email === email);
    // email_confirm: confirmed without sending any email.
    const body = JSON.stringify({ password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (u) await call(`/auth/v1/admin/users/${u.id}`, { method: 'PUT', body });
    else await call('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, ...JSON.parse(body) }) });
    console.log(`user ${email}: ${u ? 'refreshed' : 'created'}`);
  }
}

const SAMPLE = (name) => readFileSync(`${ROOT}public/sample-fixtures/${name}`);
function bytesFor(name) {
  if (name.endsWith('.pdf')) return [SAMPLE('ABC_Transportation_Loss_Runs.pdf'), 'application/pdf'];
  if (name.endsWith('.xlsx')) return [SAMPLE(name.includes('Vehicle') ? 'ABC_Transportation_Vehicle_Schedule.xlsx' : 'ABC_Transportation_Driver_Schedule.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
  // Older kinds of files an agency may already have stored (synthetic bytes).
  if (name.endsWith('.tif')) return [Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(2048, 1)]), 'image/tiff'];
  if (name.endsWith('.msg')) return [Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(2048, 2)]), 'application/vnd.ms-outlook'];
  return [Buffer.from('synthetic test file\n'), 'text/plain'];
}

async function upload(bucket, path, bytes, type) {
  const res = await fetch(`${URL_}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { ...svc, 'content-type': type, 'x-upsert': 'true' }, body: bytes });
  if (!res.ok) throw new Error(`upload ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function files() {
  const docs = await call('/rest/v1/documents?select=id,name,storage_path&storage_path=not.is.null&id=like.doc_seed_*');
  for (const d of docs) {
    const [bytes, type] = bytesFor(d.name);
    await upload('submission-documents', d.storage_path, bytes, type);
    await call(`/rest/v1/documents?id=eq.${d.id}`, { method: 'PATCH', body: JSON.stringify({ size_bytes: bytes.length }), headers: { prefer: 'return=minimal' } });
    console.log(`file ${d.name}`);
  }
  // A client already sent one file through a request link (the way the current app records it).
  const [req] = await call('/rest/v1/document_requests?select=token,document_request_items(id,label)&submission_id=eq.acct_seed_2&limit=1');
  const item = req.document_request_items[0];
  const path = `${req.token}/seedkey0001/MVRs_from_client.pdf`;
  const [bytes] = bytesFor('x.pdf');
  await upload('intake-uploads', path, bytes, 'application/pdf');
  const res = await fetch(`${URL_}/rest/v1/rpc/attach_document_request_file`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_token: req.token, p_item_id: item.id, p_file_key: 'seedkey0001', p_file_name: 'MVRs_from_client.pdf', p_storage_path: path, p_size: bytes.length }),
  });
  if (!res.ok) throw new Error(`client attach → ${res.status} ${(await res.text()).slice(0, 200)}`);
  console.log('client upload on the acct_seed_2 request');
}

const cmd = process.argv[2];
if (cmd === 'users') await users();
else if (cmd === 'files') await files();
else { console.error('usage: test-env.mjs users|files'); process.exit(2); }
