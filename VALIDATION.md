# LeadScope validation

Verified on 2026-09-08 against the committed application source and pinned dependencies.

## Automated checks

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 48 tests passed in 6 files, including optional criteria, query generation with partial inputs, one-action start with server budget clamping, authentication and confirmation handling.
- `npm run test:db`: 25 tests passed against isolated real PostgreSQL 18, applying all four production SQL migrations unchanged. Includes simultaneous campaigns for the same client, independent cancellation/budgets and drafts without criteria.
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

## Bulk exclusion update

- 48 unit and 25 isolated PostgreSQL tests passed; lint, type checking and production build passed.
- Tests cover normalized paste/deduplication, invalid entries, idempotent imports/history, current accepted sheet and both exports, subsequent campaign ingestion, other-client isolation, invalid-batch rollback, unauthorized actors, and removal/re-review behavior.
- The bulk exclusion migration was installed successfully through the selected project SQL editor. No customer URLs were added to the blocklist during installation.

## Hostinger table workspace update — 2026-09-21

- Production target is `https://app.dataflowbase.link`, served by the `leadscope-app` container from `/opt/leadscope` on Hostinger. This UI update was deployed directly to that target; no GitHub push or Vercel deployment was used.
- Role workspaces now use one bordered panel for stage navigation, search/actions, the grid, and pagination. The name column defaults to 280px; column sizes and compact/comfortable density are saved in browser preferences. Desktop identity columns and table headers remain pinned. Long values are contained and available through the cell title or candidate drawer.
- Checks: 122 unit tests passed, ESLint passed, TypeScript passed, and local and Hostinger production builds passed. No schema, query, import, export, or authorization code changed.
- Authenticated Brave checks covered All profiles, Profile shortlisted, and Recruiter shortlisted; server-backed search; column visibility; keyboard resizing and persistence after reload; density persistence; selection/bulk controls; candidate drawer; starting/cancelling an inline edit; and arrow-key movement to the next cell. Existing candidate records were not modified during these checks. Database save success/failure was not exercised against customer records.
- Responsive checks used Brave viewport overrides of 1440, 768, and 390 pixels. The existing browser zoom changes the reported CSS viewport size. Checks inspected actual DOM bounds as well as screenshots: horizontal table scrolling remains inside the frame, and filter/column menus stay inside the page. The browser viewport override was reset after verification.
- Rollback runtime image: `leadscope-rollback:before-table-ui-20260921`. Previous pipeline/cell sources: `/opt/backups/leadscope-before-table-ui-20260921.tar.gz`; previous shared stylesheet: `/opt/backups/leadscope-before-table-ui-globals-20260921.css`. The two new UI-only files did not exist in the prior release. Restart the app using the rollback image for immediate recovery; restore the recorded sources before rebuilding that release.

## Hostinger editing, expanded tables, and recoverable deletion — 2026-09-21

- Fixed native focusout cancelling React blur saves and missing controlled-select change handling. Editable cells now open on a single click; Enter, Tab, and blur save; Escape cancels. LinkedIn identities can be edited inline through the existing validated identity RPC. System-managed metadata remains read-only.
- Added full-screen table mode with Escape exit, checkboxes across all pipeline stages and follow-ups, and role-scoped bulk deletion with a native modal confirmation. Selection is scoped to the role and current query/page. Recently deleted restores complete batches to their original stage with notes, ratings, custom fields, and history.
- Migration `20260921060536_recoverable_role_candidate_delete.sql` stores private recovery snapshots. Deleting a role membership keeps its shared candidate and other memberships. RPCs enforce approved-operator authorization, client/role scope, active roles, unique batches of 1–50 rows, stage freshness, and duplicate protection during restore. Recovery snapshots are not exposed through table grants. There is no automatic permanent purge.
- Validation: 129 unit tests passed, including seven actual DOM editing regressions; 117 database tests passed with 45 pre-existing legacy tests skipped. ESLint and TypeScript passed; local and Hostinger production builds passed. The Windows database runner initially hit sandbox restrictions and then a retained local test port; the full suite passed using elevated local execution on `TEST_DATABASE_PORT=55441`.
- The migration was installed transactionally on the self-hosted database. A production `BEGIN`/`ROLLBACK` check invoked the authenticated remove and restore RPCs and compared the complete row and event history for exact equality. No removal from that check was committed.
- Authenticated Brave verification: edited a Testing Company candidate name by clicking once, saved by clicking away, reloaded to confirm persistence, restored the original name using Tab, and confirmed restoration after reload. Checked selection on all six stages and follow-ups; opened/cancelled the deletion confirmation; loaded the empty recovery panel; checked expanded mode, Escape exit, and a 390px viewport override with no page overflow. Reset the viewport afterward. Browser error log was empty. No customer rows were deleted through the UI.
- Production remains `https://app.dataflowbase.link`. Rollback image: `leadscope-rollback:before-edit-delete-20260921`; previous source archive: `/opt/backups/leadscope-before-edit-delete-20260921.tar.gz`; restricted database backup: `/opt/backups/leadscope-before-edit-delete-20260921.dump`. Retain the additive migration and recovery snapshots if rolling back the app. New source bundle and build log are stored alongside the backups. No GitHub push or Vercel deployment was used.

