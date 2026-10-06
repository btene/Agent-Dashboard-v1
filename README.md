# Agent Dashboard

One place for all of your AI agents: **see them, run them, and measure how they perform**. It's built as a hub, so other dashboards you build can plug into it and it can plug into them.

| Page | What it does |
|---|---|
| **Agents** | Card grid of every agent with live status, 7-day runs, success rate, and average time. Run any agent with one click. |
| **Agent detail** | Run box, 30-day KPIs, a daily chart, recent runs, configuration, and a ready-to-copy `curl` command. |
| **Run detail** | Input, output or error, logs that stream live, tokens, cost, and buttons to cancel or re-run. |
| **Run history** | Every run across all agents, with filters. Updates live. |
| **Analytics** | KPIs compared with the previous period. Runs per day (succeeded/failed), runs per agent over time, success rate, average and p95 duration, runs and cost by agent, and a leaderboard. Each chart has a table view. |
| **Connections** | Linked dashboards (shown in the sidebar), outgoing webhooks, and API and embed snippets. |

## Quick start

```bash
npm install
npm run dev          # API on :8787, UI on http://localhost:5173
```

On first launch it adds four **simulated demo agents** and about 100 days of history so the analytics have data to show. You can remove them under *Connections → Demo data* (or set `SEED_DEMO=false` before first launch).

Production:

```bash
npm run build && npm start   # serves UI + API on http://localhost:8787
```

Copy `.env.example` to `.env` to see every setting. Load it with `node --env-file=.env server/index.js` or with your process manager.

## Adding your agents

Click **＋ Add agent** and choose how the agent runs:

| Runner | Use it for | Setup |
|---|---|---|
| **HTTP endpoint / webhook** | Agents running somewhere else: your own service, n8n, Zapier, Make, LangChain/CrewAI servers, cloud functions | The dashboard sends `POST {input, runId, agent}` to your URL. Respond with `{ "output": "...", "usage": { "tokensIn", "tokensOut", "costUsd" } }` (usage is optional; plain text works too). See `examples/http-agent.js`. |
| **Claude (Anthropic API)** | Prompt-based agents | Set `ANTHROPIC_API_KEY`. Choose a model, write the instructions, and pick an effort level. Tokens and cost are recorded automatically. |
| **Local command / script** | Python or shell agents on the same machine | Set `ALLOW_COMMAND_RUNNER=true`. Input arrives on stdin and in `$AGENT_INPUT`; stdout becomes the output. An optional last line `##usage {...}` feeds analytics. See `examples/command-agent.py`. |
| **Simulated** | Demos and testing the UI | — |

To add a new runner type, create a module in `server/runners/` and register it in `server/runners/index.js`. The form in the UI is generated from the runner's `configFields`.

## Connecting other dashboards

The hub connects in both directions:

**Bring other dashboards into this one.** Under *Connections → Linked dashboards*, add any URL. It shows up in the sidebar and opens either inside this dashboard (iframe) or in a new tab. A health check reports whether it's online and whether it is "Compatible" (meaning it exposes the same `/api/v1/manifest`).

**Let other dashboards use this one:**

- **Manifest:** `GET /api/v1/manifest` describes the pages, endpoints, and events in a machine-readable form, so dashboards built from this template can discover each other.
- **REST API:** everything the UI does goes through `/api/v1`:
  - `GET /agents`, `POST /agents`, `PATCH|DELETE /agents/:id`
  - `POST /agents/:id/runs` with `{ input, wait?: true }` starts a run. With `wait: true`, it returns the finished run.
  - `GET /runs?agentId=&status=&limit=&offset=`, `GET /runs/:id`, `POST /runs/:id/cancel`
  - `GET /analytics?days=30&agentId=` returns the same numbers as the Analytics page
  - `GET|POST|PATCH|DELETE /dashboards`, `/webhooks`
- **Live events:** `GET /api/v1/events` is a Server-Sent Events stream with `run.created`, `run.started`, `run.log`, `run.succeeded`, `run.failed`, `run.cancelled`, and `agent.*` events.
- **Webhooks:** POSTs run and agent events to any URL. If you set a secret, it signs them with HMAC-SHA256 in the `X-Agent-Dashboard-Signature: sha256=…` header.
- **Embedding:** add `?embed=1` to any page (for example `/analytics?embed=1`) to hide the navigation. While embedded, the page sends `postMessage` events to its parent (`{source: 'agent-dashboard', type, data}`). It also accepts `{target: 'agent-dashboard', type: 'navigate', path}`.

## Security

- Set `DASHBOARD_API_KEY` before you expose the dashboard beyond localhost. The API then requires `Authorization: Bearer <key>` (or `x-api-key`, or `?key=` for SSE). The UI asks for the key once and keeps it in the browser.
- Agent configs, including HTTP headers you enter, are stored in `data/db.json` and returned by the API to anyone who holds the key.
- The command runner executes shell commands, so it stays off unless you enable it.
- Use `CORS_ORIGINS` to restrict which sites can call the API from a browser, and `FRAME_ANCESTORS` to restrict which sites can embed it.

## Project layout

```
server/
  index.js         entry point
  app.js           Express app: CORS, static UI, API mount
  api.js           REST API v1 + SSE
  runService.js    run lifecycle (queued → running → succeeded/failed/cancelled)
  analytics.js     aggregation for the Analytics page
  webhooks.js      outbound, signed webhooks
  store.js         JSON-file persistence (swap for a real DB here)
  seed.js          demo data
  runners/         mock, http, claude, command
client/src/
  pages/           Agents, AgentDetail, Runs, RunDetail, Analytics, Connections, LinkedDashboard
  components/      layout, charts, forms, UI primitives
  lib/             API client, live-event hooks, theme, embed bridge
test/              node:test suites (npm test)
examples/          sample HTTP and command agents
```

Storage is a single JSON file, which works well for a personal or small-team hub. If you grow past roughly 20k runs, or need several server instances, replace `server/store.js` with Postgres or SQLite. Nothing else depends on how runs are stored.
