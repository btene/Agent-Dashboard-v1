// Hunter.io API v2. Docs: https://hunter.io/api-documentation/v2
// Auth: `api_key` query parameter. Domain Search lists people found publicly
// on a company's domain (with job titles and LinkedIn URLs where known);
// Email Finder guesses+verifies an address for a named person; Email
// Verifier checks deliverability. Hunter has no "search by title" index: we
// fetch the domain and filter titles locally.
import { callJson } from './index.js';

export const INFO = {
  id: 'hunter', name: 'Hunter.io', website: 'https://hunter.io/', docs: 'https://hunter.io/api-documentation/v2',
  capabilities: { peopleSearchByCompanyAndTitle: 'domain search, titles filtered locally', personEnrichment: 'email finder by name + domain', emailVerification: true, companyEnrichment: true, linkedinUrlReturned: true, phones: 'rarely' },
  credentials: [{ key: 'apiKey', label: 'API key', help: 'Hunter → API → your secret API key. Free plan includes a small monthly allowance.' }],
};
export const isConfigured = (cfg) => Boolean(cfg?.apiKey);
const BASE = 'https://api.hunter.io/v2';

function toCandidate(e, domain, company) {
  return {
    provider: 'hunter', providerId: e.email || null, firstName: e.first_name || null, lastName: e.last_name || null, title: e.position || null,
    company: company || domain, companyDomain: domain, email: e.value || e.email || null, emailStatus: e.verification?.status || e.confidence != null ? `confidence ${e.confidence}` : null,
    phone: e.phone_number || null, linkedinUrl: e.linkedin || e.linkedin_url || null, location: null,
    sourceUrl: e.sources?.[0]?.uri || e.linkedin || null, sourceLabel: `Hunter.io domain search (${(e.sources || []).length} public source${(e.sources || []).length === 1 ? '' : 's'})`,
    raw: { confidence: e.confidence, department: e.department, seniority: e.seniority, sources: (e.sources || []).slice(0, 5).map((s) => s.uri) },
  };
}

export async function searchPeople(cfg, { company, domain, titles = [], limit = 10, fetchImpl }) {
  if (!domain) return [];
  const data = await callJson('hunter', `${BASE}/domain-search?domain=${encodeURIComponent(domain)}&limit=100&type=personal&api_key=${encodeURIComponent(cfg.apiKey)}`, { fetchImpl });
  const emails = data?.data?.emails || [];
  const want = titles.map((t) => t.toLowerCase());
  const scored = emails.map((e) => ({ e, hit: want.some((t) => String(e.position || '').toLowerCase().includes(t.split(' ').pop())) }));
  return scored.filter((x) => want.length === 0 || x.hit).slice(0, limit).map(({ e }) => toCandidate(e, domain, data?.data?.organization || company));
}

export async function enrichPerson(cfg, { firstName, lastName, domain, company, fetchImpl }) {
  if (!domain || !firstName || !lastName) return null;
  const data = await callJson('hunter', `${BASE}/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${encodeURIComponent(cfg.apiKey)}`, { fetchImpl });
  const d = data?.data;
  if (!d?.email) return null;
  return { provider: 'hunter', firstName: d.first_name, lastName: d.last_name, title: d.position || null, company: d.company || company, companyDomain: d.domain, email: d.email, emailStatus: `score ${d.score}`, phone: d.phone_number || null, linkedinUrl: d.linkedin_url || null, sourceUrl: d.sources?.[0]?.uri || null, sourceLabel: 'Hunter.io email finder', raw: { score: d.score, verification: d.verification } };
}

export async function verifyEmail(cfg, email, { fetchImpl } = {}) {
  const data = await callJson('hunter', `${BASE}/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(cfg.apiKey)}`, { fetchImpl });
  const d = data?.data || {};
  const map = { valid: 'valid', invalid: 'invalid', accept_all: 'risky', webmail: 'risky', disposable: 'invalid', unknown: 'unknown' };
  return { status: map[d.status] || 'unknown', detail: `Hunter: ${d.status || 'unknown'}${d.result ? ` (${d.result})` : ''}, score ${d.score ?? 'n/a'}` };
}

export async function enrichCompany(cfg, { domain, fetchImpl }) {
  if (!domain) return null;
  const data = await callJson('hunter', `${BASE}/companies/find?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(cfg.apiKey)}`, { fetchImpl });
  const c = data?.data;
  return c ? { name: c.name, domain: c.domain, website: c.site?.url || `https://${c.domain}`, industry: c.category?.industry, size: c.metrics?.employees, linkedinUrl: c.linkedin?.handle ? `https://www.linkedin.com/${c.linkedin.handle}` : null, location: c.location, phone: c.phone, sourceLabel: 'Hunter.io company enrichment' } : null;
}
