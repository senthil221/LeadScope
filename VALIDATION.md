# LeadScope validation

Verified on 2026-09-08 against the committed application source and pinned dependencies.

## Automated checks

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 36 tests passed in 3 files, including email/password route boundaries and confirmation handling.
- `npm run test:db`: 20 tests passed against isolated real PostgreSQL 18, applying the production SQL migration unchanged.
- `npm run build`: passed with all application routes built successfully.

Tests do not load the workspace's real provider credentials or buy Serper searches. No synthetic records are inserted in the hosted application.

## Hosted database

- Installed `20260908021539_leadscope.sql` transactionally through the signed-in SQL editor in Leadflow (`dwoersrcbxievideuads`). Result: Success.
- All 14 public application tables have RLS enabled; `lead_rows` has `security_invoker=true`.
- Real server-key GET reads of clients, campaigns, user_profiles, campaign_runs and lead_rows returned HTTP 200 with zero initial records.
- Anonymous GET reads of those same resources returned HTTP 401 / database code 42501.
- Email/password Auth is enabled, signup is enabled, and email confirmation is required.
- Provisioned the user-designated `senthil@b2bdrive.net` account as the first agency admin. No other account was promoted.
- The selected project's CLI migration history must be recorded using the README's repair command before future CLI pushes. The available connector is authenticated to a different account.

## Browser and remaining acceptance

- Setup screen inspected at desktop, tablet and mobile sizes; no horizontal overflow.
- Production app login renders the actual email/password form at http://localhost:3000/login; no Google sign-in required.
- Site URL is http://localhost:3000; the email confirmation callback is http://localhost:3000/auth/callback.
- First-account email confirmation and authenticated browser workflows are pending user sign-in. Unit tests verify the auth route, but do not prove hosted email delivery.
- Live Serper acceptance remains unverified. A key is configured, but `SERPER_LIVE_ENABLED=false`; an explicit live-test budget has not been supplied. Zero paid requests were made.
- No public deployment was performed; no hosting target was supplied. The portable production build is running locally.

## Advisor review

Supabase Advisor Center was inspected after installation. It reports an overlapping own-profile/admin read policy, informational unindexed foreign keys and unused indexes in the empty database, plus execution-grant warnings on the pre-existing `public.rls_auto_enable()` helper. The application's privileged implementations live in the private schema with restricted grants and explicit authorization, covered by database tests. No unrelated project's schema was changed. Assess index additions against real workload growth; unused indexes on a new empty database are expected.

These results establish the automated checks and hosted schema installation, not completed live-provider or production acceptance. No results or counts were fabricated.
