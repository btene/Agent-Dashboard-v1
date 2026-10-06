// Shared analytics views used by the Analytics page and the agent detail page.
import { compact, duration, pct, usd, number } from '../lib/format.js';
import { useChartColors } from '../lib/theme.js';
import { StatTile } from '../components/ui.jsx';
import { ChartCard, StackedTimeBars } from '../components/charts.jsx';

export function KpiTiles({ data }) {
  const t = data?.totals || {};
  const p = data?.previous || {};
  return (
    <div className="grid grid-tiles">
      <StatTile label="Total runs" current={t.runs} previous={p.runs} format={compact} />
      <StatTile label="Success rate" current={t.successRate} previous={p.successRate} format={(v) => pct(v)} deltaMode="points" />
      <StatTile label="Avg duration" current={t.avgDurationMs} previous={p.avgDurationMs} format={duration} upIsGood={false} />
      <StatTile label="p95 duration" current={t.p95DurationMs} previous={p.p95DurationMs} format={duration} upIsGood={false} />
      <StatTile label="Tokens" current={t.tokens} previous={p.tokens} format={compact} upIsGood={false} />
      <StatTile label="Cost" current={t.costUsd} previous={p.costUsd} format={usd} upIsGood={false} />
    </div>
  );
}

export function RunsOverTime({ data }) {
  const c = useChartColors();
  const series = [
    { key: 'succeeded', label: 'Succeeded', color: c.good },
    { key: 'failed', label: 'Failed', color: c.critical },
  ];
  return (
    <ChartCard title="Runs per day" subtitle="Succeeded vs failed" legend={series}
      table={{
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'succeeded', label: 'Succeeded', num: true },
          { key: 'failed', label: 'Failed', num: true },
          { key: 'costUsd', label: 'Cost', num: true, format: usd },
        ],
        rows: [...(data?.timeseries || [])].reverse(),
      }}>
      <StackedTimeBars data={data?.timeseries || []} series={series} valueFormat={number} />
    </ChartCard>
  );
}
