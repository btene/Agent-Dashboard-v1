# Putting the platform online — Vercel + Supabase

Everything runs on two services:

* **Vercel** hosts the website and the server code, and runs the automations once a day.
* **Supabase** (connected *through* Vercel, so there is nothing extra to sign up for) stores all
  data and the encrypted company documents in a Postgres database.

Nothing is stored on a disk, so redeploys and Vercel restarts never lose data.

**Cost:** Vercel **Pro, $20/month**. Vercel's terms allow the free Hobby plan only for personal,
non-commercial use; a business lead-generation tool needs Pro. Supabase **Free, $0** (500 MB
database, enough for many thousands of projects). Optional: Supabase Pro ($25/month) adds automatic
daily backups; on the free plan, download CSV exports from the Projects and CRM pages regularly.

Time needed: about 30 minutes.

---

## Step 1 — Upgrade Vercel to Pro (2 minutes)

1. Sign in at https://vercel.com with the account you already use (`btene`).
2. Open **Settings → Billing** and upgrade to **Pro**.

## Step 2 — Create the project from GitHub (5 minutes)

1. In Vercel click **Add New… → Project**.
2. Find **btene/Agent-Dashboard-v1** and click **Import**. (If it is not listed, click "Adjust
   GitHub App Permissions" and allow Vercel to see the repository.)
3. Leave **Framework Preset** as *Other* and every build setting at its default; the repository
   already contains `vercel.json`, which sets them.
4. Before pressing Deploy, open **Environment Variables** and add these three. Each value should be
   a long random phrase; use your password manager's generator (30+ characters) and **save all
   three in the password manager**:

   | Name | What it is |
   |---|---|
   | `DASHBOARD_API_KEY` | Your password for the website. |
   | `DOCUMENT_ENCRYPTION_KEY` | Locks uploaded licenses and insurance certificates. **If it is ever lost or changed, uploaded documents cannot be opened.** |
   | `CRON_SECRET` | Lets only Vercel's daily scheduler start the automations. |

5. Click **Deploy**. This first deployment builds the repository's *default* branch, which is the
   older version — that is expected; the next step switches it.

## Step 3 — Point Vercel at the right branch (2 minutes)

1. Open the project → **Settings → Git**.
2. Under **Production Branch**, enter `claude/laughing-clarke-pw1fb5` and save.
   (If this branch is later merged into the main branch, change it back to the main branch.)

## Step 4 — Add the Supabase database (5 minutes)

1. In the project, open the **Storage** tab → **Create Database** → choose **Supabase** →
   **Continue**.
2. Plan: **Free**. Region: **East US (North Virginia)** — the same region as Vercel's servers,
   which keeps the site fast. Give it a name such as `advanced-landscape-2000`.
3. When asked which projects to connect, select this project and **all environments**
   (Production, Preview, Development), then **Connect**.

   Vercel now adds the database connection settings (`POSTGRES_URL` and others) to the project
   automatically. You never need to copy a database password.

   Your other Vercel project (`lev-x-v1`) and its database are not touched.

## Step 5 — Deploy the platform (3 minutes)

1. Open **Deployments**. Click **⋯** next to the newest deployment → **Redeploy**, or simply wait:
   any new commit on the production branch deploys automatically.
2. When it shows **Ready**, click **Visit**. Your permanent address looks like
   `https://agent-dashboard-v1.vercel.app`. (Settings → Domains lets you use your own domain, such
   as `leads.advancedlandscape2000.com`.)
3. The site asks for a key once per browser: paste `DASHBOARD_API_KEY`.

If something is missing, a red **Setup needed** bar at the top says exactly what (for example
"No database connected"). Fix it in Vercel and redeploy.

## Step 6 — First use (10 minutes)

1. Follow the **Guided setup** (company details, territory, documents, sources, tone…).
2. **Integrations → Live integrations**: press **Retrieve now** on City of Los Angeles, Riverside
   County, Santa Monica and Ventura County. Real permits appear within a minute.
3. **Settings → Email account**: choose *Google Workspace / Gmail*, enter your address and a Google
   **App password** (Google Account → Security → 2-Step Verification → App passwords). Press
   **Test sending** and **Test reading**.

## How it runs day to day

* **Once a day around 14:00 UTC (6–7 am Pacific)** Vercel calls the platform's daily job. Every
  automation that is switched on runs then: permit monitoring, scoring, research flags, drafting,
  reminders, reply tracking and CRM sync. You can see the schedule under the project's
  **Settings → Cron Jobs**, and press **Run** there to trigger it by hand.
* **Run now** buttons in the Automation Control Center work at any time.
* Nothing is emailed until you approve it, and automated sending stays off until you switch it on.

## Limits to know

| Limit | Value | What it means |
|---|---|---|
| Document upload size | 4 MB per file | Vercel accepts request bodies up to 4.5 MB. Compress large PDFs first. |
| Longest single task | 5 minutes | Vercel's default function limit. All current jobs finish in under 30 seconds. |
| Database | 500 MB on Supabase Free | Upgrade Supabase to Pro if you ever approach it (Supabase dashboard → Usage). |
| Live screen updates | Pages refresh when you open them | The live "push" updates of the always-on version are switched off on Vercel. |

## If something goes wrong

* **Red "Setup needed" bar** — add the variable or database it names, then redeploy.
* **"Database unavailable"** — open Vercel → Storage → your Supabase database. On the free plan a
  project with no activity for a week pauses; the daily job normally prevents that. Click
  **Restore/Resume** if it ever shows as paused.
* **Automations never ran** — Vercel → Settings → Cron Jobs: check the job is listed and press
  **Run**. Cron jobs only run on the production branch set in Step 3.
* **See errors** — Vercel → the project → **Logs**.

## Updating later

Every new commit on the production branch redeploys automatically. Your data stays in Supabase.
