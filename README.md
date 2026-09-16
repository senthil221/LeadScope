# LeadScope v1 Beta

An internal lead-discovery workspace for one agency with multiple clients. Next.js App Router, strict TypeScript, Tailwind, Supabase Auth/Postgres, and one server-only Serper adapter. Node.js 22 or later and npm are required. Dependencies are pinned in `package-lock.json`.

The application starts empty. There are no sample accounts, seeded leads, mock adapters, LinkedIn scraping, enrichment, or background workers. All product records live in Supabase. Fictional inputs exist only inside automated tests.

## Start locally

```sh
npm ci
# Copy .env.example to .env.local, then configure the values below.
npm run dev
```

Open http://localhost:3000. Use this exact origin when `APP_URL=http://localhost:3000`; mutation requests from a different origin are rejected. Without Supabase configuration, the app displays setup requirements. Without Serper, database workflows and query generation remain available; live search stays disabled.

The selected project URL for this workspace is `https://dwoersrcbxievideuads.supabase.co`. Its LeadScope schema was installed through the signed-in SQL editor and verified through the Data API. The connector belongs to a different account; existing ProspectHub projects were not modified. No leads or sample records were added.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Exact browser origin, including port locally; HTTPS in production. |
| `NEXT_PUBLIC_SUPABASE_URL` | Your dedicated LeadScope Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project publishable key. Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported. |
| `SUPABASE_SECRET_KEY` | Server integration key for budget/job RPCs and requalification. Legacy `SUPABASE_SERVICE_ROLE_KEY` is supported. Never prefix it with `NEXT_PUBLIC_`. |
| `SERPER_API_KEY` | Server-only Serper API key. |
| `SERPER_LIVE_ENABLED` | Defaults to `false`. Must be exactly `true` to start/process live searches. |
| `SERPER_MAX_REQUESTS_PER_RUN` | Positive integer; defaults to 50 and is capped at 50. Each run snapshots its effective cap. |
| `TEST_DATABASE_URL` | Optional empty, disposable **local** PostgreSQL database. Leave blank to use the isolated embedded PostgreSQL test runtime. |

Keep `.env.local` out of version control. Set public Supabase variables before building; set server secrets in your deployment host’s secret store. The setup screen/settings show presence only and never make a paid search.

## Apply the database migration

The update `20260908045049_simplify_campaign_criteria.sql` permits optional role/location filters and empty campaign drafts. It only replaces the private save function; existing rows, authorization and query histories are preserved. It has been applied to the selected project; apply it to any other existing installation before deploying the simplified UI. A forward fix can replace this function without dropping tables.

Use a dedicated LeadScope project. The migration creates application tables, RLS, authorization helpers, signup provisioning, and transactional RPCs; it must not be applied to an unrelated production database.

The migration is `supabase/migrations/20260908021539_leadscope.sql`. It is **already applied** to the selected project. Do not execute it again. The SQL editor does not record CLI migration history; after authenticating the CLI with this project's owning account, record the existing installation before any future `db push`:

```sh
npx supabase login
npx supabase link --project-ref dwoersrcbxievideuads
npx supabase migration repair 20260908021539 20260908045049 20260908052822 20260908071804 --status applied --linked
npx supabase migration list --linked
```

