import { useEffect, useState, useSyncExternalStore } from 'react';

// Theme: 'system' | 'light' | 'dark'. Stored per browser; applied as
// <html data-theme="…"> so the CSS tokens switch.
const KEY = 'agentDashboard.theme';
const subs = new Set();
let theme = (() => { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } })();
apply();

function apply() {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(next) {
  theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  apply();
  subs.forEach((fn) => fn());
}

export function useTheme() {
  return useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => theme);
}

const VARS = ['surface', 'grid', 'axis', 'muted', 'text-2', 'accent-wash', 'good', 'critical',
  ...Array.from({ length: 8 }, (_, i) => `series-${i + 1}`)];

function read() {
  const cs = getComputedStyle(document.documentElement);
  const v = Object.fromEntries(VARS.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()]));
  return { ...v, series: Array.from({ length: 8 }, (_, i) => v[`series-${i + 1}`]) };
}

/**
 * Resolved chart colors for the active theme. SVG presentation attributes
 * can't reliably use CSS variables, so charts get concrete values.
 */
export function useChartColors() {
  const t = useTheme();
  const [colors, setColors] = useState(read);
  useEffect(() => {
    setColors(read());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setColors(read());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [t]);
  return colors;
}
