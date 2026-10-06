export function compact(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
export function number(n) {
  return n == null ? '—' : new Intl.NumberFormat('en-US').format(n);
}
export function pct(x, digits = 1) {
  return x == null ? '—' : `${(x * 100).toFixed(digits)}%`;
}
export function usd(x) {
  if (x == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: x < 1 && x > 0 ? 4 : 2, maximumFractionDigits: x < 1 && x > 0 ? 4 : 2 }).format(x);
}
export function duration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
export function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function dateTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}
export function shortDate(isoDay) {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
