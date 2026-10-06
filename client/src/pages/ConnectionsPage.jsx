import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { ago } from '../lib/format.js';
import { ErrorBox, Modal } from '../components/ui.jsx';

const ICONS = ['📊', '📈', '💰', '🧭', '🛒', '📣', '🧑‍💼', '🗂️', '⚙️', '🌐'];

function DashboardForm({ onClose, onSaved, existing }) {
  const [f, setF] = useState(existing || { name: '', url: '', description: '', icon: '📊', openMode: 'embed' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    try {
      const body = { name: f.name, url: f.url, description: f.description, icon: f.icon, openMode: f.openMode };
      if (existing) await api(`/dashboards/${existing.id}`, { method: 'PATCH', body });
      else await api('/dashboards', { method: 'POST', body });
      onSaved();
      onClose();
    } catch (e) { setError(e); }
  }
  return (
    <Modal title={existing ? 'Edit linked dashboard' : 'Link a dashboard'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={!f.name || !f.url}>Save</button></>}>
      <div className="form">
        <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}>
          <label className="field">Name<input value={f.name} onChange={set('name')} placeholder="Sales dashboard" autoFocus /></label>
          <label className="field">Icon<select value={f.icon} onChange={set('icon')} style={{ width: 72 }}>{ICONS.map((i) => <option key={i}>{i}</option>)}</select></label>
        </div>
        <label className="field">URL<input value={f.url} onChange={set('url')} placeholder="https://sales.example.com" /></label>
        <label className="field">Description<input value={f.description} onChange={set('description')} /></label>
        <label className="field">Open as
          <select value={f.openMode} onChange={set('openMode')}>
            <option value="embed">Embedded inside this dashboard (iframe)</option>
            <option value="tab">New browser tab</option>
          </select>
          <span className="hint">Embedding requires the other site to allow iframes (no X-Frame-Options: DENY).</span>
        </label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function WebhookForm({ events, onClose, onSaved }) {
  const [f, setF] = useState({ url: '', description: '', secret: '', events: ['run.succeeded', 'run.failed'] });
  const [error, setError] = useState(null);
  const toggle = (ev) => setF({ ...f, events: f.events.includes(ev) ? f.events.filter((x) => x !== ev) : [...f.events, ev] });
  async function save() {
    try {
      await api('/webhooks', { method: 'POST', body: { ...f, secret: f.secret || undefined } });
      onSaved();
      onClose();
    } catch (e) { setError(e); }
  }
  return (
    <Modal title="Add webhook" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={!f.url}>Save</button></>}>
      <div className="form">
        <label className="field">Destination URL<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://other-dashboard.example.com/hooks/agents" autoFocus /></label>
        <label className="field">Description<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="field">Signing secret <span className="hint">Optional. Payloads are signed with HMAC-SHA256 in the X-Agent-Dashboard-Signature header.</span>
          <input value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} type="password" />
        </label>
        <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 550, marginBottom: 6 }}>Events</legend>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 6 }}>
            {events.map((ev) => (
              <label key={ev} className="check"><input type="checkbox" checked={f.events.includes(ev)} onChange={() => toggle(ev)} /><code>{ev}</code></label>
            ))}
          </div>
        </fieldset>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function HealthCell({ id }) {
  const h = useApi(`/dashboards/${id}/health`);
  if (h.loading) return <span className="muted small">checking…</span>;
  if (!h.data?.reachable) return <span className="badge status-failed"><span className="status-dot" />Unreachable</span>;
  return (
    <span className="row">
      <span className="badge status-succeeded"><span className="status-dot" />Online · {h.data.latencyMs} ms</span>
      {h.data.manifest && <span className="tag" title="This dashboard exposes /api/v1/manifest">Compatible</span>}
    </span>
  );
}

