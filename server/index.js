import { createApp } from './app.js';

const port = Number(process.env.PORT || 8787);
const { app, store } = createApp();

const server = app.listen(port, () => {
  console.log(`Agent Dashboard API listening on http://localhost:${port}`);
  if (process.env.DASHBOARD_API_KEY) console.log('API key auth is ON');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    store.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
