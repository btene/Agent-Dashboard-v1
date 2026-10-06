import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, useLiveEvents } from '../lib/hooks.js';
import { StatusBadge, ErrorBox } from '../components/ui.jsx';
import { dateTime, duration, number, usd } from '../lib/format.js';

export default function RunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const run = useApi(`/runs/${id}`);
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);
  const r = run.data;
  const active = r && ['queued', 'running'].includes(r.status);

  useEffect(() => { if (r) setLogs(r.logs || []); }, [r]);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [logs]);

  useLiveEvents((e) => {
    if (e.type === 'run.log' && e.data.runId === id) setLogs((l) => [...l, e.data.entry]);
    if (e.type === 'run.updated' && e.data.id === id && !['queued', 'running'].includes(e.data.status)) run.reload();
  });

  const [busy, setBusy] = useState(false);
  async function cancel() {
    setBusy(true);
    try { await api(`/runs/${id}/cancel`, { method: 'POST' }); } finally { setBusy(false); run.reload(); }
  }
  async function rerun() {
    const next = await api(`/agents/${r.agentId}/runs`, { method: 'POST', body: { input: r.input } });
    navigate(`/runs/${next.id}`);
  }

  if (run.error) return <ErrorBox error={run.error} />;
  if (!r) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="muted small"><Link to={`/agents/${r.agentId}`}>{r.agentName}</Link> / run</div>
          <h1 className="row">Run <span className="mono" style={{ fontSize: 16 }}>{r.id}</span> <StatusBadge status={r.status} /></h1>
        </div>
        <div className="row">
          {active && <button className="btn danger" onClick={cancel} disabled={busy}>■ Cancel</button>}
          {!active && <button className="btn" onClick={rerun}>↻ Run again</button>}
        </div>
      </div>

      <div className="grid grid-detail">
        <div className="stack">
          <div className="card card-pad stack">
            <h2>Input</h2>
            <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{r.input || '(empty)'}</pre>
          </div>
          <div className="card card-pad stack">
            <h2>{r.status === 'failed' ? 'Error' : 'Output'}</h2>
            {r.status === 'failed' && <div className="error-box"><pre>{r.error}</pre></div>}
            {r.output != null && <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{r.output}</pre>}
            {active && <div className="muted">Waiting for the agent to finish…</div>}
          </div>
          <div className="card card-pad stack">
            <h2>Logs</h2>
            <div className="log" ref={logRef}>
              {logs.length === 0 && <span className="muted">No log output.</span>}
              {logs.map((l, i) => (
                <div key={i} className={`log-line ${l.level}`}>
                  <span className="ts">{new Date(l.t).toLocaleTimeString()}</span>
                  <span className="msg">{l.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card card-pad">
          <dl className="kv">
            <dt>Agent</dt><dd><Link to={`/agents/${r.agentId}`}>{r.agentName}</Link></dd>
            <dt>Started</dt><dd>{dateTime(r.startedAt)}</dd>
            <dt>Finished</dt><dd>{dateTime(r.finishedAt)}</dd>
            <dt>Duration</dt><dd>{duration(r.durationMs)}</dd>
            <dt>Tokens in</dt><dd>{number(r.tokensIn)}</dd>
            <dt>Tokens out</dt><dd>{number(r.tokensOut)}</dd>
            <dt>Cost</dt><dd>{usd(r.costUsd)}</dd>
            <dt>Trigger</dt><dd><span className="tag">{r.trigger}</span></dd>
            {r.source && <><dt>Source</dt><dd>{String(r.source)}</dd></>}
          </dl>
        </div>
      </div>
    </>
  );
}
