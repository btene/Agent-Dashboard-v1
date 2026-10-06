// Thin fetch wrapper around the dashboard's REST API.
const KEY_STORAGE = 'agentDashboard.apiKey';

export function getApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
export function setApiKey(key) {
  try { key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE); } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { 'x-agent-dashboard-client': 'ui' };
  const key = getApiKey();
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  if (res.status === 401) window.dispatchEvent(new Event('agent-dashboard:auth-required'));
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data;
}
