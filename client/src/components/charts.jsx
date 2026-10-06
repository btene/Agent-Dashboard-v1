// Chart building blocks (Recharts) following one set of conventions:
// thin marks, rounded data-ends, hairline grid, legend for ≥2 series,
// hover tooltips everywhere, and a table view for every chart.
import { useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts';
import { shortDate } from '../lib/format.js';
import { useChartColors } from '../lib/theme.js';

const axisProps = (c) => ({
  tick: { fill: c.muted, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: c.axis },
});

export function ChartCard({ title, subtitle, legend, table, children, height = 260 }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {table && (
          <div className="segmented" role="tablist" aria-label="View">
            <button className={!showTable ? 'active' : ''} onClick={() => setShowTable(false)}>Chart</button>
            <button className={showTable ? 'active' : ''} onClick={() => setShowTable(true)}>Table</button>
          </div>
        )}
      </div>
      {legend && legend.length > 1 && !showTable && (
        <div className="legend">
          {legend.map((l) => (
            <span key={l.label} className="legend-item"><span className="legend-swatch" style={{ background: l.color }} />{l.label}</span>
          ))}
        </div>
      )}
      <div className="chart-body">
        {showTable && table ? (
          <div className="table-wrap" style={{ maxHeight: height + 40, overflowY: 'auto' }}>
            <table>
              <thead><tr>{table.columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>{table.columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.format ? c.format(r[c.key], r) : r[c.key]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ width: '100%', height }}>
            <ResponsiveContainer>{children}</ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function TooltipBox({ active, payload, label, labelFormat, valueFormat, showTotal }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((a, p) => a + (Number(p.value) || 0), 0);
  return (
    <div className="chart-tooltip">
      <div className="t">{labelFormat ? labelFormat(label) : label}</div>
      {payload.map((p) => (
        <div className="r" key={p.dataKey}>
          <span className="legend-swatch" style={{ background: p.color || p.fill }} />
          <span>{p.name}</span>
          <span className="v">{valueFormat ? valueFormat(p.value, p.dataKey) : p.value}</span>
        </div>
      ))}
      {showTotal && payload.length > 1 && (
        <div className="r" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
          <span>Total</span><span className="v">{valueFormat ? valueFormat(total) : total}</span>
        </div>
      )}
    </div>
  );
}

/** Stacked columns over time. series: [{ key, label, color }] (bottom → top) */
export function StackedTimeBars({ data, series, valueFormat }) {
  const c = useChartColors();
  return (
    <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barCategoryGap="20%">
      <CartesianGrid vertical={false} stroke={c.grid} />
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps(c)} />
      <YAxis allowDecimals={false} {...axisProps(c)} axisLine={false} width={48} />
      <Tooltip cursor={{ fill: c['accent-wash'] }} content={<TooltipBox labelFormat={shortDate} valueFormat={valueFormat} showTotal />} />
      {series.map((s, i) => (
        <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} maxBarSize={24}
          stroke={c.surface} strokeWidth={1}
          radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
      ))}
    </BarChart>
  );
}

/** Multi-line chart over time. series: [{ key, label, color }] */
export function TimeLines({ data, series, valueFormat }) {
  const c = useChartColors();
  return (
    <LineChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
      <CartesianGrid vertical={false} stroke={c.grid} />
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps(c)} />
      <YAxis allowDecimals={false} {...axisProps(c)} axisLine={false} width={48} />
      <Tooltip cursor={{ stroke: c.axis }} content={<TooltipBox labelFormat={shortDate} valueFormat={valueFormat} />} />
      {series.map((s) => (
        <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
          dot={false} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
      ))}
    </LineChart>
  );
}

/**
 * Horizontal bars by category. series: [{ key, label, color }].
 * With one series the value is printed at the bar tip.
 */
export function CategoryBars({ data, categoryKey = 'name', series, valueFormat, domain }) {
  const c = useChartColors();
  const single = series.length === 1;
  return (
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: single ? 56 : 16, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
      <CartesianGrid horizontal={false} stroke={c.grid} />
      <XAxis type="number" domain={domain} tickFormatter={(v) => (valueFormat ? valueFormat(v) : v)} {...axisProps(c)} />
      <YAxis type="category" dataKey={categoryKey} width={140} {...axisProps(c)} axisLine={false}
        tickFormatter={(v) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
      <Tooltip cursor={{ fill: c['accent-wash'] }} content={<TooltipBox valueFormat={valueFormat} />} />
      {series.map((s) => (
        <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={single ? 20 : 12} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {single && <LabelList dataKey={s.key} position="right" formatter={(v) => (valueFormat ? valueFormat(v) : v)} style={{ fill: c['text-2'], fontSize: 12 }} />}
        </Bar>
      ))}
    </BarChart>
  );
}