## Hostinger edit history, duplicate review, and bulk editing — 2026-09-21

- Added role-level Edit history and candidate Activity → Field edit history, with authenticated actor, timestamp, field-level before/after values, shared-profile versus role scope, and bulk batch grouping. Private append-only history captures candidate, membership, and identity changes from this release onward; historical values are not backfilled.
- Bulk edit supports up to 50 selected rows on the current page, with fill-empty (default), replace, and clear modes. A required preview displays every proposed before/after value and skipped-row counts. Shared-profile edits disclose their effect on other role memberships. Unique identifiers are excluded. Apply is transactional and rejects stale previews, including changes to selected records, role thresholds, and custom-field configuration.
- Duplicate review compares role profiles with the agency-global master by normalized email, phone, or name plus company. Reviewers can confirm a duplicate, keep profiles separate, add a note, and reopen a decision. Both profiles are preserved: this release does not automatically merge or delete duplicates. Matching-detail changes invalidate prior decisions; revision checks prevent silently overwriting another reviewer's decision.
- Migration `20260921063502_candidate_history_duplicates_bulk_edit.sql` installed transactionally on the self-hosted database. Production catalog checks confirmed public wrappers are security invoker, private privileged implementations have fixed search paths and authorization checks, anonymous execution is denied, and both private tables have RLS enabled with no direct authenticated read/write grants.
- Validation: 135 unit tests passed; 124 database tests passed with 45 pre-existing legacy tests skipped. The seven new database tests passed again after the final preview-concurrency enhancement. Coverage includes preview immutability, batch rollback including audit rows, stale input/role state, scope and authorization rejection, field validation, duplicate matching/review invalidation, and history pagination. ESLint, TypeScript, and local and Hostinger production builds passed; the final display refinements also passed lint/type checking and the Hostinger build.
- Authenticated Brave checks used an isolated temporary QA role and two synthetic profiles. Verified bulk fill and clear with row-by-row previews and persisted audit entries, ordinary inline editing and reload persistence, per-profile history, duplicate keep-separate/confirm/reopen decisions, and automatic re-review after a profile changed. Desktop, tablet, and phone screenshots and DOM bounds confirmed contained dialogs and stacked duplicate cards. The viewport was reset, the original Testing Manager role reopened, and the browser error log was empty.
- A guarded cleanup transaction removed only the temporary QA role, profiles, memberships, review decisions, and test history. Readback confirmed zero remaining QA roles or profiles. Customer records were not edited during this release's live verification.
- Production authenticated read checks measured duplicate review at 18.994 ms and history at 4.779 ms on the small QA fixture; these are not large-scale performance benchmarks. Final container health was healthy and the public login returned HTTP 200.
- Production remains `https://app.dataflowbase.link`; no GitHub push or Vercel deployment was used. Rollback image: `leadscope-rollback:before-table-tools-20260921`. Previous sources: `/opt/backups/leadscope-before-table-tools-20260921.tar.gz`; restricted database backup: `/opt/backups/leadscope-before-table-tools-20260921.dump`. Final deployed source bundle: `/opt/backups/leadscope-table-tools-final-20260921.tar.gz`; final build log: `/opt/backups/leadscope-table-tools-final-build-20260921.log`. Preserve the additive migration and audit/review data when rolling back only the application.

