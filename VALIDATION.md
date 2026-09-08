# LeadScope validation

Verified on 2026-09-08 against the committed application source and pinned dependencies.

## Automated checks

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 45 tests passed in 5 files, including optional criteria, query generation with partial inputs, one-action start with server budget clamping, authentication and confirmation handling.
- `npm run test:db`: 24 tests passed against isolated real PostgreSQL 18, applying all three production SQL migrations unchanged. Includes simultaneous campaigns for the same client, independent cancellation/budgets and drafts without criteria.
- `npm run build`: passed with all application routes built successfully.

Tests do not load the workspace's real provider credentials or buy Serper searches. No synthetic records are inserted in the hosted application.

## Hosted database

- Installed `20260908021539_leadscope.sql` transactionally through the signed-in SQL editor in Leadflow (`dwoersrcbxievideuads`). Result: Success.
- Installed `20260908045049_simplify_campaign_criteria.sql` transactionally. Catalog checks confirm optional roles/location, anonymous execution denied, and authenticated execution preserved. Existing rows were not modified.
- All 14 public application tables have RLS enabled; `lead_rows` has `security_invoker=true`.
- Real server-key GET reads of clients, campaigns, user_profiles, campaign_runs and lead_rows returned HTTP 200 with zero initial records.
- Anonymous GET reads of those same resources returned HTTP 401 / database code 42501.
- Email/password Auth is enabled, signup is enabled, and email confirmation is required.
- Provisioned the user-designated `senthil@b2bdrive.net` account as the first agency admin. No other account was promoted.
- The selected project's CLI migration history must be recorded using the README's repair command before future CLI pushes. The available connector is authenticated to a different account.

## Browser and remaining acceptance

- Setup screen inspected at desktop, tablet and mobile sizes. The simplified authenticated campaign page/editor was inspected at 1440, 768 and 390 pixels; no horizontal overflow. All campaign inputs were confirmed optional in the rendered form.
- Production app login renders the actual email/password form at http://localhost:3000/login; no Google sign-in required.
- The local email confirmation callback http://localhost:3000/auth/callback was configured. Production origins are configured separately by the deployment owner.
- A subsequent read of the designated account confirmed email verification and a successful sign-in. The user created the real Test client and campaign. Verified the simplified authenticated UI: generated a skills-only query with no role/location, then saved the user-provided Chennai/B2B custom query as a second campaign named Chennai · B2B outreach with all review criteria blank and a one-request cap. Reloaded and reopened the editor to verify persistence. No search was started.
- Live Serper acceptance remains unverified. A key is configured, but `SERPER_LIVE_ENABLED=false`; an explicit live-test budget has not been supplied. Zero paid requests were made.
- The user connected GitHub to Vercel; the original deployment was confirmed successful through GitHub deployment status. The simplified application commit ef31fd4 was confirmed deployed successfully through the exact GitHub commit status.

## Advisor review

Supabase Advisor Center was inspected after installation. It reports an overlapping own-profile/admin read policy, informational unindexed foreign keys and unused indexes in the empty database, plus execution-grant warnings on the pre-existing `public.rls_auto_enable()` helper. The application's privileged implementations live in the private schema with restricted grants and explicit authorization, covered by database tests. No unrelated project's schema was changed. Assess index additions against real workload growth; unused indexes on a new empty database are expected.

These results establish the automated checks and hosted schema updates, not completed live-provider acceptance. Real concurrent provider dispatch was not exercised; database concurrency and independent budgets/cancellation were exercised in the local integration suite. No results or counts were fabricated.

## Client prospect sheet verification

- Migration `20260908052822_client_prospect_sheet.sql` installed successfully in the selected hosted project. Catalog readback: view uses security_invoker, anonymous contact RPC execution denied, authenticated execution granted with body-level agency checks.
- Hosted readback returned 10 accepted rows and 10 unique client/LinkedIn URL identities.
- Real PostgreSQL tests cover the same prospect in two accepted campaigns, independent data across clients, invalid/cross-client/unauthorized contact writes, review reset and suppression removal, literal search escaping, 61-row pagination/export, and status totals.
- Unit tests cover sheet column order, CSV/TSV formula protection, filter validation, and auth connection errors versus invalid credentials.
- Localhost account is confirmed and approved; production sign-in was observed. A local sign-in error was reported; the local process was restarted with network access, but a successful local retry has not yet been observed. No password was accessed or reset.
- Navigation optimization is verified structurally (parallel reads, five status queries reduced to one, no full refresh on inline edits). No reliable before/after production latency percentage has been established.

- Commit cb10dff deployed successfully to https://lead-scope-delta.vercel.app/. Authenticated browser verification: client tab opens the 10-row accepted sheet; contact status and notes persist across a filter navigation; the Follow up filter returned exactly the edited row; Copy for Sheets produced the header plus one row, including status and note. Temporary status/note changes were restored and confirmed through a database read. Desktop 1440, tablet 768, and mobile 390 layouts keep horizontal scrolling inside the sheet. A desktop tab-stacking issue was fixed with an explicit horizontal flex direction.
