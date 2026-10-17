# WRA Operations Platform: Current-State Audit and ADR-0001

| | |
|---|---|
| Status | **Proposed**: needs owner decisions (see §5) |
| Date | 2026-10-17 |
| Operating state | **PAUSED. Do not run live outreach or claim operations.** |
| Scope | Discovery of `btene/Agent-Dashboard-v1` and the public site `wealthrecoveryalliance.com`; proposed platform architecture |

> Legal and compliance statements here are engineering assumptions, not legal advice. Every rule that touches fees, agreements, outreach, or privacy is marked **counsel review required** until authorized staff records approval of the specific version.

---

## 1. Current-state audit

### 1.1 Repository

| Item | Finding |
|---|---|
| Contents | A generic "Agent Dashboard": a hub to register agents, run them, stream run logs, chart run analytics, and link to other dashboards. It has no WRA branding, no marketing site, no unclaimed-property domain logic. |
| History | One commit (`dcfa854`). Branches: `claude/agent-dashboard-analytics-b7ni40` (same commit) and `claude/confident-faraday-ue938j` (this work). |
| Language / runtime | JavaScript (ESM), Node ≥ 20 (container has 22.22). **No TypeScript.** |
| Package manager | npm (`package-lock.json`). |
| Server | Express 5 (`server/`), about 1,000 lines. REST `/api/v1`, Server-Sent Events, outbound webhooks. |
| Client | React 19 + Vite 8 + React Router 7 + Recharts (`client/`), about 1,500 lines. Single-page app. |
| Persistence | `server/store.js` writes a single JSON file (`data/db.json`) in memory with debounced writes. No database, no migrations, no transactions, no concurrency control. |
| Authentication | Optional shared API key (`DASHBOARD_API_KEY`). **Off by default.** No users, roles, MFA, or sessions. |
| Agent runners | `mock`, `http` (POST to any URL), `claude` (Anthropic API), and `command` (shell exec, off unless `ALLOW_COMMAND_RUNNER=true`). |
| Tests | `node --test`. 8 tests (API smoke + analytics). **All 8 pass.** |
| CI / deploy | No `.github/` workflows, no Dockerfile, no IaC, no deploy docs. |
| Repo instructions | No `AGENTS.md`, `CLAUDE.md`, or `CONTRIBUTING.md`. |
| Secrets | None committed. `.env` is git-ignored and `.env.example` holds placeholders only. |

**Security findings in the existing code.** None of these are exploitable today, because nothing is deployed. All of them rule the code out as-is for a platform that holds claimant PII:

1. **Unauthenticated by default.** With no `DASHBOARD_API_KEY`, every endpoint is open, including create-agent and run-agent.
2. **One shared secret, no identity.** A shared key can't support roles, separation of duties, or attributable audit history.
3. **Key in query string** (`?key=` for SSE). Query strings end up in proxy and access logs.
4. **Key in `localStorage`.** Any XSS can read it.
5. **CORS defaults to `*`.**
6. **SSRF surfaces.** Three features let a key holder make the server fetch an arbitrary URL, internal and metadata addresses included: the `http` runner, the linked-dashboard health check, and outbound webhooks.
7. **Plaintext credentials.** HTTP runner headers (for example, bearer tokens) are stored in `db.json` and returned by `GET /agents`.
8. **Remote command execution.** The `command` runner runs shell commands on the host. It is off by default.
9. **Unrestricted embedding.** `postMessage(…, '*')` broadcasts to any parent, and arbitrary third-party URLs can be iframed.
10. **Spoofable client IP.** `trust proxy: true` means any client can fake its IP, which defeats IP-based rate limiting.
11. **Missing controls.** There is no CSP (only an optional `frame-ancestors`), HSTS, rate limiting, CSRF model, audit log, data retention, or log redaction.

**Reusable ideas** (concepts, not code):

- The run lifecycle (queued → running → terminal) with cancel and re-run.
- Live log streaming.
- Cost and token accounting per run.
- The analytics aggregation and chart/table-toggle UI.
- Per-runner `configFields`.

These map onto the Agent Control Center (module J) and the analytics pages (module K).

### 1.2 Public website (`wealthrecoveryalliance.com`)

| Item | Finding |
|---|---|
| In this repo? | **No.** No WordPress theme, static export, `wp-content`, or page source. |
| Reachable from this environment? | **No.** The container's egress proxy refused the connection (HTTP 403). The independent fetch service returned **`ENOTFOUND` for both `wealthrecoveryalliance.com` and `www.wealthrecoveryalliance.com`**, meaning DNS did not resolve. A web search turned up no indexed pages for "Wealth Recovery Alliance". |
| Interpretation | The domain or DNS may currently be down or expired. That fits Phase 0, "restore domain/email". **Verify at the registrar before any other website work.** |
| Stack | Not verifiable from here. The brief's WordPress / WP Engine history (`*.setupwp.io`, `*.wpenginepowered.com`) is plausible but unconfirmed. |
| Defects listed in the brief | Not reproducible from here: the header `mailto:` typo (`wealthrecoveralliance`), staging-host links, `$0 B` counters, the static copyright, and the marketing claims. They are recorded as **expected findings** to confirm once the source is available. |

