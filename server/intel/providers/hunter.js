// Hunter.io API v2 — written against https://hunter.io/api-documentation/v2 (verified Nov 2026).
//   Domain Search  GET /v2/domain-search?domain=… | company=… &type=personal&seniority=…&limit=…
//     Returns people whose addresses were found on public web pages or inferred from the
//     company pattern, with position, seniority, department, decision_maker, linkedin and
//     sources. 15 req/s, 500 req/min. Free plan: limit+offset may not exceed 10.
//   Email Finder   GET /v2/email-finder?domain=…&first_name=…&last_name=… (1 credit when found)
//   Email Verifier GET /v2/email-verifier?email=… (0.5 credit)
//   Company Enrichment GET /v2/companies/find?domain=…
// Auth: api_key query param, X-API-KEY header or Bearer. Errors: 403 = rate limit,
// 429 = usage limit, 451 = the person asked Hunter not to process their data (must be respected).
import { callJson } from './index.js';

export const INFO = {
  id: 'hunter', name: 'Hunter.io', website: 'https://hunter.io/', docs: 'https://hunter.io/api-documentation/v2',
  capabilities: {
    peopleSearchByCompanyAndTitle: 'Domain Search by domain or company name, filtered by seniority and decision-maker; titles matched locally',
    personEnrichment: 'Email Finder by name + domain',
    emailVerification: true,
    companyEnrichment: true,
    linkedinUrlReturned: 'when Hunter has it (linkedin field)',
    phones: 'rarely',
    searchNote: 'Every result cites the public web pages where the address was found, which makes it the most auditable source.',
  },
  pricing: 'Free $0 (50 credits/mo); Starter $49/mo ($34 billed yearly, 2,000 credits); Growth $149/mo ($104 yearly, 10,000); Scale $299/mo ($209 yearly, 25,000). Email found = 1 credit, verified = 0.5 credit.',
  credentials: [{ key: 'apiKey', label: 'API key', help: 'Hunter → API (hunter.io/api-keys). Free accounts get a key with 50 credits a month.' }],
};
export const isConfigured = (cfg) => Boolean(cfg?.apiKey);
const BASE = 'https://api.hunter.io/v2';
const STATUS = { 403: 'rate limit reached — wait a minute and retry', 429: 'monthly usage limit reached — upgrade or wait for the reset', 451: 'this person has asked not to be processed; skipped' };
const headers = (cfg) => ({ 'X-API-KEY': cfg.apiKey });

function toCandidate(e, domain, company) {
  const sources = e.sources || [];
  return {
    provider: 'hunter', providerId: e.value || null, firstName: e.first_name || null, lastName: e.last_name || null, title: e.position || null,
    company: company || domain, companyDomain: domain, email: e.value || null,
    emailStatus: e.verification?.status ? `Hunter verification: ${e.verification.status}` : `Hunter confidence ${e.confidence ?? 'n/a'}%`,
    emailVerification: e.verification?.status === 'valid' ? { status: 'valid', detail: `Hunter verified ${e.verification.date || ''}`.trim(), provider: 'hunter', checkedAt: new Date().toISOString() } : null,
    phone: e.phone_number || null, linkedinUrl: e.linkedin ? (String(e.linkedin).startsWith('http') ? e.linkedin : `https://www.linkedin.com/in/${e.linkedin}`) : null, location: null,
    sourceUrl: sources[0]?.uri || null, sourceLabel: `Hunter.io domain search — ${e.provenance === 'inferred' ? 'address inferred from company pattern' : `found on ${sources.length} public page${sources.length === 1 ? '' : 's'}`}`,
    raw: { confidence: e.confidence, department: e.department, seniority: e.seniority, decision_maker: e.decision_maker, provenance: e.provenance, sources: sources.slice(0, 5).map((s) => s.uri) },
  };
}

export async function searchPeople(cfg, { company, domain, titles = [], limit = 10, fetchImpl }) {
  if (!domain && !company) return [];
  const q = new URLSearchParams({ type: 'personal', limit: String(Math.min(limit, 10)) });
  if (domain) q.set('domain', domain); else q.set('company', company);
  q.set('seniority', 'senior,executive');
  const data = await callJson('hunter', `${BASE}/domain-search?${q}`, { headers: headers(cfg), fetchImpl, statusMessages: STATUS });
  const d = data?.data || {};
  const want = titles.map((t) => t.toLowerCase());
  const keywords = Array.from(new Set(want.flatMap((t) => t.split(/\s+/)).filter((w) => w.length > 4 && !['senior', 'director', 'manager', 'president'].includes(w))));
  return (d.emails || [])
    .filter((e) => !want.length || e.decision_maker || keywords.some((k) => String(e.position || '').toLowerCase().includes(k)))
    .map((e) => toCandidate(e, d.domain || domain, d.organization || company));
}

export async function enrichPerson(cfg, { firstName, lastName, domain, company, fetchImpl }) {
  if ((!domain && !company) || !firstName || !lastName) return null;
  const q = new URLSearchParams({ first_name: firstName, last_name: lastName });
  if (domain) q.set('domain', domain); else q.set('company', company);
  const data = await callJson('hunter', `${BASE}/email-finder?${q}`, { headers: headers(cfg), fetchImpl, statusMessages: STATUS }).catch((e) => { if (e.status === 404) return null; throw e; });
  const d = data?.data;
  if (!d?.email) return null;
  return { provider: 'hunter', firstName: d.first_name, lastName: d.last_name, title: d.position || null, company: d.company || company, companyDomain: d.domain, email: d.email, emailStatus: `Hunter score ${d.score}`, emailVerification: d.verification?.status === 'valid' ? { status: 'valid', detail: 'Hunter verified', provider: 'hunter', checkedAt: new Date().toISOString() } : null, phone: d.phone_number || null, linkedinUrl: d.linkedin_url || null, sourceUrl: d.sources?.[0]?.uri || null, sourceLabel: 'Hunter.io email finder', raw: { score: d.score } };
}

export async function verifyEmail(cfg, email, { fetchImpl } = {}) {
  const data = await callJson('hunter', `${BASE}/email-verifier?${new URLSearchParams({ email })}`, { headers: headers(cfg), fetchImpl, statusMessages: STATUS });
  const d = data?.data || {};
  const map = { valid: 'valid', invalid: 'invalid', accept_all: 'risky', webmail: 'risky', disposable: 'invalid', unknown: 'unknown' };
  return { status: map[d.status] || 'unknown', detail: `Hunter: ${d.status || 'unknown'}${d.result ? ` (${d.result})` : ''}, score ${d.score ?? 'n/a'}` };
}

export async function enrichCompany(cfg, { domain, fetchImpl }) {
  if (!domain) return null;
  const data = await callJson('hunter', `${BASE}/companies/find?${new URLSearchParams({ domain })}`, { headers: headers(cfg), fetchImpl, statusMessages: STATUS }).catch((e) => { if (e.status === 404) return null; throw e; });
  const c = data?.data;
  return c ? { name: c.name, domain: c.domain, website: c.site?.url || `https://${c.domain}`, industry: c.category?.industry, size: c.metrics?.employees, linkedinUrl: c.linkedin?.handle ? `https://www.linkedin.com/${c.linkedin.handle}` : null, location: c.location, phone: c.phone, sourceLabel: 'Hunter.io company enrichment' } : null;
}
