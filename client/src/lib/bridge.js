// postMessage bridge for when this dashboard is embedded in another one.
//
// Outbound (to the parent window):
//   { source: 'agent-dashboard', type: 'ready' | 'route' | 'run.succeeded' | 'run.failed' | …, data }
// Inbound (from the parent window):
//   { target: 'agent-dashboard', type: 'navigate', path: '/analytics' }
export const isEmbedded = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

// `?embed=1` hides the navigation chrome; it sticks for the rest of the session
// so in-app links stay embedded.
export function embedMode() {
  const fromUrl = new URLSearchParams(window.location.search).get('embed');
  try {
    if (fromUrl === '1') sessionStorage.setItem('agentDashboard.embed', '1');
    if (fromUrl === '0') sessionStorage.removeItem('agentDashboard.embed');
    return sessionStorage.getItem('agentDashboard.embed') === '1';
  } catch {
    return fromUrl === '1';
  }
}

export function postToParent(type, data) {
  if (!isEmbedded) return;
  window.parent.postMessage({ source: 'agent-dashboard', type, data }, '*');
}

export function listenToParent(onNavigate) {
  if (!isEmbedded) return () => {};
  const handler = (e) => {
    if (e.data?.target === 'agent-dashboard' && e.data.type === 'navigate' && typeof e.data.path === 'string' && e.data.path.startsWith('/')) {
      onNavigate(e.data.path);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
