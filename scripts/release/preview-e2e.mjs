// Release check on the REAL Vercel Preview, against the isolated TEST Supabase project.
// Synthetic data only (users and accounts made by test-env.sh setup).
//
// Stops at once unless the Preview's app is built against the test project (never production).
//
// Env: PREVIEW_URL, TEST_REF, PROD_REF, TEST_URL, TEST_ANON_KEY, TEST_DB_URL, TEST_USER_PASSWORD,
//      VERCEL_BYPASS (optional: Vercel "Protection Bypass for Automation" secret),
//      AI_CONFIGURED=1 (optional: the test project's function has an Anthropic key → AI + quota checks),
//      LOCAL_DRY_RUN=1 (local stack only: skips the bundle check, serves /api/verify-upload from :54501).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = process.env;
const BASE = env.PREVIEW_URL.replace(/\/$/, '');
const ROOT = new URL('../../', import.meta.url).pathname;
const { chromium } = await import(env.PLAYWRIGHT_MODULE ?? 'playwright');
const results = [];
const check = (label, ok, detail = '') => { results.push({ label, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`); };
const sql = (q) => execFileSync('psql', [env.TEST_DB_URL, '-X', '-A', '-t', '-c', q]).toString().trim();
const waitFor = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch {} await new Promise((r) => setTimeout(r, 750)); } return false; };
const bypassHeaders = env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': env.VERCEL_BYPASS } : {};
const PASSWORD = env.TEST_USER_PASSWORD;
const VERIFY_URL = env.LOCAL_DRY_RUN ? 'http://localhost:54501/' : `${BASE}/api/verify-upload`;

// ---- 0. Is this Preview really on the TEST project? -------------------------------------------
if (!env.LOCAL_DRY_RUN) {
  const html = await (await fetch(`${BASE}/`, { headers: bypassHeaders })).text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]);
  let bundle = '';
  for (const s of scripts) bundle += await (await fetch(new URL(s, `${BASE}/`), { headers: bypassHeaders })).text();
  const onTest = bundle.includes(env.TEST_REF);
  const onProd = bundle.includes(env.PROD_REF);
  check('Preview is built against the TEST Supabase project, not production', onTest && !onProd, onProd ? 'PRODUCTION project found in the Preview bundle' : onTest ? '' : 'test project not found in the bundle (redeploy the Preview after setting its env vars)');
  if (!onTest || onProd) { console.log('Stopping: nothing else runs against this Preview.'); process.exit(1); }
}

// ---- 1. The upload-check route runs on Vercel ----------------------------------------------------
{
  const r = await fetch(VERIFY_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...bypassHeaders }, body: '{}' });
  const body = await r.text();
  check('/api/verify-upload runs on the Preview (answers, not a crash)', r.status === 400 && body.includes('Unknown upload'), `${r.status} ${body.slice(0, 120)}${r.status === 501 ? ' → SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set for Preview' : ''}`);
}

const browser = await chromium.launch(env.CHROMIUM_PATH ? { executablePath: env.CHROMIUM_PATH } : {});
const pageErrors = [];
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  if (env.VERCEL_BYPASS) {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/?x-vercel-protection-bypass=${encodeURIComponent(env.VERCEL_BYPASS)}&x-vercel-set-bypass-cookie=samesitenone`);
    await p.close();
  }
  if (env.LOCAL_DRY_RUN) await ctx.route('**/api/verify-upload', async (route) => route.fulfill({ response: await route.fetch({ url: 'http://localhost:54501/' }) }));
  return ctx;
}
async function signIn(email) {
  const ctx = await context();
  const p = await ctx.newPage(); p.setDefaultTimeout(20000);
  p.on('pageerror', (e) => pageErrors.push(`${email}: ${e.message}`));
  await p.goto(`${BASE}/login`);
  await p.locator('input[type=email]').fill(email);
  await p.locator('input[type=password]').fill(PASSWORD);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await p.waitForTimeout(2500);
  // First sign-in without a name on file: the one-time profile screen.
  if (await p.getByText('Set up your profile').count()) {
    await p.getByLabel(/Full name/).fill('Release Test User');
    await p.getByRole('button', { name: /Continue to Renewal IQ/ }).click();
    await p.waitForTimeout(2500);
  }
  return p;
}
async function token(email) {
  const r = await fetch(`${env.TEST_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.TEST_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return (await r.json()).access_token;
}
async function setUntypedFile(locator, name, buffer) {
  await locator.evaluate((input, [n, b64]) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], n, { type: '' }));
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [name, buffer.toString('base64')]);
}
async function licensePhoto(page, name) {
  const p = await page.context().newPage();
  await p.setViewportSize({ width: 640, height: 400 });
  await p.setContent(`<div style="font:20px Arial;padding:24px;background:#e8f0fa;height:352px;border:2px solid #345"><b style="font-size:26px">SAMPLE STATE — DRIVER LICENSE (TEST)</b><br><br>NAME: ${name}<br>DOB: 07/24/1985 &nbsp; CLASS: A (CDL)<br>DL NO: T000-000-00-${Math.floor(Math.random() * 900 + 100)}<br>ISSUED: 02/01/2022 &nbsp; EXPIRES: 07/24/2030<br><br><i>Synthetic test document — not a real license</i></div>`);
  const png = await p.screenshot({ type: 'png' });
  await p.close();
  return png;
}

const B1 = 'broker1@example.com';
const b1Id = sql(`select id from auth.users where email = '${B1}'`);

// ---- 2. Existing accounts are all there, as before -----------------------------------------------
const b = await signIn(B1);
await b.goto(`${BASE}/accounts`); await b.waitForTimeout(3000);
const list = await b.locator('main').innerText();
check('existing accounts listed (broker sees own; other agency hidden)', ['Synthetic Freight One LLC', 'Synthetic Haulers Inc', 'Synthetic Logistics Co'].every((n) => list.includes(n)) && !list.includes('Other Agency Trucking'));
await b.goto(`${BASE}/accounts/acct_seed_1`); await b.waitForTimeout(3500);
const panel = b.getByTestId('missing-documents');
const rowState = async (label) => panel.locator('[data-testid="missing-row"]', { hasText: label }).first().getAttribute('data-state').catch(() => null);
check('existing requested item shows "Sent (unconfirmed)" — never auto-confirmed', (await rowState('Loss runs — 5 years')) === 'sent_unconfirmed', String(await rowState('Loss runs — 5 years')));
check('existing missing item still missing', (await rowState('IFTA — last 4 quarters')) === 'not_requested', String(await rowState('IFTA — last 4 quarters')));
const summary = await b.getByTestId('missing-documents-summary').innerText().catch(() => '');
check('existing overdue follow-up shown', /overdue/i.test(summary), summary.replace(/\n/g, ' | '));
check('existing requests unchanged in the database (unconfirmed, follow-up dates kept)', sql(`select count(*) from document_requests where submission_id like 'acct_seed_%' and delivery_status = 'unconfirmed' and next_follow_up is not null and sent_at is null`) === '3');
// Older .tif / .msg files still open (0048 limits new uploads only)
await b.goto(`${BASE}/accounts/acct_seed_2?tab=checklist`); await b.waitForTimeout(3000);
check('older .tif file still listed on its account', (await b.locator('main').innerText()).includes('Scanned_Fax_Loss_Run.tif'));
if (env.LOCAL_DRY_RUN) console.log('note: signed download links are not emulated locally — checked on the real test project only');
else {
  const t = await token(B1);
  const path = sql(`select storage_path from documents where id = 'doc_seed_4'`);
  const signed = await fetch(`${env.TEST_URL}/storage/v1/object/sign/submission-documents/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { apikey: env.TEST_ANON_KEY, authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: '{"expiresIn":60}' });
  const sj = await signed.json().catch(() => ({}));
  const dl = sj.signedURL ? await fetch(`${env.TEST_URL}/storage/v1${sj.signedURL}`) : null;
  check('older .tif file still downloads (signed link)', dl?.status === 200, `${signed.status} → ${dl?.status ?? '-'}`);
}

