import { useState } from 'react';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { ErrorBox } from '../components/ui.jsx';
import RunsTable from './RunsTable.jsx';

const PAGE = 50;

export default function RunsPage() {
  const agents = useApi('/agents');
  const [agentId, setAgentId] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const qs = new URLSearchParams({ limit: PAGE, offset, ...(agentId && { agentId }), ...(status && { status }) });
  const runs = useApi(`/runs?${qs}`);
  const refresh = useThrottled(runs.reload, 1000);
  useLiveEvents((e) => { if (e.type === 'run.updated' || e.type === 'runs.cleared') refresh(); });

  const total = runs.data?.total ?? 0;
  return (
    <>
      <div className="page-header">
        <div><h1>Run history</h1><p>Every run across all agents, newest first. Updates live.</p></div>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <select style={{ maxWidth: 220 }} value={agentId} onChange={(e) => { setAgentId(e.target.value); setOffset(0); }}>
          <option value="">All agents</option>
          {(agents.data || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select style={{ maxWidth: 180 }} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">Any status</option>
          <option value="running,queued">Running</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <span className="spacer" />
        <span className="muted small">{total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}` : ''}</span>
        <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Newer</button>
        <button className="btn sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Older →</button>
      </div>
      <ErrorBox error={runs.error} />
      <div className="card"><RunsTable runs={runs.data?.items} /></div>
    </>
  );
}
