import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { scoreCandidate, titleRelevance, linkedinLinks } from '../server/intel/research.js';
import { classifyProject } from '../server/intel/classify.js';
import { styleForContact } from '../server/intel/email.js';
import { createReplyService } from '../server/intel/replies.js';

// Fake Apollo + Hunter endpoints so the research engine can be exercised end to end.
function fakeProviders() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/api/v1/mixed_people/search')) {
        if (req.headers['x-api-key'] !== 'apollo-key') { res.writeHead(401); return res.end('{}'); }
        const q = JSON.parse(body);
        return res.end(JSON.stringify({ people: [
          { id: 'p1', first_name: 'Maria', last_name: 'Gomez', title: 'Chief Estimator', email: 'maria@samplebuilders.test', email_status: 'verified', linkedin_url: 'https://www.linkedin.com/in/maria-gomez-test', city: 'Los Angeles', state: 'CA', organization: { name: q.q_organization_name, primary_domain: 'samplebuilders.test' } },
          { id: 'p2', first_name: 'Tom', last_name: 'Reed', title: 'Marketing Coordinator', email: 'email_not_unlocked@domain.com', linkedin_url: null, organization: { name: q.q_organization_name } },
        ] }));
      }
      if (req.url.startsWith('/v2/email-verifier')) return res.end(JSON.stringify({ data: { status: 'valid', result: 'deliverable', score: 97 } }));
      if (req.url.startsWith('/v2/domain-search')) return res.end(JSON.stringify({ data: { organization: 'Sample Builders', emails: [{ value: 'j.lee@samplebuilders.test', first_name: 'Jin', last_name: 'Lee', position: 'Director of Preconstruction', confidence: 90, sources: [{ uri: 'https://samplebuilders.test/team' }] }] } }));
      if (req.url.startsWith('/api/v1/organizations/enrich')) return res.end(JSON.stringify({ organization: { name: 'Sample Builders', primary_domain: 'samplebuilders.test', website_url: 'https://samplebuilders.test' } }));
      res.writeHead(404); res.end('{}');
    });
  });
}

