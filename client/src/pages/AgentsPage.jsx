import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { ago, compact, duration, pct } from '../lib/format.js';
import { StatusBadge, RunnerBadge, ErrorBox, Empty } from '../components/ui.jsx';
import AgentForm from '../components/AgentForm.jsx';
import RunDialog from '../components/RunDialog.jsx';

export default function AgentsPage() {
  const agents = useApi('/agents');
  const stats = useApi('/analytics?days=7');
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [live, setLive] = useState({}); // agentId -> latest status from the event stream

  const refreshStats = useThrottled(stats.reload, 1500);
  useLiveEvents((e) => {
    if (e.type === 'run.updated') {
      setLive((l) => ({ ...l, [e.data.agentId]: e.data.status }));
      if (!['queued', 'running'].includes(e.data.status)) refreshStats();
    }
    if (e.type.startsWith('agent.')) agents.reload();
  });

  const byAgent = useMemo(() => Object.fromEntries((stats.data?.byAgent || []).map((a) => [a.agentId, a])), [stats.data]);
  const tags = useMemo(() => [...new Set((agents.data || []).flatMap((a) => a.tags || []))].sort(), [agents.data]);
  const filtered = (agents.data || []).filter((a) =>
    (!tag || a.tags?.includes(tag)) &&
    (!query || `${a.name} ${a.description}`.toLowerCase().includes(query.toLowerCase())));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Agents</h1>
          <p>All of your agents in one place. Run them, watch them, and see how they're doing (last 7 days).</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>＋ Add agent</button>
      </div>

      {agents.data?.length > 0 && (
        <div className="row" style={{ marginBottom: 16 }}>
          <input style={{ maxWidth: 280 }} placeholder="Search agents…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {tags.length > 0 && (
            <select style={{ maxWidth: 180 }} value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All tags</option>
              {tags.map((t) => <option key={t}>{t}</option>)}
            </select>
          )}
        </div>
      )}

      <ErrorBox error={agents.error} />
      {agents.data?.length === 0 && (
        <div className="card">
          <Empty title="No agents yet">
            <p>Add your first agent — point it at an HTTP endpoint, a Claude prompt, or a local script.</p>
            <button className="btn primary" onClick={() => setCreating(true)}>＋ Add agent</button>
          </Empty>
        </div>
      )}

      <div className="grid grid-agents">
        {filtered.map((a) => {
          const s = byAgent[a.id];
          const status = live[a.id] || s?.lastStatus;
          return (
            <div key={a.id} className="card agent-card">
              <div className="agent-card-top">
                <div className="agent-avatar" aria-hidden="true">{a.icon || '🤖'}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3><Link to={`/agents/${a.id}`}>{a.name}</Link></h3>
                  <p className="desc">{a.description || <span className="muted">No description</span>}</p>
                </div>
              </div>
              <div className="row">
                <StatusBadge status={status} />
                <RunnerBadge runner={a.runner} />
                {a.tags?.map((t) => <span key={t} className="tag">#{t}</span>)}
              </div>
              <div className="mini-stats">
                <div><div className="v">{compact(s?.runs ?? 0)}</div><div className="l">Runs</div></div>
                <div><div className="v">{pct(s?.successRate, 0)}</div><div className="l">Success</div></div>
                <div><div className="v">{duration(s?.avgDurationMs)}</div><div className="l">Avg time</div></div>
              </div>
              <div className="row">
                <span className="muted small">Last run {ago(s?.lastRunAt)}</span>
                <span className="spacer" />
                <Link className="btn sm" to={`/agents/${a.id}`}>Details</Link>
                <button className="btn sm primary" onClick={() => setRunning(a)}>▶ Run</button>
              </div>
            </div>
          );
        })}
      </div>

      {creating && <AgentForm onClose={() => setCreating(false)} onSaved={agents.reload} />}
      {running && <RunDialog agent={running} onClose={() => setRunning(null)} />}
    </>
  );
}
