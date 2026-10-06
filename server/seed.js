// First-launch demo data so the dashboard and analytics aren't empty.
// Disable with SEED_DEMO=false. Remove later from Connections → Danger zone,
// or by deleting the demo agents.
const DAY = 86_400_000;

const DEMO_AGENTS = [
  { name: 'Lead Researcher', description: 'Finds and enriches prospect information from public sources.', tags: ['sales'], config: { latencyMs: 4000, failureRate: 0.08, tokensPerRun: 5200 }, perDay: 9 },
  { name: 'Support Triage', description: 'Classifies incoming tickets and drafts first responses.', tags: ['support'], config: { latencyMs: 1500, failureRate: 0.04, tokensPerRun: 1800 }, perDay: 22 },
  { name: 'Weekly Report Writer', description: 'Compiles KPIs into a weekly narrative report.', tags: ['ops'], config: { latencyMs: 9000, failureRate: 0.15, tokensPerRun: 14000 }, perDay: 1.5 },
  { name: 'Invoice Extractor', description: 'Pulls line items and totals out of PDF invoices.', tags: ['finance'], config: { latencyMs: 2500, failureRate: 0.12, tokensPerRun: 3200 }, perDay: 12 },
];

export function seedDemo({ store, days = 100, now = Date.now() } = {}) {
  if (process.env.SEED_DEMO === 'false' || store.list('agents').length) return false;

  const created = new Date(now - days * DAY).toISOString();
  const agents = DEMO_AGENTS.map(({ perDay, ...a }) => ({
    id: store.newId('agt'),
    ...a,
    runner: 'mock',
    demo: true,
    createdAt: created,
    updatedAt: created,
    perDay,
  }));

  const runs = [];
  for (const a of agents) {
    for (let d = days; d >= 1; d--) {
      const weekday = new Date(now - d * DAY).getUTCDay();
      const load = weekday === 0 || weekday === 6 ? 0.35 : 1;
      const count = Math.round(a.perDay * load * (0.6 + Math.random() * 0.8));
      for (let i = 0; i < count; i++) {
        const createdAt = now - d * DAY + Math.random() * DAY;
        // Make reliability drift a bit over time so trends are visible.
        const drift = (d / days - 0.5) * 0.08;
        const failed = Math.random() < a.config.failureRate + drift;
        const durationMs = Math.round(a.config.latencyMs * (0.5 + Math.random() * (failed ? 1.8 : 1.1)));
        const tokens = failed ? Math.round(a.config.tokensPerRun * 0.3) : Math.round(a.config.tokensPerRun * (0.7 + Math.random() * 0.6));
        const tokensIn = Math.round(tokens * 0.7);
        const tokensOut = tokens - tokensIn;
        runs.push({
          id: store.newId('run'),
          agentId: a.id,
          agentName: a.name,
          status: failed ? 'failed' : 'succeeded',
          input: '(demo run)',
          output: failed ? null : 'Demo output',
          error: failed ? 'Simulated failure' : null,
          logs: [],
          trigger: 'demo',
          source: null,
          createdAt: new Date(createdAt).toISOString(),
          startedAt: new Date(createdAt).toISOString(),
          finishedAt: new Date(createdAt + durationMs).toISOString(),
          durationMs,
          tokensIn,
          tokensOut,
          costUsd: (tokensIn * 2 + tokensOut * 10) / 1e6,
        });
      }
    }
  }
  runs.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  for (const a of agents) delete a.perDay;
  store.insertMany('agents', agents);
  store.insertMany('runs', runs);
  return true;
}
