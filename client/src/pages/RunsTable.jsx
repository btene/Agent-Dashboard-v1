import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/ui.jsx';
import { dateTime, duration, usd, compact } from '../lib/format.js';

export default function RunsTable({ runs, showAgent = true }) {
  const navigate = useNavigate();
  if (!runs?.length) return <div className="empty small">No runs yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            {showAgent && <th>Agent</th>}
            <th>Started</th>
            <th>Input</th>
            <th className="num">Duration</th>
            <th className="num">Tokens</th>
            <th className="num">Cost</th>
            <th>Trigger</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => navigate(`/runs/${r.id}`)}>
              <td><StatusBadge status={r.status} /></td>
              {showAgent && <td>{r.agentName}</td>}
              <td className="tabular">{dateTime(r.createdAt)}</td>
              <td className="wrap muted" title={r.input}>{r.input || '—'}</td>
              <td className="num">{duration(r.durationMs)}</td>
              <td className="num">{compact((r.tokensIn || 0) + (r.tokensOut || 0))}</td>
              <td className="num">{usd(r.costUsd)}</td>
              <td><span className="tag">{r.trigger}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