// ---- 3. Upload + AI reading --------------------------------------------------------------------
const fnStatus = [];
b.on('response', (r) => { if (r.url().includes('/functions/v1/extract-document-vision')) fnStatus.push(r.status()); });
await b.goto(`${BASE}/accounts/acct_seed_3/upload`); await b.waitForTimeout(2500);
await b.setInputFiles('input[type=file]', { name: 'license_riley.png', mimeType: 'image/png', buffer: await licensePhoto(b, 'RILEY Q TESTDRIVER') });
const docSaved = await waitFor(() => sql(`select count(*) from documents where submission_id = 'acct_seed_3' and storage_path is not null`) !== '0', 60000);
check('broker upload stored in the test project', docSaved);
check('broker upload checked by /api/verify-upload on the Preview', await waitFor(() => sql(`select count(*) from upload_verifications where bucket_id = 'submission-documents' and object_name like '${b1Id}/acct_seed_3/%'`) !== '0', 20000));
if (env.AI_CONFIGURED) {
  await waitFor(() => fnStatus.length > 0, 30000);
  check('AI reading answered (test project function)', fnStatus.includes(200), fnStatus.join(','));
  check('AI usage logged with broker AND agency', await waitFor(() => sql(`select count(*) from ai_usage_events where user_id = '${b1Id}' and organization_id is not null and not from_cache`) !== '0', 20000), sql(`select count(*) || ' rows, ' || count(*) filter (where organization_id is null) || ' without agency' from ai_usage_events`));
} else {
  console.log('note: AI not configured on the test project — AI checks skipped (upload falls back to on-device reading)');
}

