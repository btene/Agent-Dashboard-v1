# Services, accounts and credentials you need (with estimated monthly costs)

Verified against the providers' own pages on 5–6 November 2026. Prices are US list
prices before tax and change over time; links are given so you can confirm before buying.
Nothing in this list has been purchased or activated by the platform. Items marked
**required** are needed for the platform to run at all; everything else can be added later
or skipped.

## Required to run the platform

| What | Why | Where to get it | Estimated cost |
|---|---|---|---|
| **Render.com Starter web service + 2 GB disk** (required) | Keeps the website and automations running 24/7 at a permanent address, with your data on a persistent disk. Free tiers sleep when idle and cannot keep a disk. | https://render.com/pricing — follow `docs/DEPLOYMENT.md` | **$7/mo + $0.50/mo disk ≈ $7.50/mo** |
| **GitHub account** (required) | Render deploys from the repository. | https://github.com | Free |
| **Google Workspace mailbox** (recommended for email) | Outreach is sent from your own address (SMTP) and replies are read back (IMAP). Google still supports an *App password* for this; Microsoft 365 no longer allows password sign-in for IMAP, so reply tracking cannot read an Outlook mailbox without an OAuth integration. | https://workspace.google.com/pricing — Business Starter | **$7/user/mo** (annual) or $8.40 monthly |
| **City of Los Angeles open data** (already connected) | Live building permits. | https://data.lacity.org/d/pi9x-tg5x — optional free app token at https://data.lacity.org/profile/edit/developer_settings | **Free** |

Credentials to keep safe: `DASHBOARD_API_KEY` (website login), `DOCUMENT_ENCRYPTION_KEY`
(protects uploaded licenses/insurance; cannot be recovered if lost), the Gmail App password.

## Project data beyond the City of Los Angeles

| What | What it gives you | Access method | Estimated cost |
|---|---|---|---|
| **County/city permit portals** (Santa Barbara city & county, Ventura County, San Bernardino city & county, Riverside, Orange County, LA County EPIC-LA) | Public permit records for the rest of the territory. | Web portal search → export → import into the platform. No API confirmed for these; see `Integrations → How to connect`. | **Free** (your time) |
| **ConstructConnect Project Intelligence — Professional** | Pre-bid and bidding commercial projects with owner, GC, architect and contacts, plus Excel/CSV export (export is *not* in the Starter tier). Records import with a link back to the ConstructConnect project page. | https://www.constructconnect.com/pricing — subscribe, then Export to Excel → Detailed View → Import here. API keys are issued by apisupport@constructconnect.com under an API rider (not self-serve). | **$199/mo per market** (annual contract); Starter $129/mo has no export; Premium from $10,000/yr |
| **Dodge Construction Network** | Similar project leads; export to XLSX/CSV; API is sales-led, OAuth 2.0, internal use only. | https://www.construction.com/ (quote) | Custom quote (commonly several thousand dollars per year; not published) |

Licensing: ConstructConnect's Master Subscription Agreement licenses the data for your own
business dealings; it may not be shared, sold or redistributed to third parties and remains
ConstructConnect's property. Keep it inside this platform and your own CRM.

## Contact research providers (decision-makers at developers, GCs and owners)

See the table in the section below once provider verification is complete; the platform works
without any of them (LinkedIn search links and manual entry), and each can be switched on
independently under *Settings → Contact research providers*.

PROVIDER_TABLE_PLACEHOLDER

## Not required

* **ZoomInfo** — strongest data, but API access is enterprise-contract only; typical contracts are
  five figures per year. Not recommended at this stage.
* **LinkedIn Sales Navigator** (~$99/user/mo) — useful for manual research; there is no LinkedIn
  API that lets a third-party app search people by company and title, so the platform only opens
  search links in your browser. Never use tools that automate your LinkedIn login or messaging;
  they violate LinkedIn's terms and can get the account banned.

## Typical starting budget

| Setup | Monthly |
|---|---|
| Minimum (hosting + Google Workspace, LA City data, manual research via LinkedIn links) | about **$15** |
| Plus one contact provider at the entry tier | about **$50–$100** |
| Plus ConstructConnect Professional for one market | about **$250–$300** |
