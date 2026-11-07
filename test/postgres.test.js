// Runs the platform on a real Postgres engine (PGlite, in-process) the way it
// runs on Vercel + Supabase: several instances sharing one database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createStore } from '../server/store.js';
import { createPostgresAdapter } from '../server/persistence/postgres.js';
import { createApp } from '../server/app.js';

let db;
before(async () => { db = new PGlite(); await db.waitReady; process.env.DOCUMENT_ENCRYPTION_KEY = 'test-phrase-for-documents'; });
after(async () => { delete process.env.DOCUMENT_ENCRYPTION_KEY; delete process.env.CRON_SECRET; await db.close(); });

const newStore = async () => { const s = createStore({ adapter: createPostgresAdapter(db) }); await s.ready; return s; };

test('two instances share data through Postgres: inserts, updates, deletes', async () => {
  const a = await newStore();
  const b = await newStore();
  a.insert('companies', { id: 'co_1', name: 'Example Builders', environment: 'live' });
  a.insert('companies', { id: 'co_2', name: 'Second Co', environment: 'live' });
  await a.flush();
  assert.equal(b.list('companies').length, 0);
  await b.sync();
  assert.equal(b.list('companies').length, 2);
  const refB = b.get('companies', 'co_1');
  a.update('companies', 'co_1', { website: 'https://example.test' });
  a.remove('companies', 'co_2');
  await a.flush();
  await b.sync();
  assert.equal(b.get('companies', 'co_1').website, 'https://example.test');
  assert.equal(b.get('companies', 'co_1'), refB, 'existing object is updated in place');
  assert.equal(b.get('companies', 'co_2'), null);
  // removeWhere and unsaved local edits
  b.update('companies', 'co_1', { notes: 'local edit' });
  a.update('companies', 'co_1', { notes: 'remote edit' }); await a.flush();
  await b.sync();
  assert.equal(b.get('companies', 'co_1').notes, 'local edit', 'an unsaved local edit is not overwritten');
  await b.flush();
  await a.sync();
  assert.equal(a.get('companies', 'co_1').notes, 'local edit');
  a.removeWhere('companies', () => true); await a.flush();
  const c = await newStore();
  assert.equal(c.list('companies').length, 0, 'a fresh instance (cold start) sees the deletes');
});

test('full platform on Postgres: data survives a cold start, documents are stored encrypted, cron is protected', async () => {
  const s1 = await newStore();
  const { app, initialized } = createApp({ store: s1, seed: true, scheduler: { autoStart: false } });
  await initialized;
  const srv = app.listen(0); await new Promise((r) => srv.once('listening', r));
  const base = `http://localhost:${srv.address().port}/api/v1`;
  const call = async (p, o = {}) => { const r = await fetch(base + p, { method: o.method || 'GET', headers: { 'content-type': 'application/json', ...(o.headers || {}) }, body: o.body ? (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)) : undefined }); return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }; };

  assert.ok((await call('/projects?environment=demo&includeExcluded=true')).body.total >= 5, 'demo seeded on first start');
  await call('/settings', { method: 'PATCH', body: { company: { senderName: 'Pat Owner' } } });
  const contact = (await call('/contacts', { method: 'POST', body: { firstName: 'Dana', lastName: 'Lee', email: 'dana@example.test', role: 'estimator' } })).body;
  const docRes = await fetch(`${base}/documents?filename=license.txt&type=contractor_license&mimetype=text/plain`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'License Number: 1234567 Expiration Date: 01/31/2099' });
  const doc = await docRes.json();
  assert.equal(docRes.status, 201);
  assert.match(doc.id, /^doc_/);
  srv.close();

  // Encrypted bytes are in Postgres, not plaintext.
  const { rows } = await db.query('SELECT content FROM als.files WHERE id = $1', [doc.id]);
  assert.equal(rows.length, 1);
  assert.ok(!Buffer.from(rows[0].content).toString('utf8').includes('1234567'));

  // Cold start: a brand-new instance loads everything from the database.
  const s2 = await newStore();
  process.env.CRON_SECRET = 'cron-test-secret';
  const app2 = createApp({ store: s2, seed: true, scheduler: { autoStart: false } });
  await app2.initialized;
  const srv2 = app2.app.listen(0); await new Promise((r) => srv2.once('listening', r));
  const base2 = `http://localhost:${srv2.address().port}/api/v1`;
  const call2 = async (p, o = {}) => { const r = await fetch(base2 + p, { method: o.method || 'GET', headers: { 'content-type': 'application/json', ...(o.headers || {}) }, body: o.body ? JSON.stringify(o.body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  assert.equal((await call2('/settings')).body.company.senderName, 'Pat Owner');
  assert.equal((await call2('/contacts')).body.find((c) => c.id === contact.id).email, 'dana@example.test');
  assert.equal((await call2('/projects?environment=demo&includeExcluded=true')).body.total, 5, 'demo data is not seeded twice');
  const dl = await fetch(`${base2}/documents/${doc.id}/download`);
  assert.equal(await dl.text(), 'License Number: 1234567 Expiration Date: 01/31/2099');

  // Cron endpoint: refuses without the secret, runs due automations with it.
  assert.equal((await call2('/cron/daily')).status, 401);
  assert.equal((await call2('/cron/daily', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  await call2('/automations/permit_monitoring', { method: 'PATCH', body: { enabled: false } });
  const cron = await call2('/cron/daily', { headers: { authorization: 'Bearer cron-test-secret' } });
  assert.equal(cron.status, 200);
  assert.equal(cron.body.results.length, 11);
  assert.ok(cron.body.results.find((r) => r.id === 'crm_sync').status === 'ok');
  srv2.close();

  // A third instance sees the job history written by the cron run.
  const s3 = await newStore();
  const app3 = createApp({ store: s3, seed: true, scheduler: { autoStart: false } });
  await app3.initialized;
  const snap = app3.scheduler.snapshot().find((a) => a.id === 'crm_sync');
  assert.equal(snap.status, 'ok');
  assert.ok(snap.lastSuccessAt);
});

test('without a database or keys the API explains what to set up instead of losing data', async () => {
  const { app } = createApp({ store: createStore({ persist: false }), seed: false, scheduler: { autoStart: false }, setupError: 'No database connected. In Vercel open this project → Storage → Create Database → Supabase.' });
  const srv = app.listen(0); await new Promise((r) => srv.once('listening', r));
  const base = `http://localhost:${srv.address().port}/api/v1`;
  const r = await fetch(`${base}/projects`);
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /Create Database → Supabase/);
  const meta = await (await fetch(`${base}/meta`)).json();
  assert.match(meta.platform.setupError, /Supabase/);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  srv.close();
});

test('instances starting at the same moment seed the sample data only once', async () => {
  const fresh = new PGlite(); await fresh.waitReady;
  const mk = () => createStore({ adapter: createPostgresAdapter(fresh) });
  const [s1, s2, s3] = [mk(), mk(), mk()];
  const apps = [s1, s2, s3].map((s) => createApp({ store: s, seed: true, scheduler: { autoStart: false } }));
  await Promise.all(apps.map((a) => a.initialized));
  const s4 = mk(); await s4.ready;
  assert.equal(s4.list('projects').filter((p) => p.environment === 'demo').length, 5);
  assert.equal(s4.list('settings').length, 1);
  assert.equal(s4.list('sources').length, apps[0].sourceService.list().length);
  await fresh.close();
});