**Consequence:** This repository cannot host or fix the marketing site until one of these exists:

- (a) the WordPress source or export plus WP Engine access, or
- (b) a decision to rebuild the public pages in the new app.

### 1.3 Official data sources (from the brief; not fetched)

No state files were downloaded, by design. The source registry will hold these as configuration:

- The SCO download page.
- The five ZIP bands.
- The estates workbook.

Each source carries its cadence (weekly Thursday; first business day of April and October), stored as editable config, not as legal truth. Only `04_From_500_To_Beyond.zip` is designated as the initial target. All ingestion runs against synthetic fixtures until a launch gate authorizes retrieval.

---

## 2. Decision summary (ADR-0001)

**Decision.** Do not grow the existing Express/JSON-file dashboard into the regulated platform. Build a new **TypeScript monorepo** in this repository:

- Two isolated web apps: staff ops and claimant portal.
- One durable background worker.
- Shared packages for the data model, policy, and integrations.

Keep the current dashboard under `legacy/agent-dashboard/` until it is retired. Keep the public marketing site a separate system, and touch it only for approved corrections and the Staff Login / Client Portal links.

**Why:**

- The existing code has no identity, database, or audit layer. Retrofitting them is more work and more risk than starting from the right primitives.
- Its runners are open-ended by design (arbitrary URLs, shell commands, free-form prompts). The brief requires the opposite: narrowly scoped agents with versioned instructions.
- A WordPress site is the wrong place for PII, authorization, or audit. Sensitive interfaces must not be public WordPress pages.

**Reversibility.** This is high. The monorepo layout and package boundaries are conventional, and every vendor sits behind an adapter interface.

---

## 3. Target architecture

```
                         ┌──────────────────────────────────────────┐
  Public internet        │  wealthrecoveryalliance.com (WordPress or │
  ──────────────────────▶│  rebuilt static site; no PII, no auth)    │
                         │  /login  ─▶ 302 app.…/login               │
                         │  /portal ─▶ 302 portal.…/                 │
                         └──────────────────────────────────────────┘
          │ staff (OIDC + MFA)                    │ claimants (invite + step-up)
          ▼                                       ▼
 ┌─────────────────────────┐            ┌─────────────────────────┐
 │ apps/ops (Next.js)      │            │ apps/portal (Next.js)   │
 │ app.wealthrecovery…     │            │ portal.wealthrecovery…  │
 │ staff-only cookies/CSP  │            │ claimant-only cookies   │
 └───────────┬─────────────┘            └───────────┬─────────────┘
             │ server actions / route handlers      │ (narrow API; own DB role)
             ▼                                      ▼
 ┌────────────────────────────────────────────────────────────────┐
 │ packages/policy: permissions matrix, operating-mode gate,      │
 │ fee rules, state machines, suppression, launch gates (pure TS) │
 ├────────────────────────────────────────────────────────────────┤
 │ packages/db: Drizzle schema + SQL migrations, RLS, audit table │
 ├────────────────────────────────────────────────────────────────┤
 │ packages/integrations: OutboundEffectGateway + adapters        │
 │ (email, e-sign, CRM, storage, malware scan, enrichment, IdP)   │
 └───────────┬───────────────────────────────┬────────────────────┘
             ▼                               ▼
   PostgreSQL (managed)           Private object storage (S3-compatible)
   jobs table (pg-boss)           raw/ (Object Lock), uploads/quarantine/,
             ▲                    uploads/clean/, exports/ (short TTL)
             │
 ┌───────────┴─────────────┐
 │ apps/worker (Node, long │  Source Monitor, Data Steward, Scorer,
 │ running, not serverless)│  Research, Compliance Gate, Outreach,
 │                         │  Intake/Agreement, Claims Ops agents
 └─────────────────────────┘
```

### 3.1 Repository layout

```
apps/ops          Staff dashboard (Next.js App Router, TypeScript)
apps/portal       Claimant portal (Next.js, separate deploy, separate auth client)
apps/worker       Durable job runner and agents (Node + pg-boss)
packages/db       Drizzle schema, SQL migrations, seed (synthetic only)
packages/policy   Permissions, operating mode, fee rules, state machines, validators
packages/ingest   CA SCO adapters: safe fetch, safe unzip, CSV/XLSX parsers, diffing
packages/integrations  Adapter interfaces + fake/recording implementations
packages/ui       Shared components and WRA design tokens
legacy/agent-dashboard  Current code, frozen until retired
docs/             Architecture, controls, runbooks (see implementation plan)
```

