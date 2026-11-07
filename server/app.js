import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createBus } from './events.js';
import { createRunService } from './runService.js';
import { createApi } from './api.js';
import { attachWebhooks } from './webhooks.js';
import { seedDemo } from './seed.js';
import { createSettingsService } from './intel/settings.js';
import { createSourceService } from './intel/sourceService.js';
import { createEmailService } from './intel/email.js';
import { createDocumentService } from './intel/documents.js';
import { createCrmService } from './intel/crm.js';
import { createScheduler } from './intel/scheduler.js';
import { createIntelApi } from './intel/api.js';
import { seedDemoProjects } from './intel/demo.js';
import { createReplyService } from './intel/replies.js';
import { createResearchService } from './intel/research.js';
import { setFileStore, MAX_UPLOAD_BYTES } from './intel/documents.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ store = createStore(), seed = true, scheduler: schedulerOpts = {}, fetchImpl, setupError = null } = {}) {
  const bus = createBus();
  const runService = createRunService({ store, bus });
  attachWebhooks({ store, bus });
  if (store.files) setFileStore(store.files);

  // Construction-intelligence platform services.
  const settingsService = createSettingsService(store);
  const sourceService = createSourceService({ store, bus, settingsService, fetchImpl });
  const emailService = createEmailService({ store, bus, settingsService });
  const documentService = createDocumentService({ store, bus });
  const crmService = createCrmService({ store, bus });
  const replyService = createReplyService({ store, bus, settingsService, crmService });
  const researchService = createResearchService({ store, bus, settingsService, crmService, fetchImpl });
  // On Vercel there is no always-on process: a daily Vercel Cron job calls /api/v1/cron/daily instead.
  const serverless = Boolean(process.env.VERCEL);
  const scheduler = createScheduler({ store, bus, settingsService, sourceService, emailService, crmService, replyService, researchService, autoStart: !serverless && (schedulerOpts.autoStart ?? process.env.NODE_ENV !== 'test'), tickMs: schedulerOpts.tickMs, cronMode: serverless });

  // First-run setup once stored data is loaded (immediately for file/memory stores).
  const init = () => {
    // The AI-agent demo history (thousands of simulated runs) is skipped on Vercel to keep the database small.
    if (seed && (!serverless || process.env.SEED_AGENT_DEMO === 'true')) seedDemo({ store });
    sourceService.syncRegistry();
    if (seed && process.env.SEED_DEMO !== 'false') seedDemoProjects({ store, settings: settingsService.get() });
  };
  // With a shared database, only the first instance ever started does first-run seeding.
  const initialized = store.mode !== 'postgres'
    ? (init(), Promise.resolve())
    : store.ready.then(() => store.claim('first-run-seed-v1')).then((first) => {
      if (first) init();
      else sourceService.syncRegistry();
      return store.flush();
    });
  const intelApi = createIntelApi({ store, bus, settingsService, sourceService, emailService, documentService, crmService, scheduler, replyService, researchService });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // CORS so other dashboards (on other origins) can call this API.
  const allowed = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && (allowed.includes('*') || allowed.includes(origin))) {
      res.set('access-control-allow-origin', allowed.includes('*') ? '*' : origin);
      res.set('vary', 'Origin');
      res.set('access-control-allow-headers', 'content-type, authorization, x-api-key, x-agent-dashboard-client');
      res.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // Control which sites may embed this dashboard in an iframe.
  if (process.env.FRAME_ANCESTORS) {
    app.use((req, res, next) => {
      res.set('content-security-policy', `frame-ancestors ${process.env.FRAME_ANCESTORS}`);
      next();
    });
  }

  // Vercel / Postgres: wait for data, pick up changes from other instances, and save before replying.
  app.use('/api', async (req, res, next) => {
    if (setupError && !/^\/v1\/(health|meta)$/.test(req.path)) return res.status(503).json({ error: setupError, setupRequired: true });
    if (store.mode !== 'postgres') return next();
    try {
      await initialized;
      await store.sync();
    } catch (err) {
      console.error('[app] database unavailable:', err.message);
      return res.status(503).json({ error: `Database unavailable: ${err.message}` });
    }
    if (req.path === '/v1/events') return next();
    const end = res.end.bind(res);
    res.end = (...args) => {
      store.flush().catch((err) => console.error('[app] save failed:', err.message)).finally(() => end(...args));
      return res;
    };
    next();
  });

  // Vercel Cron: one daily run of every automation that is due. Protected by CRON_SECRET.
  app.get('/api/v1/cron/daily', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
    const started = Date.now();
    const results = await scheduler.runDue({ budgetMs: 270_000 });
    res.json({ ok: true, ranMs: Date.now() - started, results });
  });

  app.locals.platform = { serverless, storage: store.mode, maxUploadBytes: MAX_UPLOAD_BYTES, setupError };
  app.use('/api/v1', createApi({ store, bus, runService, intelApi, platform: app.locals.platform }));

  // Serve the built frontend in production.
  const dist = path.resolve(here, '../dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return { app, initialized, store, bus, runService, settingsService, sourceService, emailService, documentService, crmService, scheduler, replyService, researchService };
}
