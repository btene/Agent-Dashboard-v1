import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../lib/hooks.js';
import { embedMode, listenToParent, postToParent } from '../lib/bridge.js';
import { setTheme, useTheme } from '../lib/theme.js';
import { useEnvironment } from '../lib/intel.js';
import ApiKeyPrompt from './ApiKeyPrompt.jsx';
import { DemoBanner } from './intel.jsx';

const NAV = [
  { to: '/', icon: '🏠', label: 'Home', end: true },
  { to: '/projects', icon: '🏗️', label: 'Projects' },
  { to: '/outreach', icon: '✉️', label: 'Outreach' },
  { to: '/crm', icon: '🤝', label: 'CRM' },
  { to: '/documents', icon: '📁', label: 'Documents' },
  { to: '/automations', icon: '🎛️', label: 'Automation Control Center' },
  { to: '/integrations', icon: '🔗', label: 'Integrations' },
  { to: '/admin', icon: '🛠️', label: 'Setup guide & diagnostics' },
  { to: '/settings', icon: '⚙️', label: 'Settings' },
];
const ADVANCED = [
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
  const environment = useEnvironment();
  const [menuOpen, setMenuOpen] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const meta = useApi('/meta');
  const settings = useApi(embed ? null : '/settings');
  const onboarding = useApi(embed ? null : '/onboarding');
  const automations = useApi(embed ? null : '/automations');
  const dashboards = useApi(embed ? null : '/dashboards');

  useEffect(() => listenToParent((path) => navigate(path)), [navigate]);
  useEffect(() => { postToParent('route', { path: location.pathname }); setMenuOpen(false); automations.reload(); }, [location.pathname]);
  useEffect(() => {
    const onAuth = () => setNeedsKey(true);
    const onDash = () => dashboards.reload();
    const onSettings = () => { settings.reload(); onboarding.reload(); automations.reload(); };
    window.addEventListener('agent-dashboard:auth-required', onAuth);
    window.addEventListener('agent-dashboard:dashboards-changed', onDash);
    window.addEventListener('als2000:settings-changed', onSettings);
    return () => {
      window.removeEventListener('agent-dashboard:auth-required', onAuth);
      window.removeEventListener('agent-dashboard:dashboards-changed', onDash);
      window.removeEventListener('als2000:settings-changed', onSettings);
    };
  }, [dashboards.reload, settings.reload, onboarding.reload, automations.reload]);

  // First visit: send the owner to the guided setup.
  useEffect(() => {
    if (embed || !onboarding.data) return;
    if (onboarding.data.showWizard && location.pathname === '/' ) navigate('/setup', { replace: true });
  }, [onboarding.data, location.pathname, embed, navigate]);

  const name = settings.data?.company?.name || 'Advanced Landscape 2000';
  useEffect(() => { document.title = `${name} — Construction Intelligence`; }, [name]);

  const nextTheme = { system: 'light', light: 'dark', dark: 'system' }[theme];
  const themeIcon = { system: '🖥️', light: '☀️', dark: '🌙' }[theme];
  const paused = automations.data?.pauseAll;

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
              <div className="brand-mark" style={{ background: '#2f7d4a' }}>🌿</div>
              <span style={{ lineHeight: 1.1 }}>{name}<div className="small muted" style={{ fontWeight: 400 }}>Construction intelligence</div></span>
              <span className="spacer" />
              {menuOpen && <button className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button>}
            </div>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="icon">{n.icon}</span>{n.label}
                {n.to === '/automations' && paused && <span className="ext" style={{ color: 'var(--critical-text)' }}>paused</span>}
              </NavLink>
            ))}
            {onboarding.data && !onboarding.data.completedAt && (
              <NavLink to="/setup" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><span className="icon">🧭</span>Guided setup</NavLink>
            )}
            <div className="nav-section">Advanced: AI agents</div>
            {ADVANCED.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link muted ${isActive ? 'active' : ''}`}><span className="icon">{n.icon}</span>{n.label}</NavLink>
            ))}
            {(dashboards.data || []).length > 0 && <div className="nav-section">Linked dashboards</div>}
            {(dashboards.data || []).map((d) =>
              d.openMode === 'tab' ? <a key={d.id} className="nav-link" href={d.url} target="_blank" rel="noreferrer"><span className="icon">{d.icon || '📊'}</span>{d.name}<span className="ext">↗</span></a>
                : <NavLink key={d.id} to={`/linked/${d.id}`} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><span className="icon">{d.icon || '📊'}</span>{d.name}</NavLink>,
            )}
            <div className="sidebar-footer">
              <button className="btn sm ghost" onClick={() => setTheme(nextTheme)} title={`Theme: ${theme} (click for ${nextTheme})`}>{themeIcon}</button>
              <span className={`badge ${environment === 'demo' ? 'env-demo' : 'env-live'}`}>{environment === 'demo' ? 'DEMO DATA' : 'LIVE DATA'}</span>
              <span className="spacer" />
              <span>v{meta.data?.version}</span>
            </div>
          </aside>
        </>
      )}
      <main className="main">
        {!embed && meta.data?.platform?.setupError && <div className="paused-banner"><strong>Setup needed:</strong> {meta.data.platform.setupError}</div>}
        {!embed && <DemoBanner environment={environment} />}
        {!embed && paused && <div className="paused-banner">All automations are paused. Nothing will run until you resume them in the <Link to="/automations">Automation Control Center</Link>.</div>}
        {children}
      </main>
      {needsKey && <ApiKeyPrompt onClose={() => setNeedsKey(false)} />}
    </div>
  );
}
