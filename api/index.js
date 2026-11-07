// Vercel entry point. Every /api/* request is routed here (see vercel.json).
// Data lives in Supabase Postgres (POSTGRES_URL is added automatically when
// Supabase is connected under Vercel → Storage). The website itself is served
// from the built `dist/` folder by Vercel's CDN.
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { createPostgresAdapter, poolFromEnv } from '../server/persistence/postgres.js';

const pool = await poolFromEnv();
let setupError = null;
if (!pool) setupError = 'No database connected. In Vercel open this project → Storage → Create Database → Supabase, connect it to this project, then redeploy.';
else if (!process.env.DASHBOARD_API_KEY) setupError = 'DASHBOARD_API_KEY is not set. Add it in Vercel → Project → Settings → Environment Variables, then redeploy. Without it anyone with the link could open the platform.';
else if (!process.env.DOCUMENT_ENCRYPTION_KEY) setupError = 'DOCUMENT_ENCRYPTION_KEY is not set. Add a long random phrase in Vercel → Project → Settings → Environment Variables (keep a copy), then redeploy.';

const store = pool ? createStore({ adapter: createPostgresAdapter(pool) }) : createStore({ persist: false });
const { app } = createApp({ store, seed: true, setupError });

export default app;
