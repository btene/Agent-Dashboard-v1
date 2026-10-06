// Minimal example of an agent the dashboard can run with the "HTTP endpoint"
// runner. Start it with `node examples/http-agent.js`, then add an agent in
// the dashboard with URL http://localhost:9000/run.
//
// Contract:
//   request  POST { input, runId, agent: { id, name } }
//   response { output, usage?: { tokensIn, tokensOut, costUsd } }
import http from 'node:http';

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/run') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const { input = '', agent } = JSON.parse(body || '{}');

  // ...do the real work of your agent here...
  const words = input.trim().split(/\s+/).filter(Boolean).length;
  const output = `Hi from ${agent?.name ?? 'an example agent'}! Your input had ${words} word(s).`;

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ output, usage: { tokensIn: words, tokensOut: output.split(' ').length, costUsd: 0 } }));
});

server.listen(9000, () => console.log('Example agent listening on http://localhost:9000/run'));
