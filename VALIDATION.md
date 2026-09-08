# LeadScope validation

Verified on 2026-09-08 against the committed application source and pinned dependencies.

## Automated checks

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 42 tests passed in 4 files, including optional criteria, query generation with partial inputs, one-action start with server budget clamping, authentication and confirmation handling.
- `npm run test:db`: 22 tests passed against isolated real PostgreSQL 18, applying both production SQL migrations unchanged. Includes simultaneous campaigns for the same client, independent cancellation/budgets and drafts without criteria.
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
