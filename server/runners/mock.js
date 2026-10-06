// Simulated agent — useful for demos and for wiring up the UI before a real
// agent exists. Config: { latencyMs, failureRate, tokensPerRun }
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('Run cancelled'));
    }, { once: true });
  });

export default {
  type: 'mock',
  label: 'Simulated (demo)',
  description: 'Fake agent that sleeps, logs a few steps and returns canned output. Great for testing.',
  configFields: [
    { key: 'latencyMs', label: 'Average latency (ms)', type: 'number', default: 2500 },
    { key: 'failureRate', label: 'Failure rate (0–1)', type: 'number', default: 0.1 },
    { key: 'tokensPerRun', label: 'Tokens per run', type: 'number', default: 1200 },
  ],
  async run({ agent, input, log, signal }) {
    const { latencyMs = 2500, failureRate = 0.1, tokensPerRun = 1200 } = agent.config || {};
    const total = Math.max(200, latencyMs * (0.5 + Math.random()));
    const steps = ['Planning', 'Gathering context', 'Working', 'Reviewing result'];
    for (const step of steps) {
      log('info', `${step}…`);
      await sleep(total / steps.length, signal);
    }
    if (Math.random() < failureRate) throw new Error('Simulated failure (mock runner)');
    const tokensIn = Math.round(tokensPerRun * 0.7);
    const tokensOut = Math.round(tokensPerRun * 0.3);
    return {
      output: `✅ ${agent.name} finished.\n\nInput received:\n${input || '(empty)'}`,
      tokensIn,
      tokensOut,
      costUsd: (tokensIn * 2 + tokensOut * 10) / 1e6,
    };
  },
};