For a **new empty project**, review the migration, then apply it with the Supabase CLI (substitute that project's ref):

```sh
npx supabase login
npx supabase link --project-ref YOUR_NEW_PROJECT_REF
npx supabase db push
npx supabase db advisors --linked --type security
```

Do not run `db reset` on a database whose data you want to retain. Local Supabase development, if Docker is installed:

```sh
npx supabase start
npx supabase db reset --local
```

The local config uses PostgreSQL 17 and disables seeding. The `private` schema must remain unexposed to the Data API. Public RPCs are invoker wrappers; privileged implementations live in `private`, with fixed search paths, explicit actor checks, and restricted execution. Approved admins have read access through RLS; writes use narrow RPCs. The integration service key is required only on the server and cannot substitute for an approved operator.

## Email/password sign-in and first admin

1. Email/password authentication is enabled in the selected project. Google is not required.
2. In Supabase URL Configuration, set the site URL to APP_URL and allow http://localhost:3000/auth/callback locally. In production, allow exactly https://YOUR_HOST/auth/callback and set the production site URL.
3. Open the app, choose **New operator? Create an account**, and enter your own email and password. Confirm the email if the project requires it. Hosted email delivery uses your project's SMTP configuration and limits; configure production SMTP before onboarding operators outside the project's permitted test recipients.
4. A trigger creates user_profiles with is_agency_admin=false. The user sees a no-access screen until explicitly promoted.
5. In the project SQL editor, promote the intended account, replacing the email:

```sql
update public.user_profiles
set is_agency_admin = true
where id = (select id from auth.users where email = 'YOUR_AGENCY_EMAIL');
```

Reload the app. User metadata cannot grant access; normal application users cannot edit admin flags. All approved admins manage all clients in this single agency. Remove access by setting the flag to false. An administrator can manage account recovery in Supabase; self-service password reset is not included in this beta.

References: [Supabase SSR authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs), [email/password authentication](https://supabase.com/docs/guides/auth/passwords), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Daily workflow

1. Create a client and choose **New campaign**. Each client can have multiple independent campaigns.
2. Choose **Build a query** and fill any optional location, job title, skill or keyword, or choose **Paste a query**. Pasted queries do not require audience fields; the profile site restriction is added automatically when missing. Use **Generate query** to inspect or edit generated text if desired.
3. Click **Start search** once. The app generates queries when needed, saves the campaign and atomically checks the current revision, cooldown and request limit. There is no separate preview/confirmation screen. The upper request limit is visible beside Start; the database may reduce it for skipped queries. Campaigns can also be saved for later with no criteria or queries. A search itself needs at least one enabled useful query.
4. Leads save automatically. Up to three runs process concurrently in any visible LeadScope workspace; you can create or edit another campaign while searches run. Each run has its own persisted budget and lease. Hidden tabs stop dispatches, and closing all workspace tabs stops further processing; in-flight requests may finish. Opening the workspace again continues running searches. Pause/Cancel affects a run for all operators. No closed-tab background worker is provided.
5. Review the original source and exact evidence spans. Blank criteria are not required; with no positive criteria at all, imported leads go to Review. A rule match never automatically becomes Accepted. Client notes are shared across campaigns; fit and decisions are campaign-specific.
6. Open the client’s **Prospect sheet** tab for one row per accepted LinkedIn URL across all campaigns. Edit **Prospect contacted** (Not contacted, Contacted, Replied, Follow up, Not interested) and notes inline; changes save automatically. Title, URL, snippet, latest source query/campaign, and first-seen date are included. Search and contact filters run before server pagination (50 rows); **Export CSV** and **Copy for Sheets** include all matching pages.
7. The review screen also exports Accepted leads to CSV or TSV. Suppressed and stale candidates are excluded server-side at export time; URLs are deduplicated within the selected scope.

Campaign names are generated when left blank. More options contains request limits, country/language, exclusions, review rules and repeat-search settings. New campaigns default to four generated queries, one page each and at most four requests, reduced by the server cap. Existing campaign settings are preserved. Recent searches are skipped by default; to repeat them, use **More options → Search these queries again** on the saved campaign.

Changing qualification criteria requires an explicit reset when candidates exist, and unfinished runs must first be cancelled. The reset returns candidates to Review and prevents stale exports. Open a stale candidate and select **Requalify stored evidence** to apply the current criteria to up to its latest 100 stored discoveries. It does not make a provider call. Conflicting evidence remains Review; manual decisions are never silently restored or overwritten by rediscovery.

Clients and campaigns can be archived/restored; history is retained. Client suppression overrides every campaign and future ingestion/export. Removing suppression sends affected candidates to Review. Decision and suppression changes have durable event histories.

## Request safety and recovery

- The cap is `min(campaign budget, server cap, eligible queries × page cap, confirmed cap)`. It includes all reserved retry attempts. The Start token prevents duplicate runs on double-click or request retries; changed campaign revisions require reloading the campaign.
- A transaction locks the run and claims at most one active job, reserves one slot, and assigns a 60-second lease/token before HTTP. Lower pages precede deeper pages. The Serper endpoint is fixed on the server and the HTTP/body timeout is 18 seconds.
- Dispatch attempts are recorded immediately before HTTP. The reserved count is deliberately conservative: a crash between reservation and dispatch, or an uncertain network outcome, remains charged against the **application budget**. These counters do not claim to reproduce provider billing.
- Network/timeout, 429, and 5xx errors use persisted bounded backoff (10, then 20 seconds) with at most three reserved attempts per job, subject to the total cap. No internal retry loop makes additional HTTP requests. 400/401/403 stop the run with an actionable code.
- Provider responses are durably saved before ingestion. Expired jobs with saved responses recover ingestion without another HTTP request or reservation. Commit atomically persists discoveries, campaign membership, metrics, page continuation, and completion. A replay returns the original job metrics.
- A page continues only when it produces a new, unsuppressed Rule match or Review candidate for that campaign. Empty/invalid/repeated/duplicate-only pages stop that query. The target counts unique automatic rule matches among candidates first added to the campaign in that run; a later observation in the same run may improve a new Review candidate into a match.
- A future retry or active lease keeps the run unfinished. Cancel skips unstarted work and stops further dispatch; an already dispatched response can still be committed without scheduling additional pages.
- There is no external HTTP exactly-once guarantee and no background processing after all workspace tabs close. Unknown outcomes can cost provider credits again after a permitted retry.

## Evidence, metrics, and exports

Location needs explicit snippet evidence (such as `Location:` or `Based in`); missing, educational, historic, headline-only, or conflicting context routes to Review. Current role evidence must be direct. Skills require any configured skill; required keywords require all. Phrase checks use Unicode boundaries. Recognizable contradictions can reject; the rules do not attempt general language understanding. Always inspect the source time and profile yourself.

Run counters preserve historical automatic observations separately from current manual decisions. Existing client profiles and new campaign candidates are different counts. Duplicate occurrences include same-page URL variants plus repeated campaign candidates. Counts overlap and must not be summed. Focused/broader/custom yield is shown per run. Precision is current manually Accepted rule-match decisions divided by Accepted + Rejected rule-match decisions, with the denominator displayed. Zero-denominator ratios show N/A.

Review time is approximate. It tracks visible active review, stops after 30 seconds without interaction, and flushes in small batches; closing the browser can lose the last partial batch. Select a campaign on the lead table to track time; individual lead pages always track their campaign.

CSV is quoted, TSV removes structural tabs/newlines, and spreadsheet formula prefixes are neutralized. Columns are URL, original result title/snippet, campaign, manual decision, rule assessment/reasons, source query, first/last seen, reviewed time, and notes. Names, employers, and emails are not invented. An export is a database snapshot; later suppression cannot revoke an earlier spreadsheet copy. Export ignores table status/text filters and uses the selected client/campaign’s accepted, current, unsuppressed candidates.

## Tests

```sh
npm run lint
npm run typecheck
npm test
npm run test:db
npm run build
```

Unit tests cover query/signature stability, URL handling, qualification and exact spans, improved/conflicting evidence, manual preservation, suppression, exports, same-origin/size checks, and the provider test guard. Tests explicitly refuse real Serper dispatch.

`test:db` starts a disposable **real PostgreSQL 18** instance on loopback port 55439, applies the production migration unchanged, and stops/removes the instance after the run. It bootstraps only the Supabase auth role/`auth.uid()` interface needed for database policy tests; it does not simulate a repository or prove hosted GoTrue/PostgREST behavior. On Windows, restricted sandboxes may need permission to start PostgreSQL. Alternatively set `TEST_DATABASE_URL` to an **empty local test database**; the suite refuses non-local URLs and databases already containing LeadScope tables. A supplied test database is not automatically removed. Never supply production credentials.

Database tests cover RLS/admin escalation, public/private execution grants, cross-client foreign keys, concurrent Start/claim calls, confirmed request caps, stale tokens, future retries, durable-response recovery, idempotent/atomic ingestion, manual preservation, campaign-specific fit, independent client identities, cooldown, retry ceilings, cancellation, suppression/export, and criteria resets/requalification.

Before deployment, also exercise the configured email/password sign-in and database UI: create/edit two clients, save/edit/duplicate campaigns and queries, reload, use filters, review/suppress, and export. No automated test buys Serper searches.

## Deployment

### Vercel

1. Import `senthil221/LeadScope` into Vercel and select the `main` branch. GitHub redirects the original `Leadflow` repository URL to this name. Use the Next.js framework preset, repository root, `npm ci` install command, and `npm run build` build command. Keep the default Next.js output settings. Select Node.js 22 or later.
2. Add the environment variables below to the Production environment before deploying. Copy keys from your local `.env.local` into Vercel's environment-variable settings; never upload that file or put secrets in GitHub.

| Variable | Production value |
| --- | --- |
| `APP_URL` | Your exact final HTTPS origin, such as `https://YOUR_PROJECT.vercel.app`, without a trailing slash. |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://dwoersrcbxievideuads.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The selected project's publishable key. |
| `SUPABASE_SECRET_KEY` | The selected project's server secret key. |
| `SERPER_API_KEY` | Your Serper key. |
| `SERPER_LIVE_ENABLED` | `false` initially; enable deliberately when ready to spend search credits. |
| `SERPER_MAX_REQUESTS_PER_RUN` | `50`, or a lower agency limit. |

Leave `TEST_DATABASE_URL` unset on Vercel. The action route already declares the Node runtime and a 60-second maximum duration. Vercel hosts the server routes; static export is not supported by this authenticated application.

3. In Supabase Authentication → URL Configuration, set Site URL to the same production origin and add `https://YOUR_PROJECT.vercel.app/auth/callback` to Redirect URLs. Keep the localhost callback if continuing local development. Email/password sign-in uses the existing approved accounts and installed database; do not reapply the initial migration.
4. If the deployment URL is assigned only after the first deployment, update `APP_URL` and the Supabase URLs, then redeploy. Environment changes need a new deployment. Production and preview URLs need their own exact `APP_URL`; mutations from another origin are intentionally rejected.
5. Confirm email delivery, sign in, and verify client/campaign persistence on the hosted app. Live-provider acceptance remains pending its explicitly approved budget. No deployment has been created by the GitHub push itself.

References: [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [environment variables](https://vercel.com/docs/environment-variables), [function duration](https://vercel.com/docs/functions/configuring-functions/duration).

### Other Node hosts

Portable to a standard Node host with outbound HTTPS access to Supabase and Serper:

```sh
npm ci
npm run build
npm run start
```

Set `PORT` if your host requires it. Configure all environment variables and the production email confirmation callback before testing. Use Node 22+, HTTPS, and a host that allows a request to run for at least 60 seconds. Run one operator-driven job at a time per run; horizontal instances coordinate through Postgres. No paid queue or additional API is required.

Choose hosting and Supabase quotas appropriate to the agency’s usage. Do not assume a hobby plan permits commercial/agency work or promises permanently free hosting. The user connected this repository to Vercel; pushes to main trigger that deployment. Keep production environment values and Supabase redirects configured for the final domain.

## Retention, backup, and restore

An approved operator can clean up completed raw responses older than 30 days from Settings. Parsed discoveries, original text, history, and decisions remain. Raw responses for unfinished ingestion are retained for recovery.

Before migration or release, make and verify a database backup using the selected Supabase plan’s supported procedure or a logical export. Availability and retention of managed backups/PITR depend on the plan; free-tier automatic backups are not promised. Follow [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups) and [restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Include application schemas, auth records and relevant grants, protect exports as agency data, and keep Auth/API secrets separately. Restore into a separate test project first, run migrations in order as appropriate, check account approval and row counts, and exercise exports before switching traffic. The safe rollback for a failed release is restoring the verified backup or a reviewed forward-fix; dropping tables would destroy history.

## Release verification and remaining setup

See `VALIDATION.md` for exact checks and remaining integration gaps. Live acceptance is intentionally unverified until an explicit live-test request budget is supplied. With authorization for **at most two requests**, run two real queries, one page each; reload to verify persistence; run a cooldown-skipped repeat using no credits; review/export a result if any exist. Do not add fictional records when a query has no results. Additional requests need remaining authorized budget.

Deferred: client-facing memberships, enrichment/emails, direct Google Sheets sync, scheduling, queues/workers, LLMs, outreach, billing, CRM, and marketing pages.

## Client prospect sheet update

Migration `20260908052822_client_prospect_sheet.sql` is installed on the selected project. It adds client-scoped contact status, an RLS-preserving deduplicated accepted view, narrow contact-write/export RPCs, and a client/prospect index. Existing notes, decisions and discovery history are preserved. For a forward fix, replace the view/RPC definitions while retaining the contact column and its data; do not drop prospect records.

Workspace reads now run concurrently after client scope is resolved. Status counts use one RPC rather than five requests. Search progress refreshes are throttled to ten seconds (or completion), and inline sheet edits do not reload the workspace. The sheet is horizontally scrollable within a bounded panel on smaller screens.

## Excluded LinkedIn profiles

Open a client → **Excluded**, paste a LinkedIn URL column (up to 500 unique URLs per paste), and choose **Add to Excluded**. Country subdomains, tracking parameters, fragments and trailing slashes use the same canonicalization as search results. Duplicate entries and already-active exclusions are skipped. Invalid entries must be corrected before submission. The client-specific list is searchable and paginated.

The list reuses suppressions: matching current accepted profiles disappear from the Prospect sheet and exports, future discoveries remain suppressed, and other clients are unaffected. No source or review history is deleted. Removing an exclusion returns existing campaign memberships to Review; they must be accepted again.

Migration `20260908071804_bulk_client_exclusions.sql` is installed in the selected project. It adds one atomic, permission-checked import RPC using the existing client lock, unique constraint and suppression history. It creates no tables or new data access roles. A forward fix can replace the private implementation without removing blocklist records.

## Recruiting CRM: Client → Role → Candidate pipeline

Migrations `20260910061500_recruiting_foundation.sql`, `20260910090000_recruiting_candidate_import.sql`, `20260910120000_recruiting_rating_and_threshold.sql`, and `20260910150000_recruiting_screening_and_candidate_edit.sql` add a recruiting pipeline alongside the sourcing workspace above: `clients` → `roles` → `role_candidates`, plus an agency-wide `candidates` master database so the same person's contact details are never re-entered or re-enriched across roles or clients. Every table follows the same boundary as the rest of this project: RLS on, no direct writes for `authenticated`, and every mutation through a `private` `security definer` function.

A client's Roles tab lists its open roles; each role has its own five-stage pipeline (All profiles → Profile shortlisted → Recruiter shortlisted → Client shortlisted → Offer sent), a Rejects tab, and a Master DB tab for browsing every candidate the agency has ever added. Candidates enter a role by pasting LinkedIn or Naukri URLs, manual entry, a CSV paste, or pulling from that client's own accepted sourcing prospects — all through one import action that skips invalid rows rather than aborting the batch. Rating a candidate at or above a role's threshold advances it automatically; changing the threshold itself never moves anyone, and applying it to already-rated candidates is a separate, explicitly confirmed action. The candidate panel (opened from a candidate's name) holds recruiter screening, internal notes never shared with a client, and resume upload.

**Resume storage needs one manual step this project's migrations cannot do for you:** create a **private** bucket named exactly `resumes` in Supabase Studio → Storage → New bucket (public: off). No RLS policy grants `anon` or `authenticated` access to it; every upload and download goes through `/api/resume`, which uses the server's service-role key after `admin()` has authenticated the request, so the bucket needs no policies at all beyond that default deny.
