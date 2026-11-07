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
      const u = new URL(req.url, 'http://x');
      if (u.pathname.startsWith('/api/v1/') && req.headers['x-api-key'] !== 'apollo-key') { res.writeHead(401); return res.end('{}'); }
      if (u.pathname === '/api/v1/mixed_companies/search') {
        assert.equal(req.method, 'POST');
        return res.end(JSON.stringify({ organizations: [{ id: 'org1', name: u.searchParams.get('q_organization_name'), primary_domain: 'samplebuilders.test' }] }));
      }
      if (u.pathname === '/api/v1/mixed_people/api_search') {
        // Real API: query-string params, partial names, no email/LinkedIn.
        assert.deepEqual(u.searchParams.getAll('q_organization_domains_list[]'), ['samplebuilders.test']);
        assert.ok(u.searchParams.getAll('person_titles[]').length > 5);
        return res.end(JSON.stringify({ people: [
          { id: 'p1', first_name: 'Maria', last_name_obfuscated: 'Go***z', title: 'Chief Estimator', has_email: true, organization: { name: 'Sample Builders' } },
          { id: 'p2', first_name: 'Tom', last_name_obfuscated: 'Re***d', title: 'Marketing Coordinator', has_email: false, organization: { name: 'Sample Builders' } },
        ] }));
      }
      if (u.pathname === '/api/v1/people/match') {
        assert.equal(u.searchParams.get('reveal_phone_number'), 'false');
        if (u.searchParams.get('id') === 'p1') return res.end(JSON.stringify({ person: { id: 'p1', first_name: 'Maria', last_name: 'Gomez', title: 'Chief Estimator', email: 'maria@samplebuilders.test', email_status: 'verified', linkedin_url: 'http://www.linkedin.com/in/maria-gomez-test', city: 'Los Angeles', state: 'CA', organization: { name: 'Sample Builders', primary_domain: 'samplebuilders.test' } } }));
        return res.end(JSON.stringify({ person: null }));
      }
      if (u.pathname === '/v2/email-verifier') return res.end(JSON.stringify({ data: { status: 'valid', result: 'deliverable', score: 97 } }));
      if (u.pathname === '/v2/domain-search') { assert.ok(u.searchParams.get('company') === 'Sample Builders' || u.searchParams.get('domain') === 'samplebuilders.test'); assert.equal(req.headers['x-api-key'], 'hunter-key'); return res.end(JSON.stringify({ data: { domain: 'samplebuilders.test', organization: 'Sample Builders', emails: [{ value: 'j.lee@samplebuilders.test', first_name: 'Jin', last_name: 'Lee', position: 'Director of Preconstruction', seniority: 'senior', decision_maker: true, confidence: 90, provenance: 'found', sources: [{ uri: 'https://samplebuilders.test/team' }] }] } })); }
      if (u.pathname === '/api/v1/organizations/enrich') return res.end(JSON.stringify({ organization: { name: 'Sample Builders', primary_domain: 'samplebuilders.test', website_url: 'https://samplebuilders.test' } }));
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
  let maria = r.candidates.find((c) => c.firstName === 'Maria');
  const tom = r.candidates.find((c) => c.firstName === 'Tom');
  assert.ok(maria.score.total > tom.score.total, 'estimator outranks marketing');
  assert.equal(maria.needsReveal, true, 'Apollo search hides the surname');
  assert.equal(maria.lastName, null);
  assert.equal(maria.email, null);
  assert.equal(maria.projectConnection, 'company_named_on_record');
  const jin = r.candidates.find((c) => c.lastName === 'Lee');
  assert.match(jin.sourceLabel, /found on 1 public page/);
  assert.equal(jin.sourceUrl, 'https://samplebuilders.test/team');
  // cannot save until revealed
  assert.equal((await call(`/candidates/${maria.id}/save`, { method: 'POST', body: {} })).status, 409);
  maria = (await call(`/candidates/${maria.id}/reveal`, { method: 'POST' })).body;
  assert.equal(maria.lastName, 'Gomez');
  assert.equal(maria.email, 'maria@samplebuilders.test');
  assert.equal(maria.emailVerification.status, 'valid');
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
  const again = r.candidates.find((c) => c.firstName === 'Maria');
  assert.equal(again.id, maria.id, 're-running the search updates the same candidate instead of creating a new one');
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

