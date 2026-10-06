import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { dateTime } from '../lib/format.js';
import { ErrorBox, RunnerBadge } from '../components/ui.jsx';
import AgentForm from '../components/AgentForm.jsx';
import RunsTable from './RunsTable.jsx';
import { KpiTiles, RunsOverTime } from './Performance.jsx';

export default function AgentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const agent = useApi(`/agents/${id}`);
  const runs = useApi(`/runs?agentId=${id}&limit=25`);
  const stats = useApi(`/analytics?days=30&agentId=${id}`);
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refreshRuns = useThrottled(runs.reload, 800);
  const refreshStats = useThrottled(stats.reload, 3000);
  useLiveEvents((e) => {
    if (e.type === 'run.updated' && e.data.agentId === id) {
      refreshRuns();
      if (!['queued', 'running'].includes(e.data.status)) refreshStats();
    }
  });

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api(`/agents/${id}/runs`, { method: 'POST', body: { input } });
      navigate(`/runs/${r.id}`);
    } catch (e) { setError(e); setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(`Delete "${a.name}"? Its run history is kept for analytics unless you clear it.`)) return;
    await api(`/agents/${id}`, { method: 'DELETE' });
    navigate('/agents');
  }

  if (agent.error) return <ErrorBox error={agent.error} />;
  const a = agent.data;
  if (!a) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <div className="agent-avatar" style={{ width: 52, height: 52, fontSize: 26 }}>{a.icon || '🤖'}</div>
          <div>
            <div className="muted small"><Link to="/agents">Agents</Link> /</div>
            <h1>{a.name}</h1>
            <p>{a.description}</p>
            <div className="row" style={{ marginTop: 6 }}><RunnerBadge runner={a.runner} />{a.tags?.map((t) => <span key={t} className="tag">#{t}</span>)}</div>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setEditing(true)}>Edit</button>
          <button className="btn danger" onClick={remove}>Delete</button>
        </div>
      </div>

      <div className="stack">
        <div className="card card-pad stack">
          <h2>Run this agent</h2>
          <textarea rows={4} value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={a.inputPlaceholder || 'Instructions or data for the agent…'}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }} />
          <div className="row">
            <button className="btn primary" onClick={run} disabled={busy}>▶ Run</button>
            <span className="muted small">⌘/Ctrl + Enter</span>
          </div>
          <ErrorBox error={error} />
        </div>

        <h2 style={{ marginTop: 8 }}>Last 30 days</h2>
        <KpiTiles data={stats.data} />
        <RunsOverTime data={stats.data} />

        <div className="card">
          <div className="card-header"><h2>Recent runs</h2><Link to="/runs" className="small">All runs →</Link></div>
          <RunsTable runs={runs.data?.items} showAgent={false} />
        </div>

        <div className="card card-pad stack">
          <h2>Configuration</h2>
          <dl className="kv">
            <dt>Agent ID</dt><dd className="mono">{a.id}</dd>
            <dt>Runner</dt><dd>{a.runner}</dd>
            {Object.entries(a.config || {}).map(([k, v]) => (
              <FragmentKV key={k} k={k} v={/key|secret|token|authorization|headers/i.test(k) ? '••••••' : typeof v === 'object' ? JSON.stringify(v) : String(v)} />
            ))}
            <dt>Created</dt><dd>{dateTime(a.createdAt)}</dd>
            <dt>Run via API</dt>
            <dd><pre className="code-block">{`curl -X POST ${window.location.origin}/api/v1/agents/${a.id}/runs \\
  -H 'content-type: application/json' \\
  -d '{"input": "…", "wait": true}'`}</pre></dd>
          </dl>
        </div>
      </div>

      {editing && <AgentForm agent={a} onClose={() => setEditing(false)} onSaved={agent.reload} />}
    </>
  );
}

function FragmentKV({ k, v }) {
  return <><dt>{k}</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{v}</dd></>;
}
