import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { compact, duration, pct, usd, ago, number } from '../lib/format.js';
import { useChartColors } from '../lib/theme.js';
import { ErrorBox, StatusBadge } from '../components/ui.jsx';
import { ChartCard, TimeLines, CategoryBars } from '../components/charts.jsx';
import { KpiTiles, RunsOverTime } from './Performance.jsx';

const RANGES = [7, 30, 90];
const MAX_NAMED_SERIES = 7; // the 8th slot is "Other"

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [agentId, setAgentId] = useState('');
  const agents = useApi('/agents');
  const data = useApi(`/analytics?days=${days}${agentId ? `&agentId=${agentId}` : ''}`);
  const refresh = useThrottled(data.reload, 3000);
  useLiveEvents((e) => { if (['run.succeeded', 'run.failed', 'run.cancelled', 'runs.cleared'].includes(e.type)) refresh(); });
  const c = useChartColors();

  // Color follows the agent (its position in the agent list), never its rank.
  const agentColor = useMemo(() => {
    const m = {};
    (agents.data || []).forEach((a, i) => { m[a.id] = i < MAX_NAMED_SERIES ? c.series[i] : c.muted; });
    return m;
  }, [agents.data, c]);

  const byAgent = (data.data?.byAgent || []).filter((a) => a.runs > 0);
  const lineSeries = useMemo(() => {
    const list = (agents.data || []).filter((a) => byAgent.some((b) => b.agentId === a.id));
    const named = list.filter((a) => (agents.data || []).indexOf(a) < MAX_NAMED_SERIES);
    const s = named.map((a) => ({ key: a.id, label: a.name, color: agentColor[a.id] }));
    if (named.length < list.length) s.push({ key: '__other', label: 'Other', color: c.muted });
    return s;
  }, [agents.data, byAgent, agentColor, c]);
  const lineData = (data.data?.timeseries || []).map((d) => {
    const row = { date: d.date };
    for (const [id, n] of Object.entries(d.byAgent)) {
      const key = lineSeries.some((s) => s.key === id) ? id : '__other';
      row[key] = (row[key] || 0) + n;
    }
    for (const s of lineSeries) row[s.key] ??= 0;
    return row;
  });

  const barHeight = Math.max(160, byAgent.length * 40 + 40);
  const leaderboardTable = {
    columns: [
      { key: 'name', label: 'Agent' },
      { key: 'runs', label: 'Runs', num: true, format: number },
      { key: 'successRate', label: 'Success', num: true, format: (v) => pct(v) },
      { key: 'avgDurationMs', label: 'Avg', num: true, format: duration },
      { key: 'p95DurationMs', label: 'p95', num: true, format: duration },
      { key: 'costUsd', label: 'Cost', num: true, format: usd },
    ],
    rows: byAgent,
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p>How each agent is performing: volume, reliability, speed, and cost.</p>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <div className="segmented" aria-label="Time range">
          {RANGES.map((r) => <button key={r} className={days === r ? 'active' : ''} onClick={() => setDays(r)}>Last {r} days</button>)}
        </div>
        <select style={{ maxWidth: 240 }} value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
          <option value="">All agents</option>
          {(agents.data || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <ErrorBox error={data.error} />
      <div className="stack">
        <KpiTiles data={data.data} />

        <div className="grid grid-2">
          <RunsOverTime data={data.data} />
          {!agentId && lineSeries.length > 0 && (
            <ChartCard title="Runs per day by agent" legend={lineSeries}
              table={{ columns: [{ key: 'date', label: 'Date' }, ...lineSeries.map((s) => ({ key: s.key, label: s.label, num: true }))], rows: [...lineData].reverse() }}>
              <TimeLines data={lineData} series={lineSeries} valueFormat={number} />
            </ChartCard>
          )}
        </div>

        {!agentId && byAgent.length > 0 && (
          <>
            <div className="grid grid-2">
              <ChartCard title="Success rate by agent" subtitle="Share of completed runs that succeeded" height={barHeight} table={leaderboardTable}>
                <CategoryBars data={byAgent} series={[{ key: 'successRate', label: 'Success rate', color: c.series[0] }]} valueFormat={(v) => pct(v, 0)} domain={[0, 1]} />
              </ChartCard>
              <ChartCard title="Duration by agent" subtitle="Average vs 95th percentile" height={barHeight} table={leaderboardTable}
                legend={[{ label: 'Average', color: c.series[0] }, { label: 'p95', color: c.series[1] }]}>
                <CategoryBars data={byAgent} series={[
                  { key: 'avgDurationMs', label: 'Average', color: c.series[0] },
                  { key: 'p95DurationMs', label: 'p95', color: c.series[1] },
                ]} valueFormat={duration} />
              </ChartCard>
            </div>
            <div className="grid grid-2">
              <ChartCard title="Runs by agent" height={barHeight} table={leaderboardTable}>
                <CategoryBars data={byAgent} series={[{ key: 'runs', label: 'Runs', color: c.series[0] }]} valueFormat={compact} />
              </ChartCard>
              <ChartCard title="Cost by agent" height={barHeight} table={leaderboardTable}>
                <CategoryBars data={byAgent} series={[{ key: 'costUsd', label: 'Cost', color: c.series[0] }]} valueFormat={usd} />
              </ChartCard>
            </div>
          </>
        )}

        <div className="card">
          <div className="card-header"><h2>Agent leaderboard</h2></div>
          <div className="table-wrap" style={{ padding: '8px 6px' }}>
            <table>
              <thead>
                <tr>
                  <th>Agent</th><th>Last run</th>
                  <th className="num">Runs</th><th className="num">Success</th><th className="num">Failed</th>
                  <th className="num">Avg</th><th className="num">p95</th><th className="num">Tokens</th><th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {(data.data?.byAgent || []).slice().sort((a, b) => b.runs - a.runs).map((a) => (
                  <tr key={a.agentId}>
                    <td><span className="legend-item"><span className="legend-swatch" style={{ background: agentColor[a.agentId] || c.muted }} /><Link to={`/agents/${a.agentId}`}>{a.name}</Link></span></td>
                    <td><span className="row"><StatusBadge status={a.lastStatus} /><span className="muted small">{ago(a.lastRunAt)}</span></span></td>
                    <td className="num">{number(a.runs)}</td>
                    <td className="num">{pct(a.successRate)}</td>
                    <td className="num">{number(a.failed)}</td>
                    <td className="num">{duration(a.avgDurationMs)}</td>
                    <td className="num">{duration(a.p95DurationMs)}</td>
                    <td className="num">{compact(a.tokens)}</td>
                    <td className="num">{usd(a.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
