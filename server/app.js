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

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ store = createStore(), seed = true } = {}) {
  const bus = createBus();
  const runService = createRunService({ store, bus });
  if (seed) seedDemo({ store });
  attachWebhooks({ store, bus });

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

  app.use('/api/v1', createApi({ store, bus, runService }));

  // Serve the built frontend in production.
  const dist = path.resolve(here, '../dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return { app, store, bus, runService };
}