npm workspaces matches the existing package manager. Turborepo is optional later.

### 3.2 Component choices

| Concern | Default (reversible) | Notes / alternatives |
|---|---|---|
| Web framework | Next.js (App Router) + TypeScript strict | Server components keep sensitive data off the client by default. All mutations go through server actions or route handlers that call `packages/policy`. |
| UI | Radix primitives + Tailwind, WRA tokens (navy / teal / white / restrained gold) | Accessible primitives toward WCAG 2.1 AA. The mode banner uses text and an icon, not color alone. |
| Database | PostgreSQL 16, managed | AWS RDS or Supabase (**decision D1**). Local: Docker Postgres. |
| ORM / migrations | **Drizzle** + plain SQL migrations | Picked over Prisma because we need first-class raw SQL for row-level security, append-only triggers, and grants. Migrations are forward-only, with documented recovery. |
| Staff auth | **OIDC** with a managed IdP, MFA enforced at the IdP and re-checked through the `amr`/`acr` claim | Candidates: Google Workspace or Microsoft Entra (if company email is restored there), Auth0, or WorkOS (**decision D2**). We implement no auth cryptography; sessions use a maintained library (Auth.js or the IdP SDK). |
| Claimant auth | Separate IdP application/tenant: single-use invite, then email verification, then **step-up** (TOTP or SMS OTP via the IdP) for uploads, signing, and viewing property details | No shared cookies or roles with staff. Runs on a separate subdomain. |
| Authorization | Central `can(actor, action, resource)` in `packages/policy` + Postgres RLS as defense in depth | Deny by default. No inline `isAdmin` checks. |
| Jobs / agents | **pg-boss** on the same Postgres | Durable, with retries, idempotency keys (`singletonKey`), dead-letter queues, and scheduling. No extra vendor sees PII. A Trigger.dev adapter is possible later. |
| Object storage | S3 (SSE-KMS, Block Public Access, Object Lock for `raw/`) or Supabase Storage | Uploads go direct to `quarantine/` with short-lived presigned URLs. Files are promoted to `clean/` only after the scan passes. Local: MinIO. |
| Malware scanning | GuardDuty Malware Protection for S3 (AWS) or ClamAV sidecar | Local and test: ClamAV + EICAR fixture. |
| Email | **Postmark**: separate *transactional* and *broadcast* message streams, separate sending subdomains | It matches the stream-isolation requirement natively. The adapter makes SendGrid possible. |
| E-signature | Adapter. Dropbox Sign or DocuSign chosen at Phase 2 | The wet-signature and notarization path is always available. |
| CRM | HubSpot adapter, **disabled** | The app database is the source of truth. HubSpot gets a minimal field set with no raw documents or full identifiers. Field-ownership table in `docs/integrations.md`. |
| Monitoring | Sentry (`beforeSend` scrubbing; no request bodies) + structured JSON logs through a redacting logger | Log fields are allow-listed, not deny-listed. |
| Secrets | AWS Secrets Manager / platform secret store; `.env` for local only | Rotation is documented in the runbook. |
| Hosting | **Recommended: AWS.** ECS Fargate (ops, portal, worker), RDS, S3, KMS, Secrets Manager, WAF, CloudFront | The `00_All_Records` archive is large, so ingestion needs long-running compute, not serverless timeouts. Lighter alternative: Vercel (ops/portal) + Supabase + Render or Fly worker (**decision D1**). |

### 3.3 Operating mode and the outbound-effect gateway (core safety control)

- **Storage.** `operating_mode` is a single DB row plus an append-only `operating_mode_change` history. New environments start at `PAUSED`. Production refuses to boot into anything but the stored mode.
- **One choke point.** Every external side effect is a typed `Effect` routed through `OutboundEffectGateway.execute(effect)`. Effect kinds:
  - `email.send`
  - `sms.send`
  - `enrichment.lookup`
  - `source.download.live`
  - `agreement.issue`
  - `portal.invite`
  - `claim.submit`
  - `fee.record`
- **Per-mode behavior.** The gateway checks mode, launch gates, kill switch, feature flags, and permission:
  - **`PAUSED`:** refuse and audit.
  - **`DRY_RUN`:** hand the effect to a *recording sink* that stores exactly what would have been sent and returns a simulated result.
  - **`PILOT` / `LIVE`:** call the real adapter, subject to scope caps (cohort, send cap).
- **No bypass.** Adapters are only constructible inside the gateway module, and a lint rule forbids importing vendor SDKs anywhere else. Tests assert that every effect kind is blocked in `PAUSED` and `DRY_RUN`.
- **Mode changes.** Only Founder/Admin can request one. `PILOT` and `LIVE` need a second, distinct approver (`approver_id ≠ requester_id`). Each change records:
  - reason
  - scope
  - policy version
  - rollback conditions
  - timestamps
