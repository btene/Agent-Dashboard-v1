// Calls any agent that is reachable over HTTP: your own service, an n8n /
// Zapier / Make webhook, a LangChain or CrewAI server, a serverless function…
//
// Request  : POST <url>  { input, runId, agent: { id, name } }
// Response : any JSON. If it contains `output`, that is shown as the run
//            output; `usage: { tokensIn, tokensOut, costUsd }` feeds analytics.
//            Plain-text responses are used verbatim.
export default {
  type: 'http',
  label: 'HTTP endpoint / webhook',
  description: 'POSTs the input to a URL you control (your agent service, n8n, Zapier, Make, a cloud function…).',
  configFields: [
    { key: 'url', label: 'Endpoint URL', type: 'text', required: true, placeholder: 'https://my-agent.example.com/run' },
    { key: 'method', label: 'HTTP method', type: 'select', options: ['POST', 'PUT', 'GET'], default: 'POST' },
    { key: 'headers', label: 'Headers (JSON)', type: 'json', default: '{}', placeholder: '{"Authorization": "Bearer …"}' },
    { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', default: 120000 },
  ],
  async run({ agent, input, runId, log, signal }) {
    const { url, method = 'POST', timeoutMs = 120000 } = agent.config || {};
    if (!url) throw new Error('No endpoint URL configured for this agent');
    let headers = agent.config?.headers || {};
    if (typeof headers === 'string') headers = headers.trim() ? JSON.parse(headers) : {};

    const timeout = AbortSignal.timeout(Number(timeoutMs) || 120000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    log('info', `${method} ${url}`);
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: method === 'GET' ? undefined : JSON.stringify({ input, runId, agent: { id: agent.id, name: agent.name } }),
      signal: combined,
    });
    const text = await res.text();
    log(res.ok ? 'info' : 'error', `Response ${res.status} (${text.length} bytes)`);
    if (!res.ok) throw new Error(`Endpoint returned ${res.status}: ${text.slice(0, 500)}`);

    let body;
    try { body = JSON.parse(text); } catch { return { output: text }; }
    const usage = body?.usage || {};
    return {
      output: body?.output !== undefined
        ? (typeof body.output === 'string' ? body.output : JSON.stringify(body.output, null, 2))
        : JSON.stringify(body, null, 2),
      tokensIn: Number(usage.tokensIn ?? usage.input_tokens) || 0,
      tokensOut: Number(usage.tokensOut ?? usage.output_tokens) || 0,
      costUsd: Number(usage.costUsd) || 0,
    };
  },
};
