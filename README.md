# Advanced Landscape 2000 — Construction Intelligence Platform

A commercial construction intelligence, lead-generation, outreach-automation and CRM platform for a landscaping contractor, built so a non-technical business owner can run it alone. It sits on top of the original **Agent Dashboard** hub (kept intact under *Advanced: AI agents* in the sidebar; its documentation is further down this file).

## What it does

| Page | Purpose |
|---|---|
| **Home** | Business dashboard: new verified projects, high-priority opportunities, projects needing verification, decision-makers, emails awaiting approval / sent / replied, bids, awards, pipeline value. Every tile opens the underlying records. Map of opportunities in the territory. |
| **Guided setup** | Eight-step onboarding wizard shown on first launch (company & territory, documents, email account, sources, preferences & scoring, outreach tone, review first projects, approve first campaign). Optional steps can be skipped. |
| **Projects** | Discovery list with filters, CSV export, and a project page with **VIEW ORIGINAL SOURCE**, **VERIFY PROJECT**, field-level provenance, score explanation, change history, contacts, outreach and pipeline stage. |
| **Automation Control Center** | ON/OFF switch, schedule, status, last run, last error and next run for each of the ten automations; Manual / Semi-automatic / Automatic modes; **Pause all automations**. Defaults to Semi-automatic with email sending **off**. |
| **Integrations** | Source registry: coverage, access method, licence, publisher refresh rate, last retrieval, errors, diagnostics, polling interval (only intervals the publisher supports), CSV/Excel import wizard. |
| **Setup guide & diagnostics** | Admin page explaining how to connect each data source and where credentials come from, plus a live health summary. |
| **Outreach** | Draft queue with three styles (short & direct, relationship-focused, bid response), edit / approve / reject / send, attachment of approved documents only. |
| **CRM** | Pipeline board, contacts (with where each one came from), companies, follow-up reminders, exports. |
| **Documents** | Encrypted document library with text extraction, human review, expiration warnings, outreach approval and role-based access. |
| **Settings** | Company, territory, scoring, outreach, SMTP email account, live/demo environment switch. |

## Decision-maker research (company & contact intelligence)

Every project and company page has **Find decision-makers**. It starts from the companies the
record names (developer/applicant, general contractor, owner, construction manager, property
manager), uses the title priorities for the opportunity type (landscape construction vs recurring
maintenance), and:

* queries the contact-data providers you have enabled under *Settings → Contact research
  providers* (Apollo.io, Hunter.io, People Data Labs; ZoomInfo is configuration-only because its API
  is enterprise-licensed);
* scores each candidate out of 100 (responsibility relevance 35, project connection 30, authority
  20, verified contact availability 15) with a written reason and the source for every component;
* gives one-click LinkedIn and Google search links for manual research (no scraping, no automated
  messaging, no login automation);
* checks the CRM for existing relationships and flags *Existing relationship / Already contacted /
  Known in CRM* so cold outreach is not sent to people you already know;
* saves verified candidates to the CRM with LinkedIn URL, verified business email, phone, original
  sources, last verification date, contact score and project links, deduplicated by email and
  name+company.

Replies are tracked by reading the connected mailbox over IMAP (`Reply tracking` automation) and
matched to sent emails by Message-ID, so replies update the email, project stage, contact and
reminders automatically.

Deployment instructions for a permanent URL are in `docs/DEPLOYMENT.md`; service costs and
credentials in `docs/COSTS.md`; ten real leads with sources in `docs/SAMPLE_LEADS.md`; the
end-to-end research process on three real projects in `docs/RESEARCH_DEMO.md`.

## No fabricated projects

* Projects enter the system only from a connector (official API) or a permitted file import. Fields the source did not publish are stored as `null` and shown as **“Not yet verified”**.
* Every source field carries a provenance label: *Verified government record*, *Verified third-party information*, *Estimated (automated classification)*, *Unverified — needs research*, or *Entered by your team*. Classification (project type, landscape likelihood) is always labelled an estimate.
* **VERIFY PROJECT** re-fetches the record by permit number, shows previous vs newly retrieved values, the publisher's timestamp and the retrieval timestamp, and appends to the change history. If the source cannot be reached the project shows **“Source unavailable — verification pending”** and keeps its last good values; nothing is substituted.
* Email drafts interpolate only facts whose provenance is verified; missing facts are listed, not invented. Drafts that assert a relationship, referral, invitation or past conversation are rejected by a wording check.
* The **demo environment** holds clearly labelled fictional projects (`DEMO-…`). They are blocked from the outreach queue, the pipeline and all dashboard counts, and can be removed with one click.

## Data sources (as of November 2026)

**Live integrations — retrieved automatically and verifiable record by record**