- **Kill switch.** One transaction that does all of the following:
  - sets mode to `PAUSED`
  - flips `kill_switch_engaged`
  - cancels queued outbound jobs
  - revokes unused portal invitations
  - writes an incident-grade audit event

  Workers re-check the gateway immediately before each send, so in-flight jobs stop too.
- **Claim submission** is never automated. `claim.submit` always requires a human approval ID and is disabled by flag even in `LIVE`.

### 3.4 Audit log

- **Append-only.** `audit_event` is append-only at three layers:
  - The app DB role has `INSERT`/`SELECT` only.
  - A trigger rejects `UPDATE`/`DELETE`.
  - Each row carries `prev_hash` and `hash` (SHA-256 over canonical JSON), so tampering is evident. A scheduled job verifies the chain and anchors the daily head hash to Object-Locked storage.
- **Each event records:**
  - actor
  - actor type (staff / claimant / agent / system)
  - action
  - resource
  - before/after diff, with sensitive fields replaced by field-name markers
  - request ID
  - IP and user agent (from a trusted proxy hop only)
  - operating mode
  - policy version

### 3.5 Data handling principles

- **Raw imports are immutable.** `property_record_raw` is insert-only and keyed by `(source_file_id, row_number)`. Normalized values live separately in `property_record_canonical`.
- **Ingestion is hardened.** It uses an allow-listed host fetcher, which blocks SSRF and private IPs. Archive extraction is safe:
  - no path traversal or symlinks
  - entry-count, ratio, and size limits
  - an expected-filename allow-list

  Schema drift sends the file to quarantine.
- **Identifiers are tokenized.** SSN/TIN values are never stored in general tables. Only *evidence status* and last-4 appear, and only where policy allows. Any full value needed for a claim lives in a separately keyed, envelope-encrypted vault table with per-access audit.
- **Exports are protected.** CSV/XLSX exports escape leading `= + - @ \t \r` characters, need a permission plus a reason, are audited, and expire.
- **Environments are separated.** Non-production environments contain synthetic data only. Seed scripts refuse to run against a database tagged `production`.

---

## 4. Domain and entry points

| URL | Serves | Auth |
|---|---|---|
| `wealthrecoveryalliance.com/*` | Marketing pages, disclosures, legal pages (counsel-review status shown in admin) | None. Contact form collects basic contact details only. |
| `wealthrecoveryalliance.com/login` | Redirect (302) to `app.wealthrecoveryalliance.com/login` | None (a redirect only) |
| `wealthrecoveryalliance.com/portal` | Redirect to `portal.wealthrecoveryalliance.com` | None |
| `app.wealthrecoveryalliance.com` | Staff ops | Staff OIDC + MFA; host-only cookies; strict CSP; `frame-ancestors 'none'` |
| `portal.wealthrecoveryalliance.com` | Claimant portal | Invite + step-up; separate cookies and session store |

Subdomains are preferred over `/app` paths for three reasons: cookie and CSP isolation from WordPress, independent deploys, and a smaller blast radius. A `/app` path would require reverse-proxying through WP Engine, which this design avoids.

---

## 5. Decisions needed before implementation can continue safely

| # | Decision | Why it matters | Default if no answer |
|---|---|---|---|
| **D1** | **Hosting and data residency:** AWS (recommended) vs Vercel + Supabase vs an existing provider | Changes infrastructure-as-code, storage, malware scanning, backup tooling, and monthly cost (roughly $300–$1,500 per month at pilot scale on AWS) | Build cloud-neutral (Postgres + S3 API + Docker) and defer IaC |
| **D2** | **Staff identity provider** (Google Workspace / Entra / Auth0 / WorkOS) and claimant IdP | Determines MFA and SSO enforcement and the session library | Generic OIDC + local mock IdP for dev and test |
| **D3** | **Public website source and domain status.** The domain does not resolve from here. Provide WordPress access/export or the repo, and confirm registrar/DNS ownership. Or approve rebuilding public pages as a static Next.js site. | Needed for every §4 website fix. Nothing can be fixed or verified without it. | Build the new public pages and disclosures as a static app in this repo, **marked counsel-review**, without touching the live site |
| **D4** | **Retire the existing agent dashboard** (move to `legacy/`, no longer deployed) | Avoids shipping its unauthenticated runners next to PII | Move to `legacy/` and exclude from build and deploy |

Not blocking engineering, but blocking any launch gate:

- **Counsel engagement:** fee rules, agreements, outreach copy, privacy assessment, and the county-probated-estate decision tree.
- **SCO registration evidence.**
- **Named owners** for compliance, claims, security, email reputation, and complaints.
