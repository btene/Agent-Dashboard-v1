import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getApiKey } from './api.js';

/** Fetch `path` and expose { data, error, loading, reload }. Pass null to skip. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    api(path, { signal: ctrl.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => { if (error.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false })); });
    return () => ctrl.abort();
  }, [path, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

// One shared EventSource for the whole app; components subscribe to it.
const listeners = new Set();
let source = null;
const EVENT_TYPES = ['run.created', 'run.started', 'run.log', 'run.updated', 'run.succeeded', 'run.failed', 'run.cancelled', 'runs.cleared', 'agent.created', 'agent.updated', 'agent.deleted'];

function ensureSource() {
  if (source) return;
  const key = getApiKey();
  source = new EventSource(`/api/v1/events${key ? `?key=${encodeURIComponent(key)}` : ''}`);
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (e) => {
      const event = JSON.parse(e.data);
      for (const fn of listeners) fn(event);
    });
  }
}

export function resetEventSource() {
  source?.close();
  source = null;
  if (listeners.size) ensureSource();
}

/** Subscribe to live server events. `handler` receives { type, data, at }. */
export function useLiveEvents(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (e) => ref.current(e);
    listeners.add(fn);
    ensureSource();
    return () => listeners.delete(fn);
  }, []);
}

/** Call `fn` at most once per `ms` (trailing), for coalescing bursts of events. */
export function useThrottled(fn, ms = 1000) {
  const timer = useRef(null);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; ref.current(); }, ms);
  }, [ms]);
}
