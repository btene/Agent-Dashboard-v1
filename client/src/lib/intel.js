// Helpers shared by the construction-intelligence pages.
import { useEffect, useState } from 'react';
import { api } from './api.js';

export const NOT_YET_VERIFIED = 'Not yet verified';

export function usd(n, { compact = false } = {}) {
  if (n == null || Number.isNaN(Number(n))) return NOT_YET_VERIFIED;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, ...(compact ? { notation: 'compact' } : {}) }).format(Number(n));
}
export function num(n) { return n == null ? NOT_YET_VERIFIED : new Intl.NumberFormat('en-US').format(n); }
export function day(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : NOT_YET_VERIFIED; }
export function when(iso) { return iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'; }
export function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const PROVENANCE_LABEL = {
  government: 'Verified government record',
  third_party: 'Verified third-party information',
  ai_estimate: 'Estimated (automated classification)',
  unverified: 'Unverified — needs research',
  user: 'Entered by your team',
};

export const STAGE_LABEL = {
  discovered: 'Discovered', verified: 'Verified', researching: 'Researching', contacted: 'Contacted', replied: 'Replied',
  bid_submitted: 'Bid submitted', awarded: 'Awarded', lost: 'Lost', not_a_fit: 'Not a fit',
};

export const TIER_LABEL = { high: 'High priority', medium: 'Worth pursuing', low: 'Low priority', none: 'Not a fit' };

export const EMAIL_STATUS_LABEL = { draft: 'Draft', pending_approval: 'Awaiting approval', approved: 'Approved — ready to send', scheduled: 'Scheduled', sent: 'Sent', failed: 'Failed', rejected: 'Rejected', replied: 'Replied' };

// Which environment (live or demo) the UI is showing. Stored per browser.
const ENV_KEY = 'als2000.environment';
const envSubs = new Set();
let env = (() => { try { return localStorage.getItem(ENV_KEY) === 'demo' ? 'demo' : 'live'; } catch { return 'live'; } })();
export function setEnvironment(next) { env = next === 'demo' ? 'demo' : 'live'; try { localStorage.setItem(ENV_KEY, env); } catch { /* ignore */ } envSubs.forEach((f) => f()); }
export function useEnvironment() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); envSubs.add(f); return () => envSubs.delete(f); }, []);
  return env;
}

/** Upload a file as the raw request body (documents and imports). */
let maxUpload = null;
export async function uploadFile(path, file, params = {}) {
  if (maxUpload === null) { try { maxUpload = (await (await fetch('/api/v1/meta')).json())?.platform?.maxUploadBytes || 0; } catch { maxUpload = 0; } }
  if (maxUpload && file.size > maxUpload) throw new Error(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. The limit here is ${Math.round(maxUpload / 1048576)} MB per file. Compress the PDF (for example with your PDF app's "reduce file size") and try again.`);
  const q = new URLSearchParams({ filename: file.name, mimetype: file.type || 'application/octet-stream', ...params });
  const headers = { 'x-agent-dashboard-client': 'ui', 'content-type': file.type || 'application/octet-stream' };
  try { const key = localStorage.getItem('agentDashboard.apiKey'); if (key) headers.authorization = `Bearer ${key}`; } catch { /* ignore */ }
  const res = await fetch(`/api/v1${path}?${q}`, { method: 'POST', headers, body: file });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);
  return data;
}

export { api };
