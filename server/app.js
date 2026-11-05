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

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ store = createStore(), seed = true, scheduler: schedulerOpts = {}, fetchImpl } = {}) {
  const bus = createBus();
  const runService = createRunService({ store, bus });
  if (seed) seedDemo({ store });
  attachWebhooks({ store, bus });

  // Construction-intelligence platform services.
  const settingsService = createSettingsService(store);
  const sourceService = createSourceService({ store, bus, settingsService, fetchImpl });
  sourceService.syncRegistry();
  const emailService = createEmailService({ store, bus, settingsService });
  const documentService = createDocumentService({ store, bus });
  const crmService = createCrmService({ store, bus });
  const replyService = createReplyService({ store, bus, settingsService, crmService });
  const researchService = createResearchService({ store, bus, settingsService, crmService, fetchImpl });
  const scheduler = createScheduler({ store, bus, settingsService, sourceService, emailService, crmService, replyService, researchService, autoStart: schedulerOpts.autoStart ?? process.env.NODE_ENV !== 'test', tickMs: schedulerOpts.tickMs });
  if (seed && process.env.SEED_DEMO !== 'false') seedDemoProjects({ store, settings: settingsService.get() });
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

  app.use('/api/v1', createApi({ store, bus, runService, intelApi }));

  // Serve the built frontend in production.
  const dist = path.resolve(here, '../dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return { app, store, bus, runService, settingsService, sourceService, emailService, documentService, crmService, scheduler, replyService, researchService };
}