test('Ventura County weekly report parser reads entries and classifies abbreviations', async () => {
  const { parseReport, reportUrls } = await import('../server/intel/connectors/venturaPdf.js');
  const text = ['County of Ventura - Division of Building and Safety Report of Permits', 'Issued for the Week Ending 7/18/2026', 'East County Office', 'Date of Issuance: July 13, 2026', 'Permit Type: Combo', 'Parcel NumberAddressPermit NumberProject Type', 'Valuation',
    '341 WILLIAMSBURG WY, ', 'WESTLAKE VILLAGE, CA ', '91361', 'BP25-04052Building Permit', '$1,161,615.00', 'Lake Sherwood Miramar Club Fitness ', 'Building/Pool House-Improvements', '6950390155', 'Yes',
    '535 N PARK SPRINGS ', 'CT, OAK PARK, CA   91377', 'BP26-01856Building Permit$1,400.00', 'Remove and replace 8 retrofit windows', '8010161095Yes'].join('\n');
  const e = parseReport(text);
  assert.equal(e.length, 2);
  assert.equal(e[0].permitNumber, 'BP25-04052');
  assert.equal(e[0].valuation, 1161615);
  assert.equal(e[0].address, '341 WILLIAMSBURG WY, WESTLAKE VILLAGE, CA 91361');
  assert.equal(e[0].apn, '6950390155');
  assert.equal(e[0].issuedOn, '2026-07-13');
  assert.equal(e[1].valuation, 1400);
  assert.ok(reportUrls(new Date('2026-01-12T00:00:00Z')).some((u) => u.includes('2026-1-12-')));
  assert.equal(classifyProject({ permitType: 'Combo · NSFR', description: 'NSFR 5633 SF, attached garage 946 SF' }).projectType, 'residential_small');
});

test('Riverside County landscape permits count as a documented landscape scope', async () => {
  const { riversideCounty } = await import('../server/intel/connectors/regional.js');
  const fakeFetch = async () => new Response(JSON.stringify({ features: [
    { attributes: { CASE_ID: 'LSP260023', CASE_DESCR: 'LS PLANS FOR VETERANS HOMEWOOD SUITES HOTEL', CASE_TYPE: 'LANDSCAPE PERMIT (LSP)', CASE_WORK_CLASS: 'LSP01 - LANDSCAPE PERMIT', CASE_STATUS: 'PAYMENT PENDING', APPLIED_DATE: Date.parse('2026-10-15'), APPROVED_DATE: null, APN: '294720002' }, geometry: { rings: [[[-117.2, 33.9], [-117.1, 33.9], [-117.1, 34.0]]] } },
    { attributes: { CASE_ID: 'LSP260023', CASE_DESCR: 'LS PLANS FOR VETERANS HOMEWOOD SUITES HOTEL', CASE_TYPE: 'LANDSCAPE PERMIT (LSP)', APPLIED_DATE: Date.parse('2026-10-15'), APN: '294720003' }, geometry: null },
  ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const recs = await riversideCounty.discover({ id: 'riverside-county-plus', name: 'R', agency: 'RC', config: { layerUrl: 'https://gis.countyofriverside.us/x/MapServer/280' } }, { fetchImpl: fakeFetch });
  assert.equal(recs.length, 1, 'duplicate parcel rows merge into one case');
  assert.match(recs[0].address, /APN 294720002, 294720003/);
  assert.match(recs[0].landscapeScopeDocumented, /landscape permit LSP260023/);
  assert.match(recs[0].sourceRecordUrl, /CASE_ID%3D%27LSP260023%27/);
  assert.equal(recs[0].valuation, null, 'no valuation is invented');
  assert.equal(recs[0].applicant, null);
});

test('verifying against a source never erases facts the team researched', async () => {
  const { buildProject, applySourceUpdate } = await import('../server/intel/projects.js');
  const rec = { sourceId: 's', sourceName: 'S', recordClass: 'government', permitNumber: 'X1', address: '1 A St', description: 'NEW EIGHT-STORY MIXED-USE BUILDING', permitType: 'Commercial', status: 'Issued', applicant: null, raw: {} };
  const p = buildProject(rec, { id: 'p1' });
  p.applicant = 'Example Developer LLC'; p.provenance.applicant = 'user';
  let changes = applySourceUpdate(p, { ...rec });
  assert.equal(p.applicant, 'Example Developer LLC');
  assert.equal(p.provenance.applicant, 'user');
  assert.equal(changes.length, 0);
  changes = applySourceUpdate(p, { ...rec, applicant: 'Official Applicant Inc' });
  assert.equal(p.applicant, 'Official Applicant Inc', 'a real value from the agency still wins');
  assert.equal(p.provenance.applicant, 'government');
  assert.equal(changes[0].field, 'applicant');
  assert.equal(p.classification.landscapeRelevance, 'strong', 'spelled-out story counts as new construction');
});