## Compact role toolbar — 2026-09-21

- Replaced seven always-visible role tools with two compact dropdowns: Views (Follow-ups, Master DB, Analytics) and Actions (Edit history, Duplicate review, Recently deleted, Expand/Exit expanded table). The Views trigger identifies the active alternate view. Pipeline stages remain directly accessible.
- Native disclosure controls support keyboard activation, Tab navigation, Escape with focus restoration, click-away dismissal, and automatic closure after selection. Only one dropdown opens at a time. Popovers are aligned within the workspace at desktop, tablet, and phone sizes.
- ESLint and TypeScript passed. The Hostinger production build passed. This is a presentation-only change with no API, authorization, database, or record changes; no new automated tests were added for this reversible layout change.
- Authenticated Brave checks covered all three view destinations, all four action destinations, keyboard open/Escape, expanded-mode exit, outside-click dismissal, and responsive screenshots at normal desktop, 768px, and 390px viewport overrides. A generic details-element border and padding found during responsive review was explicitly reset for the dropdowns.
- Direct Hostinger deployment retains app.dataflowbase.link. Rollback image: leadscope-rollback:before-menus-20260921. Previous sources: /opt/backups/leadscope-before-menus-20260921.tar.gz. Final sources and build log: /opt/backups/leadscope-menus-final-20260921.tar.gz and /opt/backups/leadscope-menus-final-build-20260921.log. The new role-tools-menu.tsx file is unused by the prior sources if rolling back.

## Client review presentation and interface copy — 2026-09-21

- Rebuilt the existing client share page as a dedicated review portal with client/role identity, shortlist count, numbered profile cards, clearly labelled profile facts, LinkedIn actions, and a separate feedback panel. Desktop uses adjacent profile/feedback columns; smaller screens stack the sections. Added a share-specific page title and candidate-specific feedback labels.
- Replaced interface em-dash placeholders with readable missing-value labels and select prompts, and rewrote affected sentences across the app. Existing stored profile/feedback text was not rewritten. The qualification parser still recognizes punctuation in imported source text.
- Corrected the feedback instructions to describe the existing save-on-blur behavior. Shared links, token checks, visible-field projection, write permissions, and database operations are unchanged.
- Validation before deployment: 135 unit tests passed; ESLint and TypeScript passed; git diff --check passed. Source search found no em dashes or em-dash entities in src/app or src/components. No database migration was required.
- Rollback image: leadscope-rollback:before-client-review-20260921. Previous sources: /opt/backups/leadscope-before-client-review-20260921.tar.gz. Deployment source bundle: /opt/backups/leadscope-client-review-20260921.tar.gz. Build log: /opt/backups/leadscope-client-review-build-20260921.log. Direct Hostinger deployment; no GitHub push or Vercel deployment.
- Brave verification used the user's existing share link. Both profiles, LinkedIn destinations, and original feedback values rendered correctly. Desktop and tablet layouts were inspected; the phone feedback panel stacks below the facts. Phone review identified a compressed identity header, corrected by placing the LinkedIn action on its own grid row. No customer feedback was changed during testing.
- Live page inspection found zero em dashes in rendered text, no desktop horizontal overflow, and no browser error logs. Feedback fields have candidate-specific accessible labels and support keyboard focus. The final phone stylesheet's local and remote SHA-256 hashes match.
- The final source bundle/build log use /opt/backups/leadscope-client-review-final-20260921.tar.gz and /opt/backups/leadscope-client-review-final-build-20260921.log.
- Final Hostinger production build passed; container health is healthy and login returns HTTP 200. After the phone header refinement, Brave screenshot capture repeatedly timed out even in a fresh tab; final phone pixel verification is therefore incomplete. Earlier desktop/tablet/phone screenshots were inspected, final live page DOM verified the title, two feedback fields, and zero em dashes, and the viewport override was reset.

## Compact client review sheet — 2026-09-21

