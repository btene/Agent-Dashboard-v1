import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { when, ago } from '../lib/intel.js';
import { Switch, Help } from '../components/intel.jsx';
import { ErrorBox } from '../components/ui.jsx';

const ICONS = { permit_monitoring: '🏛️', project_discovery: '🔎', constructconnect_import: '📥', other_platform_integrations: '🧩', developer_research: '🕵️', contact_enrichment: '📇', ai_email_drafting: '✍️', email_sending: '📤', follow_up_reminders: '⏰', crm_sync: '🔄' };
const INTERVALS = [['manual', 'Manual only'], ['6h', 'Every 6 hours'], ['12h', 'Every 12 hours'], ['daily', 'Daily']];

export default function AutomationsPage() {
  const data = useApi('/automations');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const reload = useThrottled(data.reload, 800);
  useLiveEvents((e) => { if (e.type.startsWith('automation') || e.type === 'settings.updated') reload(); });

  async function call(path, body, method = 'POST') {
    setError(null);
    try { await api(path, { method, body }); data.reload(); window.dispatchEvent(new Event('als2000:settings-changed')); } catch (e) { setError(e); }
  }
  async function runNow(id) { setBusy(id); await call(`/automations/${id}/run`); setBusy(null); }

  const d = data.data;
  const meta = useApi('/meta');
  if (!d) return <ErrorBox error={data.error} />;
  const cron = meta.data?.platform?.serverless;
  const sendingOn = d.items.find((a) => a.id === 'email_sending')?.config?.enabled;

  return (
    <>
      <div className="page-header">
        <div><h1>Automation Control Center</h1><p>Turn each automation on or off, choose how the whole system behaves, and see when things last ran.</p></div>
        {d.pauseAll
          ? <button className="btn primary" style={{ background: 'var(--good)', borderColor: 'var(--good)' }} onClick={() => call('/automations/resume-all')}>▶ Resume all automations</button>
          : <button className="btn primary" style={{ background: 'var(--critical)', borderColor: 'var(--critical)' }} onClick={() => call('/automations/pause-all')}>⏸ Pause all automations</button>}
      </div>
      <ErrorBox error={error} />

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Operating mode</h2>
        <Help>This is the one setting that decides how much happens without you. You can change it at any time.</Help>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginTop: 12 }}>
          {Object.entries(d.modes).map(([key, m]) => (
            <button key={key} className={`mode-card ${d.mode === key ? 'active' : ''}`} onClick={() => call('/automations/mode', { mode: key }, 'PATCH')}>
              <h3>{m.label}{key === 'semi_automatic' && <span className="tag" style={{ marginLeft: 8 }}>default</span>}</h3>
              <div className="small text-2">{m.description}</div>
            </button>
          ))}
        </div>
        {d.mode === 'automatic' && !sendingOn && <div className="notice small" style={{ marginTop: 12 }}>Automatic mode is on, but <strong>Automated email sending</strong> is still switched off, so no email will go out until you turn it on below. This is deliberate.</div>}
        {d.mode === 'automatic' && sendingOn && <div className="warn-box small" style={{ marginTop: 12 }}>Approved emails for projects scoring at least the auto-send threshold (Settings → Outreach) will be sent without a per-email check.</div>}
      </div>

      {cron && <div className="notice small" style={{ marginBottom: 16 }}>This site runs on Vercel's free plan, which runs scheduled work <strong>once a day</strong> (around 6–7 am Pacific). Every automation that is switched on runs in that daily pass; the 6- and 12-hour choices behave like Daily. Use <strong>Run now</strong> any time you want an update sooner.</div>}
      <div className="card">
        <div className="card-header"><div><h2>Automations</h2><p>Each one is independent. "Run now" works even when the schedule is off or everything is paused.</p></div></div>
        {d.items.map((a) => (
          <div key={a.id} className="auto-row">
            <div style={{ fontSize: 28, lineHeight: 1 }}>{ICONS[a.id]}</div>
            <div>
              <div className="row"><h3>{a.label}</h3>
                <span className={`status-pill ${a.status === 'ok' ? 'connected' : a.status === 'error' ? 'error' : a.running ? 'ready' : ''}`}>{a.running ? 'running…' : a.status === 'ok' ? 'last run OK' : a.status === 'error' ? 'error' : 'idle'}</span>
                {!a.config?.enabled && <span className="tag">off</span>}
                {a.id === 'email_sending' && !a.config?.enabled && <span className="tag" title="Off until you explicitly enable it">off by default</span>}
              </div>
              <div className="small text-2" style={{ marginTop: 2 }}>{a.description}</div>
              <div className="auto-status">
                <div><span className="k">Last run</span>{a.lastRunAt ? `${ago(a.lastRunAt)}` : 'never'}</div>
                <div><span className="k">Last successful run</span>{a.lastSuccessAt ? when(a.lastSuccessAt) : 'never'}</div>
                <div><span className="k">Next scheduled run</span>{a.nextRunAt ? when(a.nextRunAt) : d.pauseAll ? 'paused' : d.mode === 'manual' ? 'manual mode' : !a.config?.enabled ? 'off' : 'not scheduled'}</div>
                <div><span className="k">Result</span>{a.lastError ? <span className="check-bad">{a.lastError}</span> : a.lastSummary || '—'}</div>
              </div>
            </div>
            <div className="stack" style={{ gap: 8, alignItems: 'flex-end' }}>
              <Switch checked={Boolean(a.config?.enabled)} label={`${a.label} on/off`} onChange={(v) => call(`/automations/${a.id}`, { enabled: v }, 'PATCH')} />
              <select value={a.config?.interval || 'daily'} onChange={(e) => call(`/automations/${a.id}`, { interval: e.target.value }, 'PATCH')} style={{ width: 150, padding: '4px 8px' }} aria-label="Schedule">
                {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button className="btn sm" disabled={busy === a.id || a.running} onClick={() => runNow(a.id)}>{busy === a.id ? 'Running…' : 'Run now'}</button>
            </div>
          </div>
        ))}
      </div>
      <Help style={{ marginTop: 12 }}>Permit sources have their own publishing schedules. The City of Los Angeles updates weekly, so a 6-hour check cannot find anything a daily check would miss; per-source limits are enforced under <Link to="/integrations">Integrations</Link>.</Help>
    </>
  );
}
