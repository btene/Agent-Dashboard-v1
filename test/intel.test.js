import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';

// A fake Socrata portal so the ingestion pipeline and verification can be
// exercised without the network. Rows mirror the real data.lacity.org shape.
const ROWS = [
  { permit_nbr: 'TEST-10000-00001', primary_address: '100 S MAIN ST', zip_code: '90012', permit_group: 'Building', permit_type: 'Bldg-New', permit_sub_type: 'Commercial', use_desc: 'Office', submitted_date: '2025-02-01T00:00:00.000', issue_date: '2026-09-15T00:00:00.000', status_desc: 'Issued', status_date: '2026-09-15T00:00:00.000', valuation: '12500000', square_footage: '85000', lat: '34.05', lon: '-118.24', work_desc: 'NEW 6 STORY OFFICE BUILDING WITH GROUND FLOOR RETAIL, PLAZA, LANDSCAPE AND IRRIGATION PER PLANS', refresh_time: '2026-11-01T00:00:00.000' },
  { permit_nbr: 'TEST-10000-00002', primary_address: '7 ELM DR', zip_code: '91301', permit_group: 'Building', permit_type: 'Bldg-Alter/Repair', permit_sub_type: '1 or 2 Family Dwelling', use_desc: 'Dwelling - Single Family', submitted_date: '2026-01-01T00:00:00.000', issue_date: '2026-01-02T00:00:00.000', status_desc: 'Issued', valuation: '400000', square_footage: '2200', lat: '34.1', lon: '-118.7', work_desc: 'KITCHEN AND BATHROOM REMODEL', refresh_time: '2026-11-01T00:00:00.000' },
];
let socrataState = { rows: ROWS, fail: false };

function fakeSocrata() {
  return http.createServer((req, res) => {
    if (socrataState.fail) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ message: 'maintenance' })); }
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/views/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ name: 'Fake permits', rowsUpdatedAt: 1762000000, metadata: { custom_fields: { 'Committed Update Frequency': { 'Refresh rate': 'Weekly' } } } })); }
    const where = url.searchParams.get('$where') || '';
    let rows = socrataState.rows;
    const m = where.match(/permit_nbr = '([^']+)'/);
    if (m) rows = rows.filter((r) => r.permit_nbr === m[1]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rows));
  });
}

