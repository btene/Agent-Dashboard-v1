# Implementation Plan: First Production-Capable Milestone

Companion to [`architecture.md`](architecture.md) (ADR-0001). Every phase ships with the platform in **PAUSED** or **DRY_RUN**. Nothing here contacts a real person, downloads live personal-data files, or writes to production.

Each phase ends with a report covering:

- what changed
- files and migrations
- tests and results
- screens ready for review
- decisions made
- risks
- the next safe step

## Phase 1: Audit and architecture *(this change)*

- Current-state audit of the repository and the public site.
- ADR-0001 and this plan.
- Open decisions D1–D4.

## Phase 2: Secure application shell

1. Restructure into npm workspaces:
   - Move the existing code to `legacy/agent-dashboard/`, excluded from build (D4).
   - Scaffold `apps/ops`, `apps/portal`, `apps/worker`, and `packages/{db,policy,integrations,ingest,ui}`.
   - TypeScript strict, ESLint (with a rule forbidding vendor-SDK imports outside the gateway), Prettier, Vitest, and Playwright.
2. Local stack in `docker-compose.yml`:
   - Postgres
   - MinIO
   - ClamAV
   - Mailpit (dev-only SMTP sink)
   - a mock OIDC provider
3. First Drizzle migrations:
   - users and roles: `user`, `role`, `permission`, `user_role`
   - `audit_event` (append-only trigger + hash chain)
   - operating mode: `operating_mode`, `operating_mode_change`
   - `feature_flag`
   - launch gates: `launch_gate`, `launch_gate_evidence`
   - approvals: `approval_request`, `approval_decision`
   - policies: `policy`, `policy_version`
4. `packages/policy`:
   - permission matrix for the 10 roles × actions
   - separation-of-duties rules
   - operating-mode state machine with two-person approval
   - kill switch
5. `OutboundEffectGateway` with recording sinks. Tests prove every effect kind is blocked in `PAUSED` and `DRY_RUN`.
6. Ops shell:
   - staff OIDC login with MFA claim check
   - layout and left navigation
   - mode banner and environment badge
   - kill switch
   - audit-log viewer
   - user and role admin
   - Launch Readiness page with the 8 gates
7. Security headers:
   - CSP (nonce-based)
   - HSTS
   - `frame-ancestors 'none'`
   - secure, host-only cookies
   - CSRF protection (Next.js server actions with an origin check)
   - rate limiting
   - trusted-proxy configuration
8. CI (GitHub Actions):
   - lint, typecheck, unit, migration up-check against Postgres
   - Playwright smoke
   - `npm audit` and a secret scan (gitleaks)

## Phase 3: Public site corrections (staging)

The approach depends on D3.

- **WordPress source available:** a patch list for:
  - the email typo
  - staging-host links
  - counters (server-rendered values with citations, or removed)
  - a dynamic copyright year
  - disclosures
  - notices at collection
  - `/login` and `/portal` redirects
- **Rebuilding instead:** a static public app with the brief's 13 page types, plus:
  - redirects, sitemap, and canonical URLs
  - JSON-LD structured data
  - axe accessibility checks in CI

Either way, all legal copy carries a counsel-review status that the admin interface shows.

## Phase 4: Data model and fixture ingestion

- Full schema from brief §10, ER diagram in `docs/data-model.md`.
- Raw and canonical property records, the dedupe/link model, provenance.
- `packages/ingest` covers:
  - allow-listed fetcher (SSRF-safe)
  - safe unzip (path traversal, bomb, and symlink protection)
  - SCO CSV and estates XLSX parsers, versioned
  - schema validation, then quarantine on failure
  - snapshot diffs (additions, removals, changes); removal ≠ paid
- Synthetic fixture archives that mimic the SCO layouts.
- The live-download effect stays gated.
- Data Sources UI: the source registry, run history, and file details.

## Phase 5: Leads, research, compliance, and outreach dry run

- Opportunity scorer with reason codes.
- Research-evidence capture.
- Human match review. Low-confidence or conflicting matches always hold.
- Deterministic compliance gate:
  - eligibility
  - pre-escheat window
  - suppression
  - fee path, as versioned policy marked counsel review required
- Versioned templates with a merge-field and policy validator.
- Campaign approval with separation of duties, then a dry-run preview into the recording sink.

## Phase 6: Claimant portal and documents

- Invite → activation → step-up verification.
- A segment-specific checklist.
- Presigned direct upload to quarantine → scan → promote.
- Document versions and reviewer status.
- Secure messages.
- The agreement workflow:
  - e-sign through a fake adapter
  - a wet-signature and notary instructions path

## Phase 7: Claims operations, agents, analytics, administration

- Package assembly, evidence index, four-eyes QA. Submission is human-only and flag-disabled.
- The 8 agent definitions with versioned instructions. Each run records:
  - cost and usage
  - redacted logs
  - available actions: Preview, Dry Run, Approve, Run, Pause, Cancel, Replay
- Analytics and the sensitivity model, using the brief's Pilot, Base, and Scale scenarios as tested fixtures. The county-probated-estate model is disabled.
- Admin pages:
  - integrations
  - webhooks (signature-verified, idempotent)
  - retention
  - privacy requests
  - incidents
  - vendor inventory
  - backup status

## Phase 8: Hardening and handoff

- Negative authorization test suite, security tests, keyboard and accessibility review, responsive checks.
- Documentation set from brief §15.
- A documented backup/restore drill and rollback runbook.
- The launch-gate report. **No activation beyond DRY_RUN.**

## Mapping to the definition of done (brief §17)

| DoD item | Phase |
|---|---|
| 1 Public-site defects fixed in staging | 3 (blocked on D3) |
| 2–4 Login, roles, mode, kill switch, audit | 2 |
| 5–6 Source adapters, raw/normalized, deltas | 4 |
| 7–8 Lead → review → compliance → dry-run outreach; no send in PAUSED/DRY_RUN | 5 (gateway in 2) |
| 9 Synthetic claimant portal flow | 6 |
| 10–12 Claims QA, agents, analytics | 7 |
| 13–15 Tests, docs, no secrets or real data | 8 (continuous from 2) |
