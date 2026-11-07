// Apollo.io REST API — written against the official reference (verified Nov 2026):
//   People API Search  POST https://api.apollo.io/api/v1/mixed_people/api_search
//     query-string params: person_titles[], include_similar_titles, person_seniorities[],
//     q_organization_domains_list[], organization_ids[], page, per_page.
//     0 credits. Returns first_name + last_name_obfuscated + title + organization.name;
//     NO email, phone or LinkedIn URL. 600 calls/hour on entry plans.
//     https://docs.apollo.io/reference/people-api-search
//   Organization Search POST /mixed_companies/search?q_organization_name=… (1 credit per page)
//     https://docs.apollo.io/reference/organization-search
//   People Enrichment  POST /people/match?id=… (1 credit for email/demographics, +8 if a mobile
//     number is returned; we never request phones) https://docs.apollo.io/reference/people-enrichment
//   Organization Enrichment GET /organizations/enrich?domain=… (1 credit)
// Auth: `x-api-key` header. Apollo's pricing page states API access is available on Custom
// plans; the reference says People API Search also works for free accounts registered with a
// work email. Test your key with the "Test" button before relying on it.
import { callJson } from './index.js';

export const INFO = {
  id: 'apollo', name: 'Apollo.io', website: 'https://www.apollo.io/', docs: 'https://docs.apollo.io/',
  capabilities: {
    peopleSearchByCompanyAndTitle: true,
    personEnrichment: true,
    emailVerification: 'email_status returned by enrichment (verified / unverified / unavailable)',
    companyEnrichment: true,
    linkedinUrlReturned: 'after enrichment only',
    phones: 'mobile numbers cost +8 credits and are never requested by this platform',
    searchNote: 'Search shows first name, obfuscated surname and title at no cost. "Reveal" spends 1 credit per person to get full name, verified email and LinkedIn URL.',
  },
  pricing: 'Free $0; Basic $49/user/mo; Professional $99/user/mo; Custom (contact sales, includes API access per apollo.io/pricing). Enrichment 1 credit/person.',
  credentials: [{ key: 'apiKey', label: 'API key', help: 'Apollo → Settings → Integrations → API Keys. Apollo states API access is on Custom plans; People Search also works on free accounts with a work email. Use "Test" to confirm.' }],
};
export const isConfigured = (cfg) => Boolean(cfg?.apiKey);
const BASE = 'https://api.apollo.io/api/v1';
const headers = (cfg) => ({ 'x-api-key': cfg.apiKey, 'cache-control': 'no-cache' });

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => u.append(`${k}[]`, x)); else u.set(k, String(v));
  }
  return u.toString();
}

function fromSearch(p) {
  return {
    provider: 'apollo', providerId: p.id || null,
    firstName: p.first_name || null, lastName: p.last_name || null, lastNameObfuscated: p.last_name_obfuscated || null,
    title: p.title || null, company: p.organization?.name || null, companyDomain: null,
    email: null, emailStatus: null, phone: null, linkedinUrl: null, location: null,
    needsReveal: !p.last_name, hasEmail: Boolean(p.has_email),
    sourceUrl: null, sourceLabel: 'Apollo.io people search (name partly hidden until revealed)',
    raw: { last_refreshed_at: p.last_refreshed_at, has_email: p.has_email, has_direct_phone: p.has_direct_phone },
  };
}

function fromPerson(p) {
  const email = p.email && !/not_unlocked|email_not_unlocked/.test(p.email) ? p.email : null;
  return {
    provider: 'apollo', providerId: p.id || null,
    firstName: p.first_name || null, lastName: p.last_name || null, lastNameObfuscated: null, title: p.title || null,
    company: p.organization?.name || p.employment_history?.[0]?.organization_name || null, companyDomain: p.organization?.primary_domain || null,
    email, emailStatus: p.email_status || null,
    emailVerification: email && p.email_status === 'verified' ? { status: 'valid', detail: 'Apollo email_status: verified', provider: 'apollo', checkedAt: new Date().toISOString() } : null,
    phone: null, linkedinUrl: p.linkedin_url || null, location: [p.city, p.state].filter(Boolean).join(', ') || null, needsReveal: false,
    sourceUrl: p.linkedin_url || null, sourceLabel: 'Apollo.io people enrichment', raw: { seniority: p.seniority, departments: p.departments, headline: p.headline },
  };
}

/** Find Apollo's organization for a company name (1 credit per page). */
export async function findOrganization(cfg, { company, fetchImpl }) {
  const data = await callJson('apollo', `${BASE}/mixed_companies/search?${qs({ q_organization_name: company, per_page: 5, page: 1 })}`, { method: 'POST', headers: headers(cfg), fetchImpl });
  const orgs = data?.organizations || data?.accounts || [];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(inc|llc|lp|corp|corporation|company|co)$/,'');
  return orgs.find((o) => norm(o.name) === norm(company)) || null;
}

export async function searchPeople(cfg, { company, domain, organizationId, titles = [], limit = 10, fetchImpl }) {
  let orgFilter = {};
  if (domain) orgFilter = { q_organization_domains_list: [domain] };
  else if (organizationId) orgFilter = { organization_ids: [organizationId] };
  else if (company) {
    const org = await findOrganization(cfg, { company, fetchImpl });
    if (!org) return [];
    orgFilter = org.primary_domain ? { q_organization_domains_list: [org.primary_domain] } : { organization_ids: [org.id] };
  } else return [];
  const params = { person_titles: titles.slice(0, 90), include_similar_titles: true, per_page: Math.min(limit, 100), page: 1, ...orgFilter };
  const data = await callJson('apollo', `${BASE}/mixed_people/api_search?${qs(params)}`, { method: 'POST', headers: headers(cfg), fetchImpl });
  return (data?.people || []).map(fromSearch);
}

/** Reveal one person (1 credit when data is returned). Never requests phone numbers. */
export async function enrichPerson(cfg, { providerId, firstName, lastName, company, domain, linkedinUrl, email, fetchImpl }) {
  const params = { reveal_personal_emails: false, reveal_phone_number: false };
  if (providerId) params.id = providerId;
  if (linkedinUrl) params.linkedin_url = linkedinUrl;
  if (email) params.email = email;
  if (firstName) params.first_name = firstName;
  if (lastName) params.last_name = lastName;
  if (domain) params.domain = domain; else if (company) params.organization_name = company;
  const data = await callJson('apollo', `${BASE}/people/match?${qs(params)}`, { method: 'POST', headers: headers(cfg), fetchImpl });
  return data?.person ? fromPerson(data.person) : null;
}

export async function verifyEmail(cfg, email, { fetchImpl } = {}) {
  const c = await enrichPerson(cfg, { email, fetchImpl });
  const st = c?.emailStatus;
  return { status: st === 'verified' ? 'valid' : st === 'unavailable' || st === 'invalid' ? 'invalid' : st ? 'risky' : 'unknown', detail: st ? `Apollo email_status: ${st}` : 'Apollo returned no match' };
}

export async function enrichCompany(cfg, { domain, name, fetchImpl }) {
  const params = domain ? { domain } : name ? { name } : null;
  if (!params) return null;
  const data = await callJson('apollo', `${BASE}/organizations/enrich?${qs(params)}`, { headers: headers(cfg), fetchImpl });
  const o = data?.organization;
  return o ? { name: o.name, domain: o.primary_domain, website: o.website_url, industry: o.industry, size: o.estimated_num_employees, linkedinUrl: o.linkedin_url, location: [o.city, o.state].filter(Boolean).join(', '), phone: o.phone, sourceLabel: 'Apollo.io organization enrichment' } : null;
}
