// REST API (v1). Every page in the UI is built on these endpoints, so other
// dashboards and scripts can do anything the UI can.
import express from 'express';
import crypto from 'node:crypto';
import { runners, describeRunners } from './runners/index.js';
import { commandRunnerEnabled } from './runners/command.js';
import { computeAnalytics } from './analytics.js';
import { WEBHOOK_EVENTS, deliver } from './webhooks.js';

export const API_VERSION = '1.0.0';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (what) => new HttpError(404, `${what} not found`);

function isHttpUrl(s) {
  try { return ['http:', 'https:'].includes(new URL(s).protocol); } catch { return false; }
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function requireApiKey(req, res, next) {
  const key = process.env.DASHBOARD_API_KEY;
  if (!key) return next();
  const header = req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.get('x-api-key') || req.query.key;
  if (header && safeEqual(header, key)) return next();
  res.status(401).json({ error: 'Missing or invalid API key' });
}

const AGENT_FIELDS = ['name', 'description', 'runner', 'config', 'tags', 'icon', 'inputPlaceholder', 'defaultInput'];

function validateAgent(body, { partial = false } = {}) {
  const a = pick(body || {}, AGENT_FIELDS);
  if (!partial || a.name !== undefined) {
    if (typeof a.name !== 'string' || !a.name.trim()) throw bad('`name` is required');
    a.name = a.name.trim().slice(0, 120);
  }
  if (!partial || a.runner !== undefined) {
    if (!runners[a.runner]) throw bad(`\`runner\` must be one of: ${Object.keys(runners).join(', ')}`);
  }
  if (a.config !== undefined && (typeof a.config !== 'object' || Array.isArray(a.config) || a.config === null)) throw bad('`config` must be an object');
  if (a.tags !== undefined) {
    if (!Array.isArray(a.tags)) throw bad('`tags` must be an array of strings');
    a.tags = a.tags.map(String).map((t) => t.trim()).filter(Boolean).slice(0, 20);
  }
  if (a.runner === 'http' && a.config?.url && !isHttpUrl(a.config.url)) throw bad('HTTP runner `config.url` must be an http(s) URL');
  return a;
}

function runSummary(r) {
  const { logs, output, input, ...rest } = r;
  return { ...rest, input: input?.slice(0, 200), outputPreview: output?.slice(0, 200) ?? null };
}

export function createApi({ store, bus, runService }) {
  const api = express.Router();
  api.use(express.json({ limit: '2mb' }));

  // ---- Discovery (public) -------------------------------------------------
  const meta = () => ({
    name: process.env.DASHBOARD_NAME || 'Agent Dashboard',
    version: API_VERSION,
    authRequired: Boolean(process.env.DASHBOARD_API_KEY),
    features: {
      commandRunner: commandRunnerEnabled(),
      claude: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    },
  });
  api.get('/meta', (req, res) => res.json(meta()));

  // A machine-readable description of this dashboard. Other dashboards you
  // build can fetch /api/v1/manifest to discover what this one offers.
  api.get('/manifest', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      schema: 'agent-dashboard.manifest/v1',
      ...meta(),
      baseUrl: base,
      api: `${base}/api/v1`,
      events: `${base}/api/v1/events`,
      pages: [
        { id: 'agents', title: 'Agents', path: '/agents', embed: `${base}/agents?embed=1` },
        { id: 'analytics', title: 'Analytics', path: '/analytics', embed: `${base}/analytics?embed=1` },
        { id: 'runs', title: 'Run history', path: '/runs', embed: `${base}/runs?embed=1` },
      ],
      endpoints: {
        listAgents: 'GET /api/v1/agents',
        runAgent: 'POST /api/v1/agents/:id/runs',
        getRun: 'GET /api/v1/runs/:id',
        analytics: 'GET /api/v1/analytics?days=30&agentId=',
        events: 'GET /api/v1/events (text/event-stream)',
      },
      webhookEvents: WEBHOOK_EVENTS,
    });
  });

  api.use(requireApiKey);

  api.get('/runners', (req, res) => res.json(describeRunners().map((r) => ({
    ...r,
    available: r.type !== 'command' || commandRunnerEnabled(),
  }))));

  // ---- Agents -------------------------------------------------------------
  api.get('/agents', (req, res) => res.json(store.list('agents')));

  api.post('/agents', (req, res) => {
    const a = validateAgent(req.body);
    const now = new Date().toISOString();
    const agent = store.insert('agents', { id: store.newId('agt'), config: {}, tags: [], ...a, createdAt: now, updatedAt: now });
    bus.publish('agent.created', agent);
    res.status(201).json(agent);
  });

  api.get('/agents/:id', (req, res) => {
    const agent = store.get('agents', req.params.id);
    if (!agent) throw notFound('Agent');
    res.json(agent);
  });

  api.patch('/agents/:id', (req, res) => {
    if (!store.get('agents', req.params.id)) throw notFound('Agent');
    const patch = validateAgent(req.body, { partial: true });
    const agent = store.update('agents', req.params.id, { ...patch, updatedAt: new Date().toISOString() });
    bus.publish('agent.updated', agent);
    res.json(agent);
  });

  api.delete('/agents/:id', (req, res) => {
    const agent = store.get('agents', req.params.id);
    if (!agent) throw notFound('Agent');
    store.remove('agents', agent.id);
    if (req.query.purgeRuns === 'true') store.removeWhere('runs', (r) => r.agentId === agent.id);
    bus.publish('agent.deleted', { id: agent.id, name: agent.name });
    res.status(204).end();
  });

  // Trigger a run. `wait: true` blocks until the run finishes (handy for
  // scripts / other dashboards that want the result in one request).
  api.post('/agents/:id/runs', async (req, res) => {
    const agent = store.get('agents', req.params.id);
    if (!agent) throw notFound('Agent');
    const { input = '', wait = false, source = null } = req.body || {};
    const trigger = req.get('x-agent-dashboard-client') === 'ui' ? 'dashboard' : 'api';
    const run = runService.start(agent, { input, trigger, source });
    if (!wait) return res.status(202).json(run);
    res.json(await runService.waitFor(run.id, Number(req.body.timeoutMs) || 300_000));
  });

  // ---- Runs ---------------------------------------------------------------
  api.get('/runs', (req, res) => {
    const { agentId, status, trigger } = req.query;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Number(req.query.offset) || 0;
    let runs = store.list('runs');
    if (agentId) runs = runs.filter((r) => r.agentId === agentId);
    if (status) runs = runs.filter((r) => String(status).split(',').includes(r.status));
    if (trigger) runs = runs.filter((r) => r.trigger === trigger);
    const items = runs.slice().reverse().slice(offset, offset + limit).map(runSummary);
    res.json({ total: runs.length, limit, offset, items });
  });

  api.get('/runs/:id', (req, res) => {
    const run = store.get('runs', req.params.id);
    if (!run) throw notFound('Run');
    res.json(run);
  });

  api.post('/runs/:id/cancel', (req, res) => {
    const run = store.get('runs', req.params.id);
    if (!run) throw notFound('Run');
    const cancelled = runService.cancel(run.id);
    if (!cancelled) throw new HttpError(409, `Run is not active (status: ${run.status})`);
    res.json(cancelled);
  });

  // Clear history. `?demo=true` removes only seeded demo data (and demo agents).
  api.delete('/runs', (req, res) => {
    let removed;
    if (req.query.demo === 'true') {
      removed = store.removeWhere('runs', (r) => r.trigger === 'demo');
      store.removeWhere('agents', (a) => a.demo);
    } else if (req.query.agentId) {
      removed = store.removeWhere('runs', (r) => r.agentId === req.query.agentId && !runService.isActive(r.id));
    } else {
      throw bad('Pass ?agentId=… or ?demo=true');
    }
    bus.publish('runs.cleared', { removed });
    res.json({ removed });
  });

  // ---- Analytics ----------------------------------------------------------
  api.get('/analytics', (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    res.json(computeAnalytics(store.list('runs'), store.list('agents'), { days, agentId: req.query.agentId || undefined }));
  });

  // ---- Linked dashboards --------------------------------------------------
  const DASH_FIELDS = ['name', 'url', 'description', 'icon', 'openMode'];
  function validateDashboard(body, partial) {
    const d = pick(body || {}, DASH_FIELDS);
    if (!partial || d.name !== undefined) if (!d.name?.trim()) throw bad('`name` is required');
    if (!partial || d.url !== undefined) if (!isHttpUrl(d.url)) throw bad('`url` must be an http(s) URL');
    if (d.openMode !== undefined && !['embed', 'tab'].includes(d.openMode)) throw bad('`openMode` must be "embed" or "tab"');
    return d;
  }
  api.get('/dashboards', (req, res) => res.json(store.list('dashboards')));
  api.post('/dashboards', (req, res) => {
    const d = validateDashboard(req.body, false);
    res.status(201).json(store.insert('dashboards', { id: store.newId('dsh'), openMode: 'embed', icon: '📊', ...d, createdAt: new Date().toISOString() }));
  });
  api.patch('/dashboards/:id', (req, res) => {
    if (!store.get('dashboards', req.params.id)) throw notFound('Dashboard');
    res.json(store.update('dashboards', req.params.id, validateDashboard(req.body, true)));
  });
  api.delete('/dashboards/:id', (req, res) => {
    if (!store.remove('dashboards', req.params.id)) throw notFound('Dashboard');
    res.status(204).end();
  });
  // Checks reachability and whether the target speaks the same manifest
  // protocol (i.e. is another dashboard built from this template).
  api.get('/dashboards/:id/health', async (req, res) => {
    const d = store.get('dashboards', req.params.id);
    if (!d) throw notFound('Dashboard');
    const started = Date.now();
    const result = { reachable: false, status: null, latencyMs: null, manifest: null };
    try {
      const r = await fetch(d.url, { signal: AbortSignal.timeout(5000), redirect: 'follow' });
      result.reachable = r.ok;
      result.status = r.status;
      result.latencyMs = Date.now() - started;
      const m = await fetch(new URL('/api/v1/manifest', d.url), { signal: AbortSignal.timeout(3000) });
      if (m.ok) {
        const body = await m.json().catch(() => null);
        if (body?.schema?.startsWith('agent-dashboard.manifest')) result.manifest = body;
      }
    } catch (err) {
      result.error = err.message;
    }
    res.json(result);
  });

  // ---- Webhooks -----------------------------------------------------------
  function validateWebhook(body, partial) {
    const w = pick(body || {}, ['url', 'events', 'secret', 'enabled', 'description']);
    if (!partial || w.url !== undefined) if (!isHttpUrl(w.url)) throw bad('`url` must be an http(s) URL');
    if (w.events !== undefined) {
      if (!Array.isArray(w.events) || w.events.some((e) => !WEBHOOK_EVENTS.includes(e))) throw bad(`\`events\` must be a subset of: ${WEBHOOK_EVENTS.join(', ')}`);
    }
    return w;
  }
  const publicHook = ({ secret, ...h }) => ({ ...h, hasSecret: Boolean(secret) });
  api.get('/webhooks', (req, res) => res.json(store.list('webhooks').map(publicHook)));
  api.post('/webhooks', (req, res) => {
    const w = validateWebhook(req.body, false);
    res.status(201).json(publicHook(store.insert('webhooks', { id: store.newId('whk'), events: [], enabled: true, ...w, createdAt: new Date().toISOString() })));
  });
  api.patch('/webhooks/:id', (req, res) => {
    if (!store.get('webhooks', req.params.id)) throw notFound('Webhook');
    res.json(publicHook(store.update('webhooks', req.params.id, validateWebhook(req.body, true))));
  });
  api.delete('/webhooks/:id', (req, res) => {
    if (!store.remove('webhooks', req.params.id)) throw notFound('Webhook');
    res.status(204).end();
  });
  api.post('/webhooks/:id/test', async (req, res) => {
    const hook = store.get('webhooks', req.params.id);
    if (!hook) throw notFound('Webhook');
    try {
      const status = await deliver(hook, { type: 'test', at: new Date().toISOString(), data: { message: 'Hello from Agent Dashboard' } });
      res.json({ ok: status < 400, status });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ---- Live events (Server-Sent Events) -----------------------------------
  // EventSource can't send headers, so the API key may be passed as ?key=.
  api.get('/events', (req, res) => {
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.flushHeaders();
    res.write(`event: hello\ndata: ${JSON.stringify(meta())}\n\n`);
    const filterAgent = req.query.agentId;
    const unsubscribe = bus.subscribe((event) => {
      if (filterAgent && event.data?.agentId !== filterAgent) return;
      const data = event.type.startsWith('run.') && event.type !== 'run.log' ? runSummary(event.data) : event.data;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event, data })}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(ping); unsubscribe(); });
  });

  api.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  return api;
}