| Source | Access | Notes |
|---|---|---|
| City of Los Angeles — Building Permits 2020–present (LADBS, `data.lacity.org` `pi9x-tg5x`) | Socrata API, no key (optional free app token) | Weekly publisher refresh. No applicant/owner/contractor names. |
| County of Riverside — PLUS land-use & permit cases (`gis.countyofriverside.us` OpenData/General layer 280) | ArcGIS REST, no key | Unincorporated county. Includes **Landscape Permit (LSP)** cases, which count as a government-documented landscape scope, plus commercial building, grading, plot plan, CUP and tract cases. Parcel (APN), no street address or valuation. |
| City of Santa Monica — Active Building & Safety Permits (`data.santamonica.gov`) | CKAN datastore API, no key | Daily. Active permits only. |
| County of Ventura — Weekly Report of Permits Issued (`rmadocs.venturacounty.gov`) | Official weekly PDF, parsed per entry | Unincorporated county, issued permits only, mostly residential. |
| City of Santa Barbara — Building_Permits (`gisportal.santabarbaraca.gov`) | ArcGIS REST, no key | **Stale:** newest permit 4 Sep 2025. The platform flags this automatically after every run. |

**Manual imports** — LA County (EPIC-LA), Santa Barbara County, San Bernardino city & county, City of Riverside, Ventura County portal, Orange County (portals without an API), plus ConstructConnect and Dodge licensed exports. See *Integrations → Manual imports*.

Each source's newest record date is checked on every run; a source that stops adding records is flagged as stale instead of being presented as current.

## Quick start

**Production (Vercel + Supabase):** follow `docs/DEPLOYMENT.md`. Vercel serves the built website from `dist/`, runs
`api/index.js` as the server function, and calls `/api/v1/cron/daily` once a day (`vercel.json`). All data and
encrypted documents are stored in Supabase Postgres (`POSTGRES_URL`, added automatically by the Vercel ↔ Supabase
integration) in a private `als` schema with row-level security enabled.

**Local development:**

```bash
npm install
npm run dev          # API on :8787, UI on http://localhost:5173 (data in ./data/db.json)
```

On first launch the UI opens the guided setup. Under *Integrations*, press **Retrieve now** on the live sources to pull real
permits. If your machine reaches the internet through an HTTPS proxy, start the server with `NODE_USE_ENV_PROXY=1`.
To develop against Postgres locally, set `POSTGRES_URL` before `npm run dev`.

Outgoing email uses your own mailbox over SMTP (`Settings → Email account`, e.g. Google Workspace app password). Nothing
is sent until an email is approved, and automated sending stays off until you switch it on in the Control Center.

### Security

* Set `DASHBOARD_API_KEY` (owner) before exposing the site; optional `DASHBOARD_STAFF_KEY` / `DASHBOARD_VIEWER_KEY` give narrower roles. Document access is restricted by role (W-9s, registrations and qualification packages are owner-only).
* Uploaded documents are encrypted at rest with AES-256-GCM (`DOCUMENT_ENCRYPTION_KEY`, or an auto-generated key in the data folder).
* Storage: Supabase Postgres in production (`server/persistence/postgres.js`), a JSON file in `DATA_DIR` for local development. On Vercel the platform refuses to start without a database, `DASHBOARD_API_KEY` and `DOCUMENT_ENCRYPTION_KEY`, and shows what is missing.

### Tests

```bash
npm test
```

`test/intel.test.js` covers the ingestion pipeline (against a local fake Socrata server), provenance, scoring, verification and change history, source outages, demo isolation, email drafting rules and the approval workflow, scheduler modes, CSV import, encrypted documents and expiry warnings, roles, onboarding and dashboard metrics.

### Project layout (platform)

```
server/intel/
  sources.js          source registry definitions (URL, coverage, licence, refresh, how to connect)
  sourceService.js    run connectors, upsert projects, change history, verification, imports, diagnostics
  connectors/         socrata.js (generic), laCity.js (row mapping), csvImport.js (CSV/Excel)
  projects.js         canonical project shape, provenance, diffing, "Not yet verified" presentation
  classify.js         rule-based project-type / landscape-signal estimates (labelled as estimates)
  scoring.js          100-point lead score with written reasons
  settings.js         company, territory, automations, modes, onboarding defaults
  scheduler.js        background jobs for the ten automations
  email.js            three outreach styles, fact-only rendering, approval workflow, SMTP sending
  documents.js        encrypted library, text extraction, expiry status, roles
  crm.js              companies, contacts, activities, reminders, CSV export
  demo.js             fictional demo environment
  dashboard.js        owner metrics and map data
  api.js              REST routes (mounted under /api/v1)
client/src/pages/     Home, Onboarding, Projects, ProjectDetail, Automations, Integrations, Admin, Outreach, Crm, Documents, Settings
```

---

# Agent Dashboard (original hub)

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