let server; let base; let fake; let ctx; let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'als-test-'));
  process.env.DATA_DIR = dataDir;
  fake = fakeSocrata().listen(0);
  await new Promise((r) => fake.once('listening', r));
  const fakeBase = `http://localhost:${fake.address().port}`;
  // Route https://<domain>/... to the fake server.
  const fetchImpl = (url, opts) => fetch(url.replace(/^https:\/\/[^/]+/, fakeBase), opts);
  ctx = createApp({ store: createStore({ persist: false }), seed: true, scheduler: { autoStart: false }, fetchImpl });
  server = ctx.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(() => { server.close(); fake.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const call = async (p, opts = {}) => {
  const res = await fetch(base + p, { method: opts.method || 'GET', headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

test('defaults: semi-automatic mode with email sending disabled', async () => {
  const { body } = await call('/automations');
  assert.equal(body.mode, 'semi_automatic');
  assert.equal(body.pauseAll, false);
  const sending = body.items.find((a) => a.id === 'email_sending');
  assert.equal(sending.config.enabled, false);
  assert.ok(body.items.filter((a) => a.id !== 'email_sending').every((a) => a.config.enabled));
  assert.equal(body.items.length, 11);
});

test('source registry lists every jurisdiction with coverage, licence and refresh frequency', async () => {
  const { body } = await call('/sources');
  const ids = body.map((s) => s.id);
  for (const id of ['la-city-ladbs-permits', 'santa-barbara-city', 'santa-barbara-county', 'san-bernardino-city', 'san-bernardino-county', 'ventura-county', 'la-county-epic', 'orange-county', 'constructconnect']) assert.ok(ids.includes(id), id);
  for (const s of body) { assert.ok(s.officialUrl); assert.ok(s.coverage.jurisdiction); assert.ok(s.license); assert.ok(s.refresh.label); assert.ok(s.howToConnect.length); }
  const la = body.find((s) => s.id === 'la-city-ladbs-permits');
  // weekly publisher → 6h/12h polling must not be offered
  assert.deepEqual(la.pollOptions.map((o) => o.id), ['manual', 'daily']);
  assert.equal((await call('/sources/la-city-ladbs-permits', { method: 'PATCH', body: { pollInterval: '6h' } })).status, 400);
});

test('ingestion creates live projects from the connector with provenance, classification and an explained score', async () => {
  const run = (await call('/sources/la-city-ladbs-permits/run', { method: 'POST', body: {} })).body;
  assert.equal(run.ok, true);
  assert.equal(run.created, 2);
  assert.equal(run.publisherRefreshRate, 'Weekly');
  const list = (await call('/projects?includeExcluded=true')).body;
  assert.equal(list.total, 2);
  const office = list.items.find((p) => p.permitNumber === 'TEST-10000-00001');
  assert.equal(office.recordClass, 'government');
  assert.equal(office.provenance.address, 'government');
  assert.equal(office.provenance.applicant, 'unverified');
  assert.equal(office.display.applicant, 'Not yet verified');
  assert.equal(office.applicant, null, 'no invented developer');
  assert.equal(office.sourceRecordUrl, 'https://data.lacity.org/resource/pi9x-tg5x.json?permit_nbr=TEST-10000-00001');
  assert.equal(office.classification.provenance, 'ai_estimate');
  assert.equal(office.classification.projectType, 'mixed_use');
  assert.equal(office.classification.landscapeLikelihood, 'documented');
  assert.equal(office.score.breakdown.length, 6);
  assert.equal(office.score.breakdown.reduce((s, b) => s + b.max, 0), 100);
  assert.ok(office.score.breakdown.every((b) => b.reason.length > 10));
  assert.ok(office.score.total >= 60, `score ${office.score.total}`);
  const home = list.items.find((p) => p.permitNumber === 'TEST-10000-00002');
  assert.equal(home.classification.excluded, true);
  assert.equal(home.stage, 'not_a_fit');
  assert.ok(home.score.total <= 15);
  // excluded residential hidden by default
  assert.equal((await call('/projects')).body.total, 1);
});

test('verification re-fetches the record, records changes and history, and reports source outages honestly', async () => {
  const id = (await call('/projects')).body.items[0].id;
  let v = (await call(`/projects/${id}/verify`, { method: 'POST' })).body.verification;
  assert.equal(v.status, 'verified');
  assert.equal(v.changes.length, 0);
  assert.ok(v.sourceTimestamp && v.retrievedAt);
  // the agency changes the status and valuation
  socrataState.rows = ROWS.map((r) => (r.permit_nbr === 'TEST-10000-00001' ? { ...r, status_desc: 'CofO Issued', valuation: '13000000' } : r));
  v = (await call(`/projects/${id}/verify`, { method: 'POST' })).body.verification;
  assert.equal(v.status, 'verified');
  assert.deepEqual(v.changes.map((c) => c.field).sort(), ['status', 'valuation']);
  assert.equal(v.previous.status, 'Issued');
  assert.equal(v.current.status, 'CofO Issued');
  const detail = (await call(`/projects/${id}`)).body;
  assert.equal(detail.status, 'CofO Issued');
  assert.ok(detail.history.some((h) => h.type === 'verified_changed' && h.changes.length === 2));
  // outage → pending, nothing substituted
  socrataState.fail = true;
  v = (await call(`/projects/${id}/verify`, { method: 'POST' })).body.verification;
  assert.equal(v.status, 'unavailable');
  assert.match(v.message, /^Source unavailable — verification pending/);
  assert.equal((await call(`/projects/${id}`)).body.status, 'CofO Issued', 'kept the last good value');
  assert.equal((await call(`/projects/${id}`)).body.verification.status, 'pending');
  socrataState.fail = false;
  socrataState.rows = ROWS;
});

test('demo records are labelled and never reach outreach, pipeline or dashboard counts', async () => {
  const demo = (await call('/projects?environment=demo&includeExcluded=true')).body;
  assert.ok(demo.total >= 5);
  assert.ok(demo.items.every((p) => p.isDemo && p.permitNumber.startsWith('DEMO-')));
  const d = demo.items[0];
  assert.equal((await call('/emails', { method: 'POST', body: { projectId: d.id } })).status, 403);
  assert.equal((await call(`/projects/${d.id}/stage`, { method: 'POST', body: { stage: 'contacted' } })).status, 403);
  const dash = (await call('/dashboard')).body;
  assert.equal(dash.totals.liveProjects, 2);
  assert.ok(dash.totals.demoProjects >= 5);
  const pipeline = (await call('/pipeline')).body;
  assert.equal(pipeline.reduce((s, c) => s + c.count, 0), 1, 'only the live non-excluded project');
  const removed = (await call('/demo', { method: 'DELETE' })).body.removed;
  assert.ok(removed >= 5);
  assert.equal((await call('/projects?environment=demo&includeExcluded=true')).body.total, 0);
});

test('email drafts use only verified facts, forbid invented relationships, and follow the approval workflow', async () => {
  const project = (await call('/projects')).body.items[0];
  const contact = (await call('/contacts', { method: 'POST', body: { firstName: 'Dana', lastName: 'Lee', email: 'dana@example.com', company: 'Example GC', role: 'general_contractor', projectIds: [project.id], sourceNote: 'test' } })).body;
  assert.equal(contact.provenance, 'user');
  assert.equal((await call(`/projects/${project.id}`)).body.contactCount, 1);
  const email = (await call('/emails', { method: 'POST', body: { projectId: project.id, contactId: contact.id } })).body;
  assert.equal(email.status, 'pending_approval');
  assert.equal(email.style, 'short_direct');
  assert.match(email.subject, /^Landscaping — /);
  assert.match(email.body, /Hi Dana,/);
  assert.match(email.body, /100 S MAIN ST/);
  assert.doesNotMatch(email.body, /Not yet verified/);
  assert.ok(email.missingFacts.includes('projectName'), 'no project name was published, so none was invented');
  assert.ok(email.missingFacts.includes('bidDeadline'));
  // relationship claims are rejected
  const bad = await call(`/emails/${email.id}`, { method: 'PATCH', body: { body: 'As discussed on our call, you asked us to bid.' } });
  assert.equal(bad.status, 400);
  // approve → send fails honestly without an email account (no SMTP configured)
  assert.equal((await call(`/emails/${email.id}/approve`, { method: 'POST' })).body.status, 'approved');
  const send = await call(`/emails/${email.id}/send`, { method: 'POST' });
  assert.equal(send.status, 409);
  assert.match(send.body.error, /No email account connected/);
  // the three styles render for the right audiences
  for (const style of ['short_direct', 'relationship', 'bid_response']) {
    const r = (await call('/emails/preview', { method: 'POST', body: { projectId: project.id, contactId: contact.id, style } })).body;
    assert.ok(r.subject && r.body.includes('Advanced Landscape 2000'));
  }
});

test('automation scheduler respects pause-all and mode, and runs jobs on demand', async () => {
  await call('/automations/pause-all', { method: 'POST' });
  const skipped = await ctx.scheduler.run('permit_monitoring', { trigger: 'schedule' });
  assert.equal(skipped.skipped, 'All automations are paused.');
  await call('/automations/resume-all', { method: 'POST' });
  await call('/automations/mode', { method: 'PATCH', body: { mode: 'manual' } });
  assert.equal((await ctx.scheduler.run('permit_monitoring', { trigger: 'schedule' })).skipped, 'Manual mode — nothing runs on a schedule.');
  await call('/automations/mode', { method: 'PATCH', body: { mode: 'semi_automatic' } });
  assert.match((await ctx.scheduler.run('email_sending', { trigger: 'schedule' })).skipped, /only sent automatically in Automatic mode|switched off/);
  const ran = (await call('/automations/permit_monitoring/run', { method: 'POST' })).body;
  assert.equal(ran.status, 'ok');
  assert.ok(ran.lastSuccessAt);
  const snap = (await call('/automations')).body.items.find((a) => a.id === 'permit_monitoring');
  assert.equal(snap.recentRuns.length >= 1, true);
  assert.ok(snap.nextRunAt, 'next run is scheduled');
  // follow-up and CRM sync jobs run without error
  assert.equal((await call('/automations/crm_sync/run', { method: 'POST' })).body.status, 'ok');
  assert.equal((await call('/automations/follow_up_reminders/run', { method: 'POST' })).body.status, 'ok');
});

test('CSV import maps columns, labels records as third-party, and verification says the source has no API', async () => {
  const csv = 'Project Number,Project Name,Address,City,Stage,Bid Date,Owner,Contractor,Value,URL\nCC-77,Harbor Logistics Park,500 Dock Rd,Oxnard,Bidding,2027-01-15,Harbor Dev LLC,BuildCo,18000000,https://app.constructconnect.com/p/77\n,No number row,1 X St,Oxnard,,,,,,\n';
  const res = await fetch(`${base}/imports?sourceId=constructconnect&filename=export.csv`, { method: 'POST', headers: { 'content-type': 'text/csv' }, body: csv });
  assert.equal(res.status, 201);
  const preview = await res.json();
  assert.equal(preview.rowCount, 2);
  assert.equal(preview.mapping.permitNumber, 'Project Number');
  assert.equal(preview.mapping.generalContractor, 'Contractor');
  const commit = (await call(`/imports/${preview.id}/commit`, { method: 'POST', body: { mapping: preview.mapping } })).body;
  assert.equal(commit.created, 1);
  assert.equal(commit.problems.length, 1);
  const p = (await call('/projects?sourceId=constructconnect')).body.items[0];
  assert.equal(p.recordClass, 'third_party');
  assert.equal(p.provenance.generalContractor, 'third_party');
  assert.equal(p.generalContractor, 'BuildCo');
  assert.equal(p.displayName, 'Harbor Logistics Park');
  assert.equal(p.sourceRecordUrl, 'https://app.constructconnect.com/p/77');
  assert.equal(p.score.breakdown.find((b) => b.key === 'timing').points, 20, 'open bid deadline');
  const v = (await call(`/projects/${p.id}/verify`, { method: 'POST' })).body.verification;
  assert.equal(v.status, 'unavailable');
  assert.match(v.message, /Source unavailable — verification pending/);
  const exportCsv = await (await fetch(`${base}/projects/export.csv`)).text();
  assert.match(exportCsv.split('\n')[0], /permitNumber,.*sourceRecordUrl/);
  assert.ok(exportCsv.includes('CC-77'));
});

test('documents are encrypted, extracted facts need review, expiry warnings show, and sensitive files cannot be used in outreach', async () => {
  const text = 'STATE OF CALIFORNIA CONTRACTORS STATE LICENSE BOARD\nLicense Number: 1234567 Classification: C-27 Landscaping\nIssue Date: 01/15/2024 Expiration Date: 01/31/2020';
  const res = await fetch(`${base}/documents?filename=license.txt&type=contractor_license&mimetype=text/plain`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: text });
  assert.equal(res.status, 201);
  const doc = await res.json();
  assert.equal(doc.encrypted, true);
  assert.equal(doc.extracted.licenseNumber, '1234567');
  assert.equal(doc.expirationDate, '2020-01-31');
  assert.equal(doc.reviewStatus, 'pending_review');
  assert.equal(doc.status, 'expired');
  assert.match(doc.warning, /Expired/);
  const stored = fs.readFileSync(path.join(dataDir, 'documents', `${doc.id}.enc`));
  assert.ok(!stored.toString('utf8').includes('1234567'), 'file on disk is not plaintext');
  const dl = await fetch(`${base}/documents/${doc.id}/download`);
  assert.equal((await dl.text()), text, 'download decrypts');
  const warnings = (await call('/documents')).body.warnings;
  assert.ok(warnings.some((w) => w.id === doc.id));
  // W-9 is sensitive → never approvable for outreach
  const w9 = await (await fetch(`${base}/documents?filename=w9.txt&type=w9&mimetype=text/plain`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'Form W-9 EIN 12-3456789' })).json();
  assert.equal(w9.minRole, 'owner');
  assert.equal((await call(`/documents/${w9.id}`, { method: 'PATCH', body: { approvedForOutreach: true } })).status, 400);
  // reviewed license with a future date becomes current only once a person verifies it
  const reviewed = (await call(`/documents/${doc.id}`, { method: 'PATCH', body: { expirationDate: '2099-01-31', reviewStatus: 'approved', statusVerified: true, approvedForOutreach: true, outreachSummary: 'a California-licensed C-27 landscaping contractor' } })).body;
  assert.equal(reviewed.status, 'current');
  const unverified = (await call(`/documents/${doc.id}`, { method: 'PATCH', body: { statusVerified: false } })).body;
  assert.equal(unverified.status, 'unverified');
});

test('role keys restrict document access and owner-only actions', async () => {
  process.env.DASHBOARD_API_KEY = 'owner-key';
  process.env.DASHBOARD_VIEWER_KEY = 'viewer-key';
  try {
    assert.equal((await call('/documents')).status, 401);
    const viewer = await call('/documents', { headers: { authorization: 'Bearer viewer-key' } });
    assert.equal(viewer.status, 200);
    assert.ok(viewer.body.items.every((d) => d.minRole === 'viewer'), 'viewer sees only viewer-level documents');
    assert.equal((await call('/automations/pause-all', { method: 'POST', headers: { authorization: 'Bearer viewer-key' } })).status, 403);
    assert.equal((await call('/automations/pause-all', { method: 'POST', headers: { authorization: 'Bearer owner-key' } })).status, 200);
    await call('/automations/resume-all', { method: 'POST', headers: { authorization: 'Bearer owner-key' } });
  } finally {
    delete process.env.DASHBOARD_API_KEY;
    delete process.env.DASHBOARD_VIEWER_KEY;
  }
});

test('onboarding tracks steps, allows skipping optional ones only, and dashboard metrics link to records', async () => {
  const ob = (await call('/onboarding')).body;
  assert.equal(ob.steps.length, 8);
  assert.equal(ob.showWizard, true);
  assert.equal((await call('/onboarding/step/company', { method: 'POST', body: { status: 'skipped' } })).status, 400, 'required step cannot be skipped');
  assert.equal((await call('/onboarding/step/documents', { method: 'POST', body: { status: 'skipped' } })).status, 200);
  const after2 = (await call('/onboarding')).body;
  assert.equal(after2.steps.find((s) => s.id === 'documents').status, 'skipped');
  const dash = (await call('/dashboard')).body;
  assert.equal(dash.metrics.length, 10);
  assert.ok(dash.metrics.every((m) => m.filter || m.link));
  assert.ok(dash.map.length >= 1);
  assert.equal(dash.metrics.find((m) => m.key === 'decision_makers').value, 1);
});
