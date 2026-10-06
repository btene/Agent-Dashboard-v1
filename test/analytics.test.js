import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAnalytics } from '../server/analytics.js';

const now = Date.parse('2026-10-06T12:00:00Z');
const run = (agentId, status, hoursAgo, extra = {}) => ({
  id: Math.random().toString(36), agentId, status,
  createdAt: new Date(now - hoursAgo * 3600_000).toISOString(),
  durationMs: 1000, tokensIn: 10, tokensOut: 5, costUsd: 0.01, ...extra,
});

test('totals, success rate and per-agent breakdown', () => {
  const agents = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const runs = [
    run('a', 'succeeded', 1, { durationMs: 1000 }),
    run('a', 'failed', 2, { durationMs: 3000 }),
    run('b', 'succeeded', 3),
    run('b', 'cancelled', 4),
    run('a', 'succeeded', 24 * 10), // previous 7-day period
  ];
  const r = computeAnalytics(runs, agents, { days: 7, now });
  assert.equal(r.totals.runs, 4);
  assert.equal(r.totals.succeeded, 2);
  assert.equal(r.totals.failed, 1);
  assert.equal(r.totals.cancelled, 1);
  assert.equal(r.totals.successRate, 2 / 3);
  assert.equal(r.previous.runs, 1);
  assert.equal(r.timeseries.length, 7);
  assert.equal(r.timeseries.at(-1).runs, 4);
  const a = r.byAgent.find((x) => x.agentId === 'a');
  assert.equal(a.runs, 2);
  assert.equal(a.avgDurationMs, 2000);
  assert.equal(a.p95DurationMs, 3000);
});

test('agent filter scopes everything', () => {
  const agents = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const r = computeAnalytics([run('a', 'succeeded', 1), run('b', 'failed', 1)], agents, { days: 7, now, agentId: 'b' });
  assert.equal(r.totals.runs, 1);
  assert.deepEqual(r.byAgent.map((x) => x.agentId), ['b']);
});

test('empty history yields nulls, not NaN', () => {
  const r = computeAnalytics([], [], { days: 3, now });
  assert.equal(r.totals.successRate, null);
  assert.equal(r.totals.avgDurationMs, null);
  assert.equal(r.timeseries.length, 3);
});
