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
| **Live government sources added in this phase** — Riverside County PLUS (incl. landscape permits), City of Santa Monica, County of Ventura weekly reports, City of Santa Barbara (stale since Sep 2025) | Automatic retrieval, same as the City of LA. | Already connected; no account needed. If you deploy elsewhere, the server must be allowed to reach `gis.countyofriverside.us`, `data.santamonica.gov`, `rmadocs.venturacounty.gov` and `gisportal.santabarbaraca.gov`. | **Free** |
| **County/city permit portals without an API** (Santa Barbara County, San Bernardino city & county, City of Riverside, Ventura County portal, Orange County, LA County EPIC-LA) | Public permit records for the rest of the territory. | Web portal search → export → import into the platform. See `Integrations → Manual imports`. | **Free** (your time) |
| **ConstructConnect Project Intelligence — Professional** | Pre-bid and bidding commercial projects with owner, GC, architect and contacts, plus Excel/CSV export (export is *not* in the Starter tier). Records import with a link back to the ConstructConnect project page. | https://www.constructconnect.com/pricing — subscribe, then Export to Excel → Detailed View → Import here. API keys are issued by apisupport@constructconnect.com under an API rider (not self-serve). | **$199/mo per market** (annual contract); Starter $129/mo has no export; Premium from $10,000/yr |
| **Dodge Construction Network** | Similar project leads; export to XLSX/CSV; API is sales-led, OAuth 2.0, internal use only. | https://www.construction.com/ (quote) | Custom quote; pricing not published |

Licensing: ConstructConnect's Master Subscription Agreement licenses the data for your own
business dealings; it may not be shared, sold or redistributed to third parties and remains
ConstructConnect's property. Keep it inside this platform and your own CRM.

## Contact research providers (decision-makers at developers, GCs and owners)

The platform works without any of these (LinkedIn search links plus manual entry). Each can be
switched on independently under *Settings → Contact research providers*, and the key can be tested
before use. Details were read from each provider's own documentation and pricing page on 7 Nov 2026.

| Provider | What it can do for you (verified in its docs) | API access & key | Price (list) | Notes / restrictions |
|---|---|---|---|---|
| **Hunter.io** — *recommended first* | Finds people at a company by **domain or company name**, filtered by seniority and decision-maker; returns job title, email, LinkedIn handle when known, and the **public web pages where each email was found**. Email Finder (name + domain) and a dedicated **Email Verifier**. | Free key with any account (hunter.io/api-keys). Sent as `X-API-KEY`. 15 requests/s. | Free: 50 credits/mo. Starter $49/mo ($34/mo yearly, 2,000 credits). Growth $149/mo ($104 yearly, 10,000). Scale $299/mo ($209 yearly, 25,000). Email found = 1 credit, verification = 0.5. | Most auditable source because every result cites its web pages. Coverage of small regional developers is weaker than Apollo. Free plan returns at most 10 people per search. Returns 451 for people who asked not to be processed; the platform skips them. |
| **Apollo.io** | People search by company **domain or Apollo organization ID** and by job title/seniority (no cost per search). Search shows first name, **partly hidden surname** and title only; **"Reveal"** (People Enrichment) returns full name, verified-status email and LinkedIn URL. Organization search/enrichment. | `x-api-key` header. Apollo's pricing page says API access is on **Custom** plans; its API reference says People Search also works for free accounts registered with a work email. **Test before you buy.** | Free $0; Basic $49/user/mo; Professional $99/user/mo; Custom: contact sales. Reveal = 1 credit per person (+8 if a mobile number is returned — the platform never requests phones). Organization search = 1 credit per page. | Largest database of the three. Search limited to 600 calls/hour on entry plans. Plans are for internal business use only. |
| **People Data Labs** | Person Search by current company and job title (Elasticsearch query); Person Enrichment by name/email/LinkedIn; company enrichment. Returns LinkedIn URL and work email where held. | `X-Api-Key` header. Self-serve. Default 10 requests/minute. | Free tier (limited credits); **Pro from $98/mo for 350 credits** with contact data. **1 credit per person returned** by a search. | Developer-oriented; no dedicated email verifier. Searches are capped at 10 people to control credit use. |
| **ZoomInfo** | Company and people search, enrichment, direct dials (per its API docs). | Enterprise contract only; credentials are a username, client ID and private key issued by ZoomInfo. No self-serve key. | Not published. | Included as a placeholder only; not recommended at this stage. |

**LinkedIn:** LinkedIn's Sales Navigator API (SNAP) page states *"We are not currently accepting new
partners"*, and profile data beyond basic sign-in requires an approved partner program. There is
therefore no authorised way for this platform to search LinkedIn automatically. The platform
generates one-click LinkedIn and Google search links that open in your own browser; you review
the profile and paste the link back to mark the contact as "LinkedIn verified by your team". No
scraping, login automation or automated messaging is used.

**Data-protection note:** these providers sell business contact data under their own terms. Use it
for business-to-business outreach about the specific project, honour unsubscribe requests, and do
not resell or share the data. The platform stores where each contact came from and when it was
last verified.

## Not required

* **ZoomInfo** — API access is enterprise-contract only and pricing is not published.
* **LinkedIn Sales Navigator** (paid seat; price not verified here) — useful for manual research
  with the links the platform generates. Never use tools that automate your LinkedIn login or
  messaging; they violate LinkedIn's terms and can get the account banned.

## Typical starting budget

| Setup | Monthly |
|---|---|
| Minimum (hosting + Google Workspace, LA City data, manual research via LinkedIn links) | about **$15** |
| Plus Hunter.io Starter (yearly billing) | about **$50** |
| Or plus Apollo.io Basic, if your key passes the Test button | about **$65** |
| Plus ConstructConnect Professional for one market | about **$250–$300** |