export default function ConnectionsPage() {
  const location = useLocation();
  const dashboards = useApi('/dashboards');
  const webhooks = useApi('/webhooks');
  const manifest = useApi('/manifest');
  const [dashForm, setDashForm] = useState(null);
  const [hookForm, setHookForm] = useState(false);
  const [testResult, setTestResult] = useState({});

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash]);

  const dashChanged = () => { dashboards.reload(); window.dispatchEvent(new Event('agent-dashboard:dashboards-changed')); };
  const origin = window.location.origin;

  async function removeDash(d) {
    if (!window.confirm(`Unlink "${d.name}"?`)) return;
    await api(`/dashboards/${d.id}`, { method: 'DELETE' });
    dashChanged();
  }
  async function removeHook(h) {
    if (!window.confirm('Delete this webhook?')) return;
    await api(`/webhooks/${h.id}`, { method: 'DELETE' });
    webhooks.reload();
  }
  async function toggleHook(h) {
    await api(`/webhooks/${h.id}`, { method: 'PATCH', body: { enabled: !h.enabled } });
    webhooks.reload();
  }
  async function testHook(h) {
    setTestResult((t) => ({ ...t, [h.id]: 'sending…' }));
    const r = await api(`/webhooks/${h.id}/test`, { method: 'POST' });
    setTestResult((t) => ({ ...t, [h.id]: r.ok ? `✓ ${r.status}` : `✗ ${r.error || r.status}` }));
    webhooks.reload();
  }
  async function clearDemo() {
    if (!window.confirm('Remove the demo agents and all demo run history?')) return;
    const r = await api('/runs?demo=true', { method: 'DELETE' });
    window.alert(`Removed ${r.removed} demo runs.`);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Connections</h1>
          <p>Link this hub with the other dashboards you build — in both directions.</p>
        </div>
      </div>

      <div className="stack">
        <section className="card" id="dashboards">
          <div className="card-header">
            <div><h2>Linked dashboards</h2><p>Shown in the sidebar. Open them embedded here or in a new tab.</p></div>
            <button className="btn primary" onClick={() => setDashForm({})}>＋ Link dashboard</button>
          </div>
          <div className="table-wrap" style={{ padding: '8px 6px' }}>
            {dashboards.data?.length ? (
              <table>
                <thead><tr><th>Dashboard</th><th>URL</th><th>Opens</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {dashboards.data.map((d) => (
                    <tr key={d.id}>
                      <td>{d.icon} <strong>{d.name}</strong>{d.description && <div className="muted small">{d.description}</div>}</td>
                      <td><a href={d.url} target="_blank" rel="noreferrer">{d.url}</a></td>
                      <td>{d.openMode === 'tab' ? 'New tab' : 'Embedded'}</td>
                      <td><HealthCell id={d.id} /></td>
                      <td className="num"><button className="btn sm" onClick={() => setDashForm(d)}>Edit</button> <button className="btn sm danger" onClick={() => removeDash(d)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty small">No linked dashboards yet.</div>}
          </div>
        </section>

        <section className="card" id="webhooks">
          <div className="card-header">
            <div><h2>Outgoing webhooks</h2><p>Push run events to other dashboards or tools (Slack, Zapier, your own API…).</p></div>
            <button className="btn primary" onClick={() => setHookForm(true)}>＋ Add webhook</button>
          </div>
          <div className="table-wrap" style={{ padding: '8px 6px' }}>
            {webhooks.data?.length ? (
              <table>
                <thead><tr><th>URL</th><th>Events</th><th>Last delivery</th><th /></tr></thead>
                <tbody>
                  {webhooks.data.map((h) => (
                    <tr key={h.id}>
                      <td>{h.url}{h.description && <div className="muted small">{h.description}</div>}{h.hasSecret && <span className="tag">signed</span>}</td>
                      <td className="wrap small">{h.events?.length ? h.events.join(', ') : 'all'}</td>
                      <td className="small">{h.lastDeliveryAt ? `${h.lastStatus} · ${ago(h.lastDeliveryAt)}` : '—'} {testResult[h.id] && <div>{testResult[h.id]}</div>}</td>
                      <td className="num">
                        <button className="btn sm" onClick={() => testHook(h)}>Test</button>{' '}
                        <button className="btn sm" onClick={() => toggleHook(h)}>{h.enabled ? 'Disable' : 'Enable'}</button>{' '}
                        <button className="btn sm danger" onClick={() => removeHook(h)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty small">No webhooks yet.</div>}
          </div>
        </section>

        <section className="card card-pad stack" id="api">
          <div><h2>Connect other dashboards to this one</h2><p className="text-2" style={{ margin: '4px 0 0' }}>Everything the UI does goes through a public REST API, so your other dashboards can list agents, trigger runs, and pull analytics.</p></div>

          <h3>1. Discover — manifest</h3>
          <p className="text-2" style={{ margin: 0 }}>A machine-readable description of this dashboard (pages, endpoints, events). Other dashboards built from this template link to each other through it.</p>
          <pre className="code-block">{`GET ${origin}/api/v1/manifest`}</pre>

          <h3>2. Pull data / trigger runs — REST API</h3>
          <pre className="code-block">{`# List agents
curl ${origin}/api/v1/agents${manifest.data?.authRequired ? ' -H "Authorization: Bearer $DASHBOARD_API_KEY"' : ''}

# Run an agent and wait for the result
curl -X POST ${origin}/api/v1/agents/<agentId>/runs \\
  -H 'content-type: application/json' \\
  -d '{"input": "Summarize open tickets", "wait": true}'

# Performance metrics (same data as the Analytics page)
curl '${origin}/api/v1/analytics?days=30'`}</pre>

          <h3>3. Live updates — Server-Sent Events</h3>
          <pre className="code-block">{`const es = new EventSource('${origin}/api/v1/events${manifest.data?.authRequired ? '?key=…' : ''}');
es.addEventListener('run.succeeded', (e) => console.log(JSON.parse(e.data)));
es.addEventListener('run.failed', (e) => console.log(JSON.parse(e.data)));`}</pre>

          <h3>4. Embed pages — iframe</h3>
          <p className="text-2" style={{ margin: 0 }}>Add <code>?embed=1</code> to any page to hide the navigation. The embedded page posts run events to the parent window and accepts navigation messages.</p>
          <pre className="code-block">{`<iframe src="${origin}/analytics?embed=1" style="width:100%;height:800px;border:0"></iframe>

<script>
  window.addEventListener('message', (e) => {
    if (e.data?.source === 'agent-dashboard') console.log(e.data.type, e.data.data);
  });
  // Tell the embedded dashboard to navigate:
  iframe.contentWindow.postMessage({ target: 'agent-dashboard', type: 'navigate', path: '/agents' }, '*');
</script>`}</pre>
        </section>

        <section className="card card-pad stack">
          <h2>Demo data</h2>
          <p className="text-2" style={{ margin: 0 }}>The dashboard ships with four simulated agents and ~3 months of history so the analytics have something to show. Remove them once you've added your own agents.</p>
          <div><button className="btn danger" onClick={clearDemo}>Remove demo agents &amp; data</button></div>
        </section>
      </div>

      {dashForm && <DashboardForm existing={dashForm.id ? dashForm : null} onClose={() => setDashForm(null)} onSaved={dashChanged} />}
      {hookForm && <WebhookForm events={manifest.data?.webhookEvents || []} onClose={() => setHookForm(false)} onSaved={webhooks.reload} />}
    </>
  );
}