// ---- 4. Missing Documents → prepared → sent ---------------------------------------------------------
await b.goto(`${BASE}/accounts/acct_seed_1`); await b.waitForTimeout(3500);
const LABEL = `Lease agreement ${Date.now() % 100000}`;
await panel.getByRole('button', { name: 'Add documents' }).click();
await b.getByLabel('Other document').fill(LABEL);
await b.getByRole('button', { name: 'Add to checklist' }).click(); await b.waitForTimeout(1500);
const row = panel.locator('[data-testid="missing-row"]', { hasText: LABEL });
await row.getByRole('button', { name: 'Request' }).click(); await b.waitForTimeout(1000);
const dlg = b.getByRole('dialog').last();
await b.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
await dlg.getByRole('button', { name: /^Copy/ }).first().click(); await b.waitForTimeout(3000);
await dlg.getByRole('button', { name: /Close|Cancel/ }).first().click().catch(() => b.keyboard.press('Escape'));
await b.waitForTimeout(2000);
const REQ = sql(`select r.id from document_requests r join document_request_items i on i.request_id = r.id where i.label = '${LABEL}' limit 1`);
check('copying the email only prepares the request', !!REQ && sql(`select delivery_status from document_requests where id = '${REQ}'`) === 'prepared');
await row.getByRole('button', { name: 'Mark as sent' }).click();
check('Mark as sent → sent, with time and follow-up', await waitFor(() => sql(`select delivery_status || ':' || (sent_at is not null) || ':' || (next_follow_up is not null) from document_requests where id = '${REQ}'`) === 'sent:true:true', 15000));

