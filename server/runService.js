// Owns the lifecycle of a run: queued → running → succeeded | failed | cancelled.
import { runners } from './runners/index.js';

const MAX_LOG_LINES = 500;
const MAX_OUTPUT_CHARS = 200_000;

export function createRunService({ store, bus }) {
  const active = new Map(); // runId -> AbortController
  const waiters = new Map(); // runId -> [resolve]

  function finish(run, patch) {
    const finishedAt = new Date();
    store.update('runs', run.id, {
      ...patch,
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt - new Date(run.startedAt),
    });
    active.delete(run.id);
    bus.publish(`run.${run.status}`, run);
    bus.publish('run.updated', run);
    for (const resolve of waiters.get(run.id) || []) resolve(run);
    waiters.delete(run.id);
  }

  async function execute(run, agent) {
    const runner = runners[agent.runner];
    const controller = new AbortController();
    active.set(run.id, controller);

    const log = (level, msg) => {
      const entry = { t: new Date().toISOString(), level, msg: String(msg) };
      if (run.logs.length < MAX_LOG_LINES) run.logs.push(entry);
      bus.publish('run.log', { runId: run.id, agentId: run.agentId, entry });
    };

    store.update('runs', run.id, { status: 'running', startedAt: new Date().toISOString() });
    bus.publish('run.started', run);
    bus.publish('run.updated', run);

    try {
      if (!runner) throw new Error(`Unknown runner type "${agent.runner}"`);
      const result = await runner.run({ agent, input: run.input, runId: run.id, log, signal: controller.signal });
      if (controller.signal.aborted) return; // cancel() already finished it
      const output = String(result?.output ?? '');
      finish(run, {
        status: 'succeeded',
        output: output.length > MAX_OUTPUT_CHARS ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)` : output,
        tokensIn: result?.tokensIn || 0,
        tokensOut: result?.tokensOut || 0,
        costUsd: result?.costUsd || 0,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      log('error', err?.message || String(err));
      finish(run, { status: 'failed', error: err?.message || String(err) });
    }
  }

  return {
    /** Create and start a run. Returns immediately with the queued run. */
    start(agent, { input = '', trigger = 'dashboard', source = null } = {}) {
      const run = store.insert('runs', {
        id: store.newId('run'),
        agentId: agent.id,
        agentName: agent.name,
        status: 'queued',
        input: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
        output: null,
        error: null,
        logs: [],
        trigger,
        source,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
        durationMs: null,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      });
      bus.publish('run.created', run);
      queueMicrotask(() => execute(run, agent));
      return run;
    },

    /** Resolves when the run reaches a terminal state (or the timeout elapses). */
    waitFor(runId, timeoutMs = 300_000) {
      const run = store.get('runs', runId);
      if (!run || !['queued', 'running'].includes(run.status)) return Promise.resolve(run);
      return new Promise((resolve) => {
        const list = waiters.get(runId) || [];
        list.push(resolve);
        waiters.set(runId, list);
        setTimeout(() => resolve(store.get('runs', runId)), timeoutMs).unref?.();
      });
    },

    cancel(runId) {
      const run = store.get('runs', runId);
      const controller = active.get(runId);
      if (!run || !controller) return null;
      controller.abort();
      run.logs.push({ t: new Date().toISOString(), level: 'warn', msg: 'Run cancelled by user' });
      finish(run, { status: 'cancelled', error: 'Cancelled' });
      return run;
    },

    isActive: (runId) => active.has(runId),
  };
}