let server; let base; let fake; let ctx;
before(async () => {
  fake = fakeProviders().listen(0);
  await new Promise((r) => fake.once('listening', r));
  const fakeBase = `http://localhost:${fake.address().port}`;
  const fetchImpl = (url, opts) => fetch(url.replace(/^https:\/\/[^/]+/, fakeBase), opts);
  ctx = createApp({ store: createStore({ persist: false }), seed: false, scheduler: { autoStart: false }, fetchImpl });
  server = ctx.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api/v1`;
});
after(() => { server.close(); fake.close(); });
const call = async (p, opts = {}) => { const res = await fetch(base + p, { method: opts.method || 'GET', headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined }); return { status: res.status, body: res.status === 204 ? null : await res.json() }; };

test('landscape relevance separates genuine opportunities from general permits', () => {
  const ti = classifyProject({ permitType: 'Bldg-Alter/Repair', permitSubType: 'Commercial', description: 'INTERIOR TENANT IMPROVEMENT FOR OFFICE SUITE 400, NEW PARTITIONS AND CEILING', useDescription: 'Office' });
  assert.equal(ti.landscapeRelevance, 'unlikely');
  assert.ok(ti.nonLandscapeWork.includes('interior tenant improvement'));
  const roof = classifyProject({ permitType: 'Bldg-Alter/Repair', permitSubType: 'Commercial', description: 'RE-ROOF EXISTING WAREHOUSE', useDescription: 'Warehouse' });
  assert.equal(roof.landscapeRelevance, 'unlikely');
  assert.equal(roof.opportunityType, 'unlikely', 'an alteration on an existing building is not a landscape opportunity by itself');
  const hotel = classifyProject({ permitType: 'Bldg-New', permitSubType: 'Commercial', description: 'NEW 4 STORY 120 ROOM HOTEL WITH POOL COURTYARD AND LANDSCAPE PER PLANS', useDescription: 'Hotel', squareFootage: 90000 });
  assert.equal(hotel.landscapeRelevance, 'strong');
  assert.equal(hotel.opportunityType, 'both');
  const grading = classifyProject({ permitType: 'Grading', permitSubType: 'Commercial', description: 'ROUGH GRADING FOR NEW DISTRIBUTION CENTER', useDescription: 'Warehouse' });
  assert.equal(grading.landscapeRelevance, 'strong');
});

test('title relevance and contact score explain themselves', () => {
  assert.ok(titleRelevance('Chief Estimator', 'construction').score >= 0.9);
  assert.ok(titleRelevance('Regional Property Manager', 'maintenance').score >= 0.9);
  assert.ok(titleRelevance('Marketing Coordinator', 'construction').score < 0.1);
  const s = scoreCandidate({ title: 'VP of Construction', email: 'a@b.test', emailVerification: { status: 'valid', detail: 'ok' }, linkedinUrl: 'x', sourceLabel: 'test' }, { project: { provenance: { generalContractor: 'government' } }, companyRole: 'generalContractor', opportunityType: 'construction' });
  assert.equal(s.parts.reduce((a, p) => a + p.max, 0), 100);
  assert.ok(s.total >= 80, `score ${s.total}`);
  assert.match(s.parts[1].reason, /NOT confirmed/);
  const links = linkedinLinks({ company: 'Sample Builders', titles: ['Chief Estimator'] });
  assert.ok(links.every((l) => l.url.startsWith('https://www.linkedin.com/') || l.url.startsWith('https://www.google.com/')));
});

test('email style follows the contact role', () => {
  assert.equal(styleForContact({ role: 'estimator' }), 'bid_response');
  assert.equal(styleForContact({ role: 'other', title: 'Regional Property Manager' }), 'maintenance');
  assert.equal(styleForContact({ role: 'developer' }), 'short_direct');
  assert.equal(styleForContact({ role: 'asset_manager' }, { classification: { opportunityType: 'construction' } }), 'relationship');
});

test('find decision-makers: providers, scoring, verification, dedupe into CRM, relationship flags', async () => {
  // A live project naming a GC (entered by the team from the agency record).
  ctx.sourceService.upsertRecords([{ sourceId: 'la-city-ladbs-permits', sourceName: 'LA', sourceAgency: 'LADBS', recordClass: 'government', permitNumber: 'R-1', address: '1 Test Way, Los Angeles, CA', streetAddress: '1 Test Way', city: 'Los Angeles', county: 'Los Angeles', state: 'CA', description: 'NEW 5 STORY OFFICE BUILDING WITH LANDSCAPE AND IRRIGATION', permitType: 'Bldg-New', permitSubType: 'Commercial', status: 'Issued', issuedAt: new Date().toISOString(), valuation: 9_000_000, squareFootage: 60_000, raw: {} }]);
  const project = (await call('/projects')).body.items[0];
  const noCompany = (await call(`/projects/${project.id}/research`, { method: 'POST', body: {} })).body;
  assert.equal(noCompany.candidateCount, 0);
  assert.match(noCompany.errors[0].message, /does not name a developer/);
  await call(`/projects/${project.id}`, { method: 'PATCH', body: { generalContractor: 'Sample Builders' } });
  // no providers enabled → LinkedIn links only
  let r = (await call(`/projects/${project.id}/research`, { method: 'POST', body: {} })).body;
  assert.equal(r.candidateCount, 0);
  assert.ok(r.linkedin[0].links.length >= 4);
  assert.match(r.errors[0].message, /No contact-data provider is enabled/);
  // enable Apollo + Hunter (fake)
  await call('/providers/apollo', { method: 'PATCH', body: { enabled: true, apiKey: 'apollo-key' } });
  await call('/providers/hunter', { method: 'PATCH', body: { enabled: true, apiKey: 'hunter-key' } });
  const pub = (await call('/settings')).body;
  assert.equal(pub.providers.apollo.apiKey, '••••••••', 'keys are redacted');
  r = (await call(`/projects/${project.id}/research`, { method: 'POST', body: {} })).body;
  assert.equal(r.providersUsed.length, 2);
  assert.ok(r.candidateCount >= 2);
  const maria = r.candidates.find((c) => c.lastName === 'Gomez');
  const tom = r.candidates.find((c) => c.lastName === 'Reed');
  assert.ok(maria.score.total > tom.score.total, 'estimator outranks marketing');
  assert.equal(tom.email, null, 'locked Apollo placeholder email is not stored');
  assert.equal(maria.projectConnection, 'company_named_on_record');
  // verify + save
  const verified = (await call(`/candidates/${maria.id}/verify-email`, { method: 'POST' })).body;
  assert.equal(verified.emailVerification.status, 'valid');
  const saved = (await call(`/candidates/${maria.id}/save`, { method: 'POST', body: { linkedinUrl: 'https://www.linkedin.com/in/maria-gomez-test' } })).body;
  assert.equal(saved.provenance, 'third_party');
  assert.ok(saved.linkedinVerifiedAt);
  assert.equal(saved.contactScore.total > 0, true);
  assert.deepEqual(saved.projectIds, [project.id]);
  // re-running dedupes rather than duplicating
  r = (await call(`/projects/${project.id}/research`, { method: 'POST', body: {} })).body;
  const again = (await call(`/candidates/${r.candidates.find((c) => c.lastName === 'Gomez').id}/save`, { method: 'POST', body: {} })).body;
  assert.equal(again.id, saved.id);
  assert.equal((await call('/contacts')).body.filter((c) => c.lastName === 'Gomez').length, 1);
  // relationship intelligence
  const rel = (await call('/relationships/check?company=Sample%20Builders')).body;
  assert.equal(rel.level, 'known');
  await call('/relationships', { method: 'POST', body: { type: 'past_project', companyName: 'Sample Builders', summary: 'Did the landscape on their Torrance warehouse in 2023' } });
  assert.equal((await call('/relationships/check?company=Sample%20Builders')).body.level, 'warm');
  const detail = (await call(`/projects/${project.id}/research`)).body;
  assert.equal(detail.companies[0].relationship.level, 'warm');
  // confirmations reflect verified contact + mentioned landscape scope
  const p2 = (await call(`/projects/${project.id}`)).body;
  assert.equal(p2.confirmations.contact.status, 'confirmed');
  assert.equal(p2.confirmations.landscapeScope.status, 'indicated');
  assert.equal(p2.confirmations.company.status, 'confirmed');
  // manual contact from LinkedIn
  const manual = (await call('/contacts/manual', { method: 'POST', body: { projectId: project.id, companyName: 'Sample Builders', companyRole: 'generalContractor', firstName: 'Ana', lastName: 'Silva', title: 'Director of Construction', linkedinUrl: 'https://www.linkedin.com/in/ana-silva-test', sourceNote: 'LinkedIn search' } })).body;
  assert.equal(manual.provenance, 'third_party');
  assert.ok(manual.linkedinVerifiedAt);
  // drafts pick the style from the role
  const email = (await call('/emails', { method: 'POST', body: { projectId: project.id, contactId: saved.id } })).body;
  assert.equal(email.style, 'bid_response');
  assert.match(email.body, /Hi Maria,/);
});

test('reply matching uses Message-ID first and sender+subject second', () => {
  const svc = createReplyService({ store: null, bus: null, settingsService: null, crmService: null });
  const sent = [{ id: 'e1', messageId: '<abc@als>', to: 'x@y.test', subject: 'Landscaping — Permit 1' }, { id: 'e2', messageId: null, to: 'z@y.test', subject: 'Landscaping — Permit 2' }];
  assert.equal(svc.matchSent({ inReplyTo: '<ABC@als>', from: { value: [{ address: 'other@y.test' }] }, subject: 'whatever' }, sent).email.id, 'e1');
  assert.equal(svc.matchSent({ references: ['<zzz>', '<abc@als>'], from: { value: [] } }, sent).email.id, 'e1');
  assert.equal(svc.matchSent({ from: { value: [{ address: 'Z@y.test' }] }, subject: 'RE: Landscaping — Permit 2' }, sent).email.id, 'e2');
  assert.equal(svc.matchSent({ from: { value: [{ address: 'nobody@y.test' }] }, subject: 'Hi' }, sent), null);
});