// ---- 5. Client upload through the link, checked by the Preview's route ------------------------------
const TOKEN = sql(`select token from document_requests where id = '${REQ}'`);
const cctx = await context();
const c = await cctx.newPage(); c.setDefaultTimeout(20000);
c.on('pageerror', (e) => pageErrors.push(`client: ${e.message}`));
await c.goto(`${BASE}/r/${TOKEN}`); await c.waitForTimeout(3500);
const item = c.getByTestId('client-item').filter({ hasText: LABEL });
await item.getByTestId('client-file-input').setInputFiles({ name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ' + 'x'.repeat(400)) });
await c.waitForTimeout(3000);
check('renamed file refused in the browser with a reason', /damaged or renamed|should/.test(await item.innerText()));
sql(`update public.app_settings set value = 'true' where key = 'require_upload_verification'`);
try {
  await item.getByTestId('client-file-input').setInputFiles({ name: 'Lease_agreement.pdf', mimeType: 'application/pdf', buffer: readFileSync(`${ROOT}public/sample-fixtures/ABC_Transportation_Loss_Runs.pdf`) });
  check('with enforcement ON: real PDF checked on the server and attached', await waitFor(() => sql(`select count(*) from document_request_files f join upload_verifications v on v.bucket_id = 'intake-uploads' and v.object_name = f.storage_path where f.request_id = '${REQ}'`) === '1', 45000));
  const multi = c.getByTestId('multi-upload').locator('input[type=file]');
  if (await multi.count()) {
    await setUntypedFile(multi.first(), 'IMG_0001.HEIC', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(3000, 7)]));
    check('untyped .HEIC (as Windows sends it) accepted by the bucket and the server check', await waitFor(() => sql(`select count(*) from document_request_files where request_id = '${REQ}'`) === '2', 45000));
  }
  // Bypassing the app: attach a file the server never checked → refused by the database.
  const anon = env.TEST_ANON_KEY;
  const firstItem = sql(`select id from document_request_items where request_id = '${REQ}' limit 1`);
  const path = `${TOKEN}/directkey0001/direct.pdf`;
  await fetch(`${env.TEST_URL}/storage/v1/object/intake-uploads/${path}`, { method: 'POST', headers: { apikey: anon, authorization: `Bearer ${anon}`, 'content-type': 'application/pdf' }, body: readFileSync(`${ROOT}public/sample-fixtures/ABC_Transportation_Loss_Runs.pdf`) });
  const att = await fetch(`${env.TEST_URL}/rest/v1/rpc/attach_document_request_file`, { method: 'POST', headers: { apikey: anon, authorization: `Bearer ${anon}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_token: TOKEN, p_item_id: firstItem, p_file_key: 'directkey0001', p_file_name: 'direct.pdf', p_storage_path: path, p_size: 1469 }) });
  check('enforcement ON: attaching an unchecked file directly is refused', !att.ok && /checked/.test(await att.text()), String(att.status));
} finally {
  sql(`update public.app_settings set value = 'false' where key = 'require_upload_verification'`);
}

// ---- 6. Broker confirms the client file → Received, verified ----------------------------------------
await b.goto(`${BASE}/accounts/acct_seed_1?tab=checklist`); await b.waitForTimeout(3000);
await b.getByRole('button', { name: /Check for uploads/ }).click({ noWaitAfter: true }).catch(() => {});
const held = b.getByTestId('needs-review').filter({ hasText: 'Lease_agreement.pdf' }).first();
await held.waitFor({ timeout: 60000 }).catch(() => {});
await held.getByRole('button', { name: /Yes, it/ }).click({ noWaitAfter: true }).catch(() => {});
check('broker confirms the client file → received + verified by the broker', await waitFor(() => sql(`select (e->>'status') || ':' || coalesce(e->>'verification', '-') from submissions s, jsonb_array_elements(s.missing_items) e where s.id = 'acct_seed_1' and e->>'label' = '${LABEL}'`) === 'received:verified', 30000));

// ---- 7. /api/verify-upload on the Preview: other agencies' files are out of reach --------------------
{
  const own = sql(`select storage_path from documents where id = 'doc_seed_1'`);
  const post = async (body, t) => { const r = await fetch(VERIFY_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...bypassHeaders, ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) }); return [r.status, await r.text()]; };
  const outsider = await token('outsider@example.com');
  let [s, t] = await post({ bucket: 'submission-documents', path: own }, outsider);
  check("other agency's admin can't check broker1's file", s === 403 && !/kind/.test(t), `${s}`);
  [s] = await post({ bucket: 'submission-documents', path: own });
  check('not signed in → refused', s === 401, `${s}`);
  [s] = await post({ bucket: 'submission-documents', path: `${own.split('/')[0]}/../x/y.pdf` }, await token(B1));
  check("'..' path refused", s === 400, `${s}`);
  [s, t] = await post({ bucket: 'submission-documents', path: own }, await token(B1));
  check('owner gets only the file kind', s === 200 && t === '{"ok":true,"kind":"pdf"}', t);
}

// ---- 8. Market Finder; Founder Analytics only for the founder ---------------------------------------
await b.goto(`${BASE}/market-finder`); await b.waitForTimeout(3000);
check('Market Finder loads', /Market Finder/.test(await b.locator('main').innerText()) && !/something went wrong/i.test(await b.locator('main').innerText()));
await b.goto(`${BASE}/founder-analytics`); await b.waitForTimeout(3000);
check('broker cannot open Founder Analytics', !(await b.getByTestId('founder-adoption').count()));
const f = await signIn('anism.academy@gmail.com');
await f.goto(`${BASE}/founder-analytics`); await f.waitForTimeout(5000);
check('founder sees Founder Analytics with broker adoption', (await f.getByTestId('founder-adoption').count()) === 1);

// ---- 9. AI quota on real infrastructure (only with an Anthropic key on the test project) ------------
if (env.AI_CONFIGURED) {
  const paid = Number(sql(`select count(*) from ai_usage_events where user_id = '${b1Id}' and occurred_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc' and not from_cache and (succeeded or cost_usd > 0)`));
  const org = sql(`select agency_id from profiles where user_id = '${b1Id}'`);
  sql(`insert into ai_usage_events (organization_id, user_id, operation, cost_usd, succeeded, error_code) select '${org}', '${b1Id}', 'structured_extraction', 0, true, 'release_test_fill' from generate_series(1, ${Math.max(0, 200 - paid)})`);
  fnStatus.length = 0;
  await b.goto(`${BASE}/accounts/acct_seed_3/upload`); await b.waitForTimeout(2500);
  await b.setInputFiles('input[type=file]', { name: 'license_jordan.png', mimeType: 'image/png', buffer: await licensePhoto(b, 'JORDAN P SAMPLE') });
  await waitFor(() => fnStatus.length > 0, 30000); await b.waitForTimeout(15000);
  check('read over the daily limit refused (429) with the limit message; upload still completes', fnStatus.includes(429) && /limit/i.test(await b.locator('main').innerText()), fnStatus.join(','));
  check('refusal logged at no cost; no hold left', sql(`select count(*) from ai_usage_events where user_id = '${b1Id}' and error_code = 'user_daily_limit' and cost_usd = 0`) !== '0' && sql(`select count(*) from ai_quota_holds`) === '0');
  sql(`delete from ai_usage_events where error_code = 'release_test_fill'`);
}

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed; page errors: ${pageErrors.length ? pageErrors.slice(0, 5).join(' | ') : 'none'}`);
process.exit(passed === results.length && pageErrors.length === 0 ? 0 : 1);
