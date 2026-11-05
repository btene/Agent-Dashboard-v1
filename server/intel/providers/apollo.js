// Apollo.io REST API. Docs: https://docs.apollo.io/reference/people-search,
// https://docs.apollo.io/reference/people-enrichment,
// https://docs.apollo.io/reference/organization-enrichment
// Auth: `x-api-key` header. API access requires a paid plan; email reveals
// consume credits. Search results do not include emails until enriched.
import { callJson } from './index.js';

export const INFO = {
  id: 'apollo', name: 'Apollo.io', website: 'https://www.apollo.io/', docs: 'https://docs.apollo.io/',
  capabilities: { peopleSearchByCompanyAndTitle: true, personEnrichment: true, emailVerification: 'as part of enrichment (email_status field)', companyEnrichment: true, linkedinUrlReturned: true, phones: 'extra credits; mobile numbers require consent handling' },
  credentials: [{ key: 'apiKey', label: 'API key', help: 'Apollo → Settings → Integrations → API. API access requires a paid plan.' }],
};
export const isConfigured = (cfg) => Boolean(cfg?.apiKey);
const BASE = 'https://api.apollo.io/api/v1';
const headers = (cfg) => ({ 'x-api-key': cfg.apiKey, 'cache-control': 'no-cache' });

function toCandidate(p) {
  return {
    provider: 'apollo', providerId: p.id || null,
    firstName: p.first_name || null, lastName: p.last_name || null, title: p.title || null,
    company: p.organization?.name || p.employment_history?.[0]?.organization_name || null, companyDomain: p.organization?.primary_domain || null,
    email: p.email && !/not_unlocked|email_not_unlocked/.test(p.email) ? p.email : null, emailStatus: p.email_status || null,
    phone: p.phone_numbers?.[0]?.sanitized_number || p.organization?.phone || null,
    linkedinUrl: p.linkedin_url || null, location: [p.city, p.state].filter(Boolean).join(', ') || null,
    sourceUrl: p.linkedin_url || null, sourceLabel: 'Apollo.io people search', raw: { seniority: p.seniority, departments: p.departments, headline: p.headline },
  };
}

export async function searchPeople(cfg, { company, domain, titles = [], limit = 10, fetchImpl }) {
  const body = { page: 1, per_page: Math.min(limit, 25), person_titles: titles.slice(0, 20) };
  if (domain) body.q_organization_domains_list = [domain]; else if (company) body.q_organization_name = company;
  const data = await callJson('apollo', `${BASE}/mixed_people/search`, { method: 'POST', headers: headers(cfg), body, fetchImpl });
  return (data?.people || []).map(toCandidate);
}

export async function enrichPerson(cfg, { firstName, lastName, company, domain, linkedinUrl, email, fetchImpl }) {
  const body = { reveal_personal_emails: false, reveal_phone_number: false };
  if (linkedinUrl) body.linkedin_url = linkedinUrl;
  if (email) body.email = email;
  if (firstName) body.first_name = firstName;
  if (lastName) body.last_name = lastName;
  if (domain) body.domain = domain; else if (company) body.organization_name = company;
  const data = await callJson('apollo', `${BASE}/people/match`, { method: 'POST', headers: headers(cfg), body, fetchImpl });
  return data?.person ? toCandidate(data.person) : null;
}

export async function verifyEmail(cfg, email, { fetchImpl } = {}) {
  const c = await enrichPerson(cfg, { email, fetchImpl });
  const st = c?.emailStatus;
  return { status: st === 'verified' ? 'valid' : st === 'unavailable' || st === 'invalid' ? 'invalid' : st ? 'risky' : 'unknown', detail: st ? `Apollo email_status: ${st}` : 'Apollo returned no match' };
}

export async function enrichCompany(cfg, { domain, name, fetchImpl }) {
  if (!domain) return null;
  const data = await callJson('apollo', `${BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, { headers: headers(cfg), fetchImpl });
  const o = data?.organization;
  return o ? { name: o.name, domain: o.primary_domain, website: o.website_url, industry: o.industry, size: o.estimated_num_employees, linkedinUrl: o.linkedin_url, location: [o.city, o.state].filter(Boolean).join(', '), phone: o.phone, sourceLabel: 'Apollo.io organization enrichment' } : null;
}
