import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../lib/hooks.js';
import { embedMode, listenToParent, postToParent } from '../lib/bridge.js';
import { setTheme, useTheme } from '../lib/theme.js';
import ApiKeyPrompt from './ApiKeyPrompt.jsx';

const NAV = [
  { to: '/agents', icon: '🤖', label: 'Agents' },
  { to: '/runs', icon: '⏱️', label: 'Run history' },
  { to: '/analytics', icon: '📈', label: 'Analytics' },
  { to: '/connections', icon: '🔌', label: 'Connections' },
];

export default function Layout({ children }) {
  const embed = embedMode();
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const meta = useApi('/meta');
  const dashboards = useApi(embed ? null : '/dashboards');

  useEffect(() => listenToParent((path) => navigate(path)), [navigate]);
  useEffect(() => { postToParent('route', { path: location.pathname }); setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    const onAuth = () => setNeedsKey(true);
    const onDash = () => dashboards.reload();
    window.addEventListener('agent-dashboard:auth-required', onAuth);
    window.addEventListener('agent-dashboard:dashboards-changed', onDash);
    return () => {
      window.removeEventListener('agent-dashboard:auth-required', onAuth);
      window.removeEventListener('agent-dashboard:dashboards-changed', onDash);
    };
  }, [dashboards.reload]);

  const name = meta.data?.name || 'Agent Dashboard';
  useEffect(() => { document.title = name; }, [name]);

  const nextTheme = { system: 'light', light: 'dark', dark: 'system' }[theme];
  const themeIcon = { system: '🖥️', light: '☀️', dark: '🌙' }[theme];

  return (
    <div className={`shell ${embed ? 'embed' : ''}`}>
      {!embed && (
        <>
          <div className="mobile-bar">
            <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">☰</button>
            <strong>{name}</strong>
          </div>
          <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
            <div className="brand">
              <div className="brand-mark">◆</div>
              <span>{name}</span>
              <span className="spacer" />
              {menuOpen && <button className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button>}
            </div>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="icon">{n.icon}</span>{n.label}
              </NavLink>
            ))}
            <div className="nav-section">Linked dashboards</div>
            {(dashboards.data || []).map((d) =>
              d.openMode === 'tab' ? (
                <a key={d.id} className="nav-link" href={d.url} target="_blank" rel="noreferrer">
                  <span className="icon">{d.icon || '📊'}</span>{d.name}<span className="ext">↗</span>
                </a>
              ) : (
                <NavLink key={d.id} to={`/linked/${d.id}`} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <span className="icon">{d.icon || '📊'}</span>{d.name}
                </NavLink>
              ),
            )}
            <Link to="/connections#dashboards" className="nav-link muted"><span className="icon">＋</span>Link a dashboard</Link>
            <div className="sidebar-footer">
              <button className="btn sm ghost" onClick={() => setTheme(nextTheme)} title={`Theme: ${theme} (click for ${nextTheme})`}>
                {themeIcon} {theme[0].toUpperCase() + theme.slice(1)}
              </button>
              <span className="spacer" />
              <span>v{meta.data?.version}</span>
            </div>
          </aside>
        </>
      )}
      <main className="main">{children}</main>
      {needsKey && <ApiKeyPrompt onClose={() => setNeedsKey(false)} />}
    </div>
  );
}
