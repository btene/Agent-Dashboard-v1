import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { usd, num, ago, useEnvironment } from '../lib/intel.js';
import { Help } from '../components/intel.jsx';
import { ErrorBox } from '../components/ui.jsx';

const TIER_COLOR = { high: '#1baf7a', medium: '#2a78d6', low: '#eda100', none: '#9a9a9a' };

function Map({ points, center, zoom }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = L.map(el.current, { scrollWheelZoom: false }).setView([center?.lat || 34.25, center?.lon || -118.4], zoom || 8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 18 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const p of points) {
      const m = L.circleMarker([p.lat, p.lon], { radius: p.tier === 'high' ? 9 : 7, color: '#fff', weight: 1, fillColor: TIER_COLOR[p.tier] || TIER_COLOR.none, fillOpacity: 0.85 });
      m.bindTooltip(`<strong>${escapeHtml(p.name)}</strong><br>Score ${p.score}/100 · ${escapeHtml(p.status || '')}<br>${p.valuation ? `Permit valuation ${usd(p.valuation, { compact: true })}` : 'Valuation not published'}`);
      m.on('click', () => navigate(`/projects/${p.id}`));
      m.addTo(layer);
    }
  }, [points, navigate]);
  return <div ref={el} className="map" role="region" aria-label="Map of commercial opportunities" />;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function HomePage() {
  const navigate = useNavigate();
  const environment = useEnvironment();
  const [days, setDays] = useState(30);
  const dash = useApi(`/dashboard?days=${days}`);
  const settings = useApi('/settings');
  const reminders = useApi('/reminders?status=open');
  const sources = useApi('/sources');
  const reload = useThrottled(() => { dash.reload(); reminders.reload(); }, 2000);
  useLiveEvents((e) => { if (/^(project|email|source|contact)\./.test(e.type)) reload(); });

  const d = dash.data;
  const territory = settings.data?.territory;
  const connected = (sources.data || []).filter((s) => s.status === 'connected');
  const lastRun = connected.map((s) => s.lastSuccessAt).filter(Boolean).sort().at(-1);
  const sourceUpdated = connected.map((s) => s.lastSourceUpdatedAt).filter(Boolean).sort().at(-1);

  function open(m) {
    if (m.link) return navigate(m.link);
    const q = new URLSearchParams(Object.entries(m.filter || {}).map(([k, v]) => [k, String(v)]));
    navigate(`/projects?${q}`);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Business dashboard</h1>
          <p>What the system has found, what needs your attention, and how outreach is going. Live records only — demo data is never counted here.</p>
        </div>
        <div className="row">
          <div className="segmented">{[7, 30, 90].map((n) => <button key={n} className={days === n ? 'active' : ''} onClick={() => setDays(n)}>{n} days</button>)}</div>
        </div>
      </div>
      <ErrorBox error={dash.error} />
      {environment === 'demo' && <div className="notice" style={{ marginBottom: 16 }}>The dashboard always shows live data. Open <Link to="/projects">Projects</Link> to browse the demo environment.</div>}
      {d?.dataNotice && <div className="warn-box" style={{ marginBottom: 16 }}><strong>No live data yet.</strong> {d.dataNotice} <Link to="/integrations">Go to Integrations</Link>.</div>}
      {d && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
          {d.metrics.map((m) => (
            <button key={m.key} className="card metric" onClick={() => open(m)}>
              <div className="label">{m.label}</div>
              <div className="value">{m.format === 'usd' ? usd(m.value) : num(m.value)}</div>
              <div className="hint">{m.hint}</div>
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-2" style={{ marginTop: 16, gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
        <div className="card">
          <div className="card-header"><div><h2>Commercial opportunities in your territory</h2><p>{territory?.description}. Click a dot to open the project. Green = high priority, blue = worth pursuing, amber = low.</p></div>
            <div className="small muted">{d ? `${d.map.length} mapped` : ''}</div></div>
          <div className="card-pad" style={{ paddingTop: 8 }}>{d && <Map points={d.map} center={territory?.mapCenter} zoom={territory?.mapZoom} />}</div>
        </div>
        <div className="stack">
          <div className="card card-pad">
            <h2>Data freshness</h2>
            <Help>Two different times matter: when this system last checked a source, and when the government last updated its database.</Help>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Last retrieval</dt><dd>{lastRun ? ago(lastRun) : 'never'}</dd>
              <dt>Publisher last updated</dt><dd>{sourceUpdated ? new Date(sourceUpdated).toLocaleDateString() : 'unknown'}</dd>
              <dt>Connected sources</dt><dd>{connected.length} of {(sources.data || []).length} <Link to="/integrations">manage</Link></dd>
            </dl>
            {connected.some((s) => s.refreshFrequency === 'weekly') && <div className="small muted" style={{ marginTop: 8 }}>The City of Los Angeles republishes weekly, so new permits appear at most once a week regardless of how often this system checks.</div>}
          </div>
          <div className="card card-pad">
            <h2>Follow-up reminders</h2>
            {!reminders.data?.length && <Help>No open reminders.</Help>}
            {(reminders.data || []).slice(0, 6).map((r) => <div key={r.id} className="history-item"><Link to={`/projects/${r.projectId}`}>{r.title}</Link></div>)}
            {reminders.data?.length > 6 && <Link to="/crm#reminders" className="small">See all {reminders.data.length}</Link>}
          </div>
          {d && d.totals.permitValuationOfOpen > 0 && (
            <div className="card card-pad">
              <h2>Permit valuation of open high-priority projects</h2>
              <div className="value" style={{ fontSize: 24, fontWeight: 650 }}>{usd(d.totals.permitValuationOfOpen)}</div>
              <Help>This is the construction value the agencies published for the whole buildings, not the landscape contracts. It is shown for scale only.</Help>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