- Replaced the client-facing profile cards and large hero with a compact sheet and a small role header. Each candidate occupies one row; candidate identity and editable feedback appear first, followed by rating and the permitted profile/custom fields. Existing share links, field visibility, and feedback save behavior are preserved.
- Added semantic table headers, sticky column headers and candidate identity, bounded horizontal scrolling, compact feedback inputs that expand on focus, subtle cell borders, and contained long-text values. Missing-value labels remain free of em dashes.
- ESLint and TypeScript passed; the Hostinger production build passed. No API/database changes or new tests were needed for this presentation change. Brave desktop, tablet, and phone screenshots verified the compact layout and visible in-frame horizontal scrollbar. Existing feedback values were preserved during read-only verification.
- Rollback image: leadscope-rollback:before-client-sheet-20260921. Previous sources: /opt/backups/leadscope-before-client-sheet-20260921.tar.gz. Final source bundle: /opt/backups/leadscope-client-sheet-final-20260921.tar.gz. Build log: /opt/backups/leadscope-client-sheet-final-build-20260921.log. No GitHub push or Vercel deployment.

## Show all non-name columns by default — 2026-09-24

- The all-stage column registry is now live on Hostinger. Every available data and custom column appears by default on each candidate stage. Full name keeps its existing behavior: hidden on All profiles and Profile shortlisted, visible on later stages.
- Column preferences use a new per-role, per-stage key, clearing older hidden-column defaults once. A subsequent hide or reorder persists for that stage without changing another stage.
- Local ESLint, TypeScript, and 167 unit tests passed; the Hostinger production build passed. Authenticated Brave checks confirmed all columns on Client shortlisted and All profiles, verified a manual hide persisted after reload, and reset that test preference to show all columns again.
- Final Hostinger container health was healthy and the live login returned HTTP 200. Existing candidate records were not edited. Rollback image: `leadscope-rollback:before-visible-columns-20260924`; previous sources: `/opt/backups/leadscope-before-visible-columns-20260924.tar.gz`; column-registry backup: `/opt/backups/leadscope-columns-before-all-stages-20260924.ts`; final build log: `/opt/backups/leadscope-all-columns-build-20260924.log`. Direct Hostinger deployment; no GitHub push or Vercel deployment.

## Corrected stage column matrix — 2026-09-24

- Replaced the immediately preceding all-columns default with the supplied five-tab matrix. All profiles shows Added, LinkedIn, Source, and Rating; Profile shortlisted adds Mobile. Recruiter shortlisted, Client shortlisted, and Offer sent show Added, LinkedIn, Mobile, Full name, Email, Location, Company, Designation, Exp, CTC, Qualification, Resume, Notes, and role custom columns. Full name stays outside the Columns menu and appears only on those latter three tabs. The Rejects tab, absent from the matrix, retains its earlier detail and rejection columns.
- Additional fields stay available in the Columns menu for deliberate selection. The v4 per-role, per-stage preference key replaces the brief all-columns defaults once; subsequent manual visibility and order choices remain per tab. Candidate data was not changed.
- ESLint, TypeScript, and 163 unit tests passed. The Hostinger production build passed. Authenticated Brave checks confirmed the live headers on all five specified tabs and Rejects. Final container health was healthy and the login returned HTTP 200.
- Rollback image: `leadscope-rollback:before-column-matrix-20260924`; previous source archive: `/opt/backups/leadscope-before-column-matrix-20260924.tar.gz`; final build log: `/opt/backups/leadscope-column-matrix-build-20260924.log`. Direct Hostinger deployment; no GitHub push or Vercel deployment.

## Alternate mobile default — 2026-09-24

- Alternate now appears immediately after Mobile by default from Profile shortlisted through Rejects. It remains hidden by default on All profiles. Existing candidate values and manually saved column preferences are unchanged.
- ESLint, TypeScript, 163 unit tests, and the Hostinger production build passed. Authenticated Brave checks confirmed the live headers across all six stages. Final container health was healthy and the login returned HTTP 200.
- Rollback image: `leadscope-rollback:before-alternate-default-20260924`; registry backup: `/opt/backups/leadscope-columns-before-alternate-default-20260924.ts`; build log: `/opt/backups/leadscope-alternate-default-build-20260924.log`. Direct Hostinger deployment; no GitHub push or Vercel deployment.
