import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';

let server;
let base;
let hookServer;
const hookCalls = [];

before(async () => {
  const { app } = createApp({ store: createStore({ persist: false }), seed: false });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api/v1`;

  hookServer = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    if (req.url === '/agent') {
      const { input } = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: `echo: ${input}`, usage: { tokensIn: 3, tokensOut: 4, costUsd: 0.5 } }));
      return;
    }
    hookCalls.push({ headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200).end();
  }).listen(0);
  await new Promise((r) => hookServer.once('listening', r));
});

after(() => { server.close(); hookServer.close(); });

const call = async (path, opts = {}) => {
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

test('manifest describes the dashboard', async () => {
  const { body } = await call('/manifest');
  assert.equal(body.schema, 'agent-dashboard.manifest/v1');
  assert.ok(body.pages.some((p) => p.id === 'analytics'));
});

test('validates agents', async () => {
  assert.equal((await call('/agents', { method: 'POST', body: { name: '' , runner: 'mock' } })).status, 400);
  assert.equal((await call('/agents', { method: 'POST', body: { name: 'x', runner: 'nope' } })).status, 400);
});

test('HTTP agent runs end-to-end, fires webhooks and feeds analytics', async () => {
  const hookUrl = `http://localhost:${hookServer.address().port}/hook`;
  const hook = await call('/webhooks', { method: 'POST', body: { url: hookUrl, events: ['run.succeeded'], secret: 's3cret' } });
  assert.equal(hook.status, 201);
  assert.equal(hook.body.hasSecret, true);
  assert.equal(hook.body.secret, undefined);

  const agent = (await call('/agents', {
    method: 'POST',
    body: { name: 'Echo', runner: 'http', config: { url: `http://localhost:${hookServer.address().port}/agent` } },
  })).body;

  const run = (await call(`/agents/${agent.id}/runs`, { method: 'POST', body: { input: 'hello', wait: true } })).body;
  assert.equal(run.status, 'succeeded');
  assert.equal(run.output, 'echo: hello');
  assert.equal(run.costUsd, 0.5);
  assert.equal(run.trigger, 'api');

  const stats = (await call(`/analytics?days=1&agentId=${agent.id}`)).body;
  assert.equal(stats.totals.runs, 1);
  assert.equal(stats.totals.successRate, 1);

  await new Promise((r) => setTimeout(r, 100));
  const delivered = hookCalls.find((c) => c.body.type === 'run.succeeded');
  assert.ok(delivered, 'webhook delivered');
  assert.match(delivered.headers['x-agent-dashboard-signature'], /^sha256=[0-9a-f]{64}$/);
});

test('failed runs record the error; runs can be cancelled', async () => {
  const bad = (await call('/agents', { method: 'POST', body: { name: 'Bad', runner: 'http', config: { url: 'http://localhost:1/nothing' } } })).body;
  const failed = (await call(`/agents/${bad.id}/runs`, { method: 'POST', body: { wait: true } })).body;
  assert.equal(failed.status, 'failed');
  assert.ok(failed.error);

  const slow = (await call('/agents', { method: 'POST', body: { name: 'Slow', runner: 'mock', config: { latencyMs: 5000, failureRate: 0 } } })).body;
  const started = (await call(`/agents/${slow.id}/runs`, { method: 'POST', body: {} })).body;
  await new Promise((r) => setTimeout(r, 50));
  const cancelled = await call(`/runs/${started.id}/cancel`, { method: 'POST' });
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal((await call(`/runs/${started.id}/cancel`, { method: 'POST' })).status, 409);
});

test('command runner is off by default', async () => {
  const agent = (await call('/agents', { method: 'POST', body: { name: 'Cmd', runner: 'command', config: { command: 'echo hi' } } })).body;
  const run = (await call(`/agents/${agent.id}/runs`, { method: 'POST', body: { wait: true } })).body;
  assert.equal(run.status, 'failed');
  assert.match(run.error, /ALLOW_COMMAND_RUNNER/);
});
