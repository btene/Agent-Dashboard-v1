// Aggregates run history into the numbers shown on the Analytics page.
const DAY = 86_400_000;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

function summarize(runs) {
  const done = runs.filter((r) => ['succeeded', 'failed'].includes(r.status));
  const succeeded = done.filter((r) => r.status === 'succeeded').length;
  const durations = done.map((r) => r.durationMs || 0).sort((a, b) => a - b);
  const sum = (f) => runs.reduce((a, r) => a + (Number(r[f]) || 0), 0);
  return {
    runs: runs.length,
    succeeded,
    failed: done.length - succeeded,
    cancelled: runs.filter((r) => r.status === 'cancelled').length,
    successRate: done.length ? succeeded / done.length : null,
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    p95DurationMs: durations.length ? percentile(durations, 95) : null,
    tokens: sum('tokensIn') + sum('tokensOut'),
    costUsd: Math.round(sum('costUsd') * 10000) / 10000,
  };
}

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * @param {object[]} allRuns
 * @param {object[]} agents
 * @param {{ days?: number, agentId?: string, now?: number }} opts
 */
export function computeAnalytics(allRuns, agents, { days = 30, agentId, now = Date.now() } = {}) {
  const start = now - days * DAY;
  const prevStart = start - days * DAY;
  const scoped = agentId ? allRuns.filter((r) => r.agentId === agentId) : allRuns;
  const current = scoped.filter((r) => Date.parse(r.createdAt) >= start && Date.parse(r.createdAt) <= now);
  const previous = scoped.filter((r) => Date.parse(r.createdAt) >= prevStart && Date.parse(r.createdAt) < start);

  // Daily buckets, oldest first, one per day even when empty.
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    buckets.set(dayKey(now - i * DAY), { date: dayKey(now - i * DAY), runs: 0, succeeded: 0, failed: 0, costUsd: 0, byAgent: {} });
  }
  for (const r of current) {
    const b = buckets.get(dayKey(r.createdAt));
    if (!b) continue;
    b.runs++;
    if (r.status === 'succeeded') b.succeeded++;
    if (r.status === 'failed') b.failed++;
    b.costUsd += r.costUsd || 0;
    b.byAgent[r.agentId] = (b.byAgent[r.agentId] || 0) + 1;
  }

  const agentIds = agentId ? [agentId] : agents.map((a) => a.id);
  const byAgent = agentIds.map((id) => {
    const agent = agents.find((a) => a.id === id);
    const runs = current.filter((r) => r.agentId === id);
    const last = scoped.filter((r) => r.agentId === id).at(-1);
    return {
      agentId: id,
      name: agent?.name ?? runs[0]?.agentName ?? id,
      runner: agent?.runner,
      ...summarize(runs),
      lastRunAt: last?.createdAt ?? null,
      lastStatus: last?.status ?? null,
    };
  });

  return {
    range: { days, from: new Date(start).toISOString(), to: new Date(now).toISOString() },
    totals: summarize(current),
    previous: summarize(previous),
    timeseries: [...buckets.values()].map((b) => ({ ...b, costUsd: Math.round(b.costUsd * 10000) / 10000 })),
    byAgent,
  };
}
