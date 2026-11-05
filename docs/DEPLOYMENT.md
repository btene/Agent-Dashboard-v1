# Putting the platform online (permanent address, no developer needed)

This guide uses **Render.com** because it is the simplest host that keeps a small app
running 24 hours a day with a permanent disk for your data. Expected cost is about
**$7.50 per month** (Starter web service $7 + 2 GB disk at $0.25/GB). Free tiers at
Render, Railway and Fly.io all either sleep when idle or cannot keep a disk, so they are
not suitable for a system that monitors permits and sends email on a schedule.

Everything the platform stores lives on that disk: the database file, encrypted
documents, settings and API keys. Nothing is sent to anyone else.

## Before you start (10 minutes)

1. A **GitHub account** (free) that can see this repository. Ask whoever set up the
   repository to add you as a collaborator if you cannot open it.
2. A **Render account** (free to create): https://dashboard.render.com/register — sign up
   with the same GitHub account; it will ask permission to see your repositories.
3. A credit card on the Render account (Settings → Billing). You will only be charged
   for the Starter service and the disk.

## Step 1 — Create the service from the blueprint

1. In Render, click **New +** (top right) → **Blueprint**.
2. Choose the repository `btene/Agent-Dashboard-v1` and the branch you were given
   (currently `claude/laughing-clarke-pw1fb5`; after the branch is merged, use `main`).
3. Render reads the file `render.yaml` in the repository and shows one service called
   **advanced-landscape-2000** with a 2 GB disk. Click **Apply**.
4. Wait 3–5 minutes. The first build installs the software and compiles the website. When
   the status turns **Live**, click the service name; the address at the top looks like
   `https://advanced-landscape-2000.onrender.com`. That is your permanent URL.

## Step 2 — Collect your login key

The blueprint generates two secrets for you:

* `DASHBOARD_API_KEY` — the password for the website. Open the service → **Environment**
  tab → click the eye icon next to `DASHBOARD_API_KEY` and copy it somewhere safe (a
  password manager). The first time you open the website it asks for this key once per
  browser.
* `DOCUMENT_ENCRYPTION_KEY` — protects uploaded licenses and insurance certificates.
  **Copy this one too and keep it safe.** If it is ever lost, uploaded files cannot be
  opened again. Never change it once documents have been uploaded.

Optional: add `DASHBOARD_STAFF_KEY` and `DASHBOARD_VIEWER_KEY` (any long random text) to
give office staff a login that cannot change settings or open sensitive documents.

## Step 3 — Open the website and run the guided setup

1. Open your URL. Enter the `DASHBOARD_API_KEY` when asked.
2. The guided setup walks through company details, documents, email, data sources,
   preferences, outreach tone, reviewing the first projects and approving the first
   campaign. Each step explains what it is for and can be skipped and finished later.
3. On the **Integrations** page press **Retrieve now** on *City of Los Angeles — Building
   Permits* to pull real permits; this needs no account.

## Step 4 — Connect your email (Google Workspace recommended)

1. On your Google account (the mailbox you want outreach sent from): Google Account →
   **Security** → turn on **2-Step Verification**.
2. Still under Security → *How you sign in to Google* → **App passwords** → create one
   named "Advanced Landscape platform". Google shows a 16-character code once. Copy it.
3. In the platform: **Settings → Email account** → provider *Google Workspace / Gmail* →
   enter your email address, username (same address) and paste the 16-character code as
   the password. Save, then press **Test sending (SMTP)** and **Test reading (IMAP)**.
4. Ask your domain/IT person to make sure **SPF and DKIM** are set up for your domain in
   Google Workspace (Admin console → Apps → Google Workspace → Gmail → Authenticate email).
   This keeps outreach out of spam folders.

Microsoft 365 note: Microsoft has switched off password sign-in for IMAP, so reply
tracking cannot read an Outlook mailbox with a password, and password SMTP is being
switched off by default at the end of 2026. If your company is on Microsoft 365, either
use a Google Workspace mailbox for outreach, or ask IT about an OAuth connection.

## Step 5 — Turn on monitoring

**Automation Control Center**: the system starts in *Semi-automatic* mode with
*Automated email sending* off. Leave it that way until you have reviewed a few drafts.
Press **Run now** on *Automatic permit monitoring* once to confirm it works; after that it
runs daily on its own.

## Updating the software later

Render redeploys automatically whenever the branch it watches changes
(`autoDeploy: true` in `render.yaml`). Your data on the disk is untouched by a redeploy.

## Backups

Render → service → **Disks** → **Snapshots** lets you take a copy of the disk. Take one
before any big change. You can also download a CSV of projects and contacts from the
Projects and CRM pages at any time.

## If something goes wrong

* **"Application failed to respond"**: open the service → **Logs**; the last lines show
  the error. Most often an environment variable was removed.
* **Website asks for a key you do not have**: Environment tab → `DASHBOARD_API_KEY`.
* **Documents will not open**: `DOCUMENT_ENCRYPTION_KEY` was changed; restore the original
  value.
* **Permit retrieval fails**: Integrations → Run diagnostics shows whether data.lacity.org
  is reachable and returns a sample record.

## Alternatives

* **Railway** (~$5/month, volumes $0.15/GB) also works but its configuration-file format
  is changing in late 2026.
* **Fly.io** is the cheapest (~$2–3/month) but requires command-line tools.
* **Your own computer** works for testing (`npm run build && npm start`) but the website is
  only reachable while the computer is on and the automations only run while it is on.
