// Contact-data provider adapters. Each adapter exposes the same small
// interface so the research engine can treat them alike:
//   searchPeople({ company, domain, titles, limit }) -> [{ candidate }]
//   enrichPerson({ firstName, lastName, company, domain, linkedinUrl }) -> candidate | null
//   verifyEmail(email) -> { status: 'valid'|'invalid'|'risky'|'unknown', detail }
//   enrichCompany({ name, domain }) -> { name, domain, website, industry, size, linkedinUrl, location } | null
// Endpoints follow each provider's public documentation (links in each file).
// Nothing is ever fabricated: if a provider returns nothing, the result is empty.
import * as apollo from './apollo.js';
import * as hunter from './hunter.js';
import * as pdl from './pdl.js';
import * as zoominfo from './zoominfo.js';

export const PROVIDERS = { apollo, hunter, pdl, zoominfo };

export const PROVIDER_INFO = Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, p.INFO]));

export class ProviderError extends Error {
  constructor(provider, message, { status = null } = {}) { super(`${PROVIDER_INFO[provider]?.name || provider}: ${message}`); this.provider = provider; this.status = status; }
}

/** Shared HTTP helper with timeout and consistent error text. */
export async function callJson(provider, url, { method = 'GET', headers = {}, body, fetchImpl = fetch, timeoutMs = 20_000, statusMessages = {} } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { method, headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) { throw new ProviderError(provider, `could not reach ${new URL(url).host} (${err.message})`); }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (statusMessages[res.status]) throw new ProviderError(provider, `${statusMessages[res.status]} (${res.status})`, { status: res.status });
  if (res.status === 401 || res.status === 403) throw new ProviderError(provider, `API key rejected (${res.status}). Check the key and that your plan includes API access.`, { status: res.status });
  if (res.status === 402) throw new ProviderError(provider, 'out of credits (402). Top up or upgrade the plan.', { status: 402 });
  if (res.status === 429) throw new ProviderError(provider, 'rate limit reached (429). Try again later.', { status: 429 });
  if (!res.ok) throw new ProviderError(provider, `${res.status} ${data?.message || data?.error || data?.errors?.[0]?.details || text.slice(0, 160)}`, { status: res.status });
  return data;
}

export function enabledProviders(settings) {
  return Object.entries(settings.providers || {}).filter(([id, cfg]) => cfg?.enabled && PROVIDERS[id]?.isConfigured(cfg)).map(([id]) => id);
}
