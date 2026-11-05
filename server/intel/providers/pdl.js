// People Data Labs. Docs: https://docs.peopledatalabs.com/docs/person-search-api,
// https://docs.peopledatalabs.com/docs/person-enrichment-api,
// https://docs.peopledatalabs.com/docs/company-enrichment-api
// Auth: `X-Api-Key` header. Pay-as-you-go credits; Person Search supports an
// Elasticsearch-style query by current company and job title.
import { callJson } from './index.js';

export const INFO = {
  id: 'pdl', name: 'People Data Labs', website: 'https://www.peopledatalabs.com/', docs: 'https://docs.peopledatalabs.com/',
  capabilities: { peopleSearchByCompanyAndTitle: true, personEnrichment: true, emailVerification: 'no dedicated verifier; work_email with confidence', companyEnrichment: true, linkedinUrlReturned: true, phones: 'extra fields, consent handling required' },
  credentials: [{ key: 'apiKey', label: 'API key', help: 'PDL dashboard → API Keys. Free tier gives a small number of credits per month.' }],
};
export const isConfigured = (cfg) => Boolean(cfg?.apiKey);
const BASE = 'https://api.peopledatalabs.com/v5';
const headers = (cfg) => ({ 'X-Api-Key': cfg.apiKey });

function toCandidate(p) {
  return {
    provider: 'pdl', providerId: p.id || null, firstName: p.first_name || null, lastName: p.last_name || null, title: p.job_title || null,
    company: p.job_company_name || null, companyDomain: p.job_company_website || null, email: p.work_email || null, emailStatus: p.work_email ? 'pdl work_email' : null,
    phone: p.phone_numbers?.[0] || null, linkedinUrl: p.linkedin_url ? `https://${p.linkedin_url.replace(/^https?:\/\//, '')}` : null, location: p.location_name || null,
    sourceUrl: p.linkedin_url ? `https://${p.linkedin_url.replace(/^https?:\/\//, '')}` : null, sourceLabel: 'People Data Labs person search', raw: { job_title_role: p.job_title_role, job_title_levels: p.job_title_levels, likelihood: p.likelihood },
  };
}

export async function searchPeople(cfg, { company, domain, titles = [], limit = 10, fetchImpl }) {
  const must = [];
  if (domain) must.push({ term: { job_company_website: domain } }); else if (company) must.push({ match: { job_company_name: company } });
  if (titles.length) must.push({ bool: { should: titles.map((t) => ({ match_phrase: { job_title: t } })), minimum_should_match: 1 } });
  const data = await callJson('pdl', `${BASE}/person/search`, { method: 'POST', headers: headers(cfg), body: { size: Math.min(limit, 25), query: { bool: { must } }, pretty: false }, fetchImpl });
  return (data?.data || []).map(toCandidate);
}

export async function enrichPerson(cfg, { firstName, lastName, company, linkedinUrl, email, fetchImpl }) {
  const q = new URLSearchParams({ min_likelihood: '6' });
  if (linkedinUrl) q.set('profile', linkedinUrl);
  if (email) q.set('email', email);
  if (firstName && lastName) q.set('name', `${firstName} ${lastName}`);
  if (company) q.set('company', company);
  const data = await callJson('pdl', `${BASE}/person/enrich?${q}`, { headers: headers(cfg), fetchImpl }).catch((e) => { if (e.status === 404) return null; throw e; });
  return data?.data ? toCandidate(data.data) : null;
}

export async function verifyEmail(cfg, email, { fetchImpl } = {}) {
  const c = await enrichPerson(cfg, { email, fetchImpl });
  return { status: c?.email && c.email.toLowerCase() === email.toLowerCase() ? 'risky' : 'unknown', detail: c ? 'PDL matched a person to this address (not a deliverability check)' : 'PDL has no record for this address' };
}

export async function enrichCompany(cfg, { domain, name, fetchImpl }) {
  const q = new URLSearchParams();
  if (domain) q.set('website', domain); else if (name) q.set('name', name); else return null;
  const data = await callJson('pdl', `${BASE}/company/enrich?${q}`, { headers: headers(cfg), fetchImpl }).catch((e) => { if (e.status === 404) return null; throw e; });
  const c = data;
  return c?.name ? { name: c.display_name || c.name, domain: c.website, website: c.website ? `https://${c.website}` : null, industry: c.industry, size: c.employee_count || c.size, linkedinUrl: c.linkedin_url ? `https://${c.linkedin_url}` : null, location: c.location?.name, phone: null, sourceLabel: 'People Data Labs company enrichment' } : null;
}
