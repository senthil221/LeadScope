# Recruiting CRM — revised product and delivery plan

Date: 16 September 2026. Reviewed against local commit `22533f8`.

Status: planning only. The user reports that the manual decimal ratings migration is applied; this review did not independently inspect the hosted database. This plan supersedes conflicting recommendations in `CRM_IMPLEMENTATION_PLAN.md` and `CRM_REVIEW.md`, which remain historical documents.

Inputs: the user's recruiting brief, reaffirmed in attachment `51c329b2-3414-4fa5-a910-806a70f44056/pasted-text.txt`, subsequent instruction to omit AI features, supplied CRM design screenshot, recent commits, and current UI/data-loading source. The reaffirmed brief matches the earlier supplied text. This is a source review and design plan, not a fresh authenticated browser audit or performance benchmark.

Priority: the brief defines the required product; the screenshot defines the visual direction. Earlier explicit decisions about Client → Roles and manual rating floors still apply. Existing offers, analytics, follow-ups, and sourcing features are retained but remain secondary; expanding them must not delay the core brief. Proposed usability details below support the required workflow and are not new mandatory business modules.

## 1. Product direction

Build a focused recruiting workspace around **Clients → Roles → Candidates**. The main screen is a working table: recruiters can find a profile, enter a rating, review details, and move it forward without navigating between unrelated modules.

Use the supplied screenshot as a visual reference: restrained white and neutral surfaces, a compact sidebar, fine table dividers, clear typography, one aligned toolbar, and small status tags. Adapt its density for readable candidate information and accessible controls. The screenshot's company fields, extra navigation items, and Ask AI button are not requested features.

Keep the current Next.js/Supabase foundation and existing records. Improve routing, reusable UI, and query boundaries incrementally. A framework or database rewrite is not justified by the evidence reviewed.

Implementation preference: **gpt-5.6-terra, reasoning effort high**. Planning and review may use Astra as permitted by the user. This document records the preference; it does not change the running session's model. Validate the same acceptance criteria regardless of model.

## 2. Rules that control the implementation

- One canonical candidate per normalized identity within the authorized agency database, with a separate candidate membership/journey for each role. A person can be in different stages for different roles. Moving stages updates that membership; it never clones a candidate.
- Five stage tabs: **All Profiles → AI Shortlisted → Recruiter Shortlisted → Client Shortlisted → Offer Sent**. Keep the brief's stage name “AI Shortlisted”; ratings are entered by people and no AI service is involved.
- **Rejects** and **Master DB** are separate views, not extra progression stages. Keep both directly accessible from the role as requested.
- Rating and per-role **Rating Floor** are 0–5 with decimals. The current implementation supports tenths. Changing a manual rating in All Profiles to meet the floor advances the candidate immediately. Later-stage ratings do not silently move candidates backward.
- A changed floor does not silently reprocess existing candidates. Preserve the existing preview-and-apply behavior, label it clearly, and keep it separate from saving the floor.
- After AI Shortlisted, show a clear next-stage action. Offer Sent has offer outcomes rather than an invented sixth stage. Rejection is available only from Recruiter Shortlisted, Client Shortlisted, and Offer Sent, with required reason and type.
- **Date Added** means entry into the current stage, per the brief. Preserve original import/creation time separately for history. The old plan's instruction to replace this with original role creation time is superseded.
- **Notes** is the client-visible, role-specific feedback field. Existing internal recruiter notes remain separate and private. Do not merge them or expose historical internal notes during migration.
- No AI scoring, automated profile verification, or paid mobile-number API in this work. Resume and mobile fields still support manual entry/upload.

## 3. What exists and what needs correction

Existing foundations to retain: client and role creation, paginated candidate stages and search, manual decimal ratings, rejection/restore, CSV preview and mapping, custom fields, candidate editing and resumes, activity history, follow-ups, offers, source reporting, and candidate reuse.

| Area | Current code evidence | Required result |
| --- | --- | --- |
| Navigation | `src/components/shell/Sidebar.tsx` prominently lists Campaigns, Leads & review, Prospect sheet, and Excluded. | Recruiting destinations first. Existing sourcing/admin records remain reachable in a collapsed secondary area. |
| Workspace layout | `role-pipeline.tsx` stacks four metric cards, stage tabs, tools, section actions, and a separate search form above the table. | Compact role heading, stage strip, one toolbar, then candidates. Counts live beside stage names. |
| Persistent navigation | `AppShell` is rendered inside page workspace components; the root layout only wraps the document. | Move the authenticated shell into an appropriate shared layout, with content loading boundaries and preserved navigation state. |
| Data loading | Catch-all page loads the client directory before role-specific work; share links and sourcing rows also load on routine stage visits. | Split route/domain loaders, fetch independent data together, and load dialogs/sourcing only when needed. Measure actual impact. |
| Stage counts | Master DB and Follow-ups branches do not populate `roleCandidateCounts`; `RoleWorkspace` defaults them to `{}`. | Keep role counts accurate when visiting any role view. Add a regression check for this path. |
| Client sharing | Custom sharing exists across stage tabs; the client-review preset is on Client Shortlisted. Custom fields, interview dates, and decisions may be writable. | Share Recruiter Shortlisted candidates only. Client may edit Notes only, with the same restriction enforced in APIs and database functions. |
| Master DB | The route selects all rows from `candidates`, regardless of stage history. | Only candidates who have ever reached AI Shortlisted qualify, and they remain eligible after rejection or subsequent moves. |
| Imports | CSV upload exists; source/vendor is optional free text; source vocabulary mixes platforms and import methods. | Single URL, paste URLs, CSV/Excel; required business source choices and row-source precedence. |
| Candidate detail | `candidate-panel.tsx` is still one long modal with multiple forms. | A consistent side panel with focused sections, next/previous review, and stable table position. |
| Table tools | Search and pagination exist; generalized sort, source/rating filters, column visibility/order, and matching exports need completion. | One predictable table model shared by rows, counts, filters, and exports. |

## 4. Target interface

### Navigation and page hierarchy

- Sidebar: Clients, Master DB, Settings; show the selected client's roles in context. Keep the existing Today queue visible from the agency landing page without creating a mandatory new dashboard.
- Legacy sourcing: collapsed under a clearly named secondary entry. Do not make recruiters pass through campaigns to add candidates.
- Clients: compact searchable list of clients with open roles and useful workload counts. Clicking a client opens roles directly.
- Roles: compact rows with role name, active status, stage counts, and follow-ups. New role is the primary page action; edit/archive belongs in an overflow menu.
- Role: breadcrumb `Clients / Client name / Role name`, compact role title, Rating Floor setting, and Add candidates.
- Under the heading: five stage tabs with counts; Rejects and Master DB are adjacent but visually separated. Follow-ups and Analytics remain secondary tools.
- One table toolbar: search, Filters, Sort, Columns, and a secondary export menu. Show Share with client on Recruiter Shortlisted. Keep bulk actions hidden until rows are selected.

### Visual system

- White workspace, lightly tinted sidebar, subtle neutral dividers, dark text, one restrained brand accent, and semantic tags that also have text labels.
- Initial dimensions: sidebar about 216–232px; breadcrumb bar 48px; desktop table rows 40–44px; table/body text 13–14px. Verify these in the actual viewport before locking them in.
- Use most of the screen for the table. Replace large summary cards with small counts where the same number already appears on a tab.
- Sticky table heading and candidate identity column, resizable columns with sensible minimum widths, clear hover/focus states, restrained horizontal scrolling, and truncated text with a way to read the full value.
- Desktop candidate drawer approximately 480–560px, adjusted to available width; full-screen detail on narrow mobile screens. Touch controls need adequate targets even where desktop rows are compact.
- Consistent dialogs, empty states, errors, save indicators, and skeletons. Never silently discard a failed edit or show success before the server confirms it.

### Candidate interactions

- Click the candidate name to open details. Keep external profile links separately clickable.
- Enter manual ratings directly in the table. Show saving/error state; explain successful automatic movement and update counts.
- Keep the requested next-stage row action visible from AI Shortlisted onward. Offer a compact Reject action in the three permitted stages.
- Use Profile, Screening, Notes, and Activity sections in the drawer; show offer details when relevant. Preserve next/previous navigation within the current filtered result set.
- Preserve search, filters, sort, page, and scroll after editing or closing details. If a candidate leaves the active stage, update the row and counts coherently.
- Custom columns are created from Recruiter Shortlisted and also appear in Client Shortlisted and Offer Sent. Distinguish **Columns** (visibility/order) from **Add custom field** (changing stored data).

### Stage-specific columns

The pasted brief lost the visible/hidden marks in its column matrix. The following defaults are a proposal, not a claim that those marks were recovered:

| View | Proposed default emphasis |
| --- | --- |
| All Profiles | Date Added, LinkedIn/profile link, Source, Rating; show name when available. |
| AI Shortlisted | Date Added, identity/profile link, Source, Rating, mobile, and contact basics. |
| Recruiter Shortlisted | Candidate identity/contact, company/designation, location, experience, CTC, qualification, resume, Notes, and custom fields. |
| Client Shortlisted / Offer Sent | Carry forward recruiter columns; expose offer data in the offer view/detail without requiring extra navigation. |
| Rejects | Recruiter Shortlisted columns plus rejection reason/type. |
| Master DB | Reusable identity/contact fields, qualification date, and clear role membership/reuse actions. Role-specific notes and ratings must remain explicitly scoped. |

All brief fields remain stored when hidden. Confirm this proposed visibility matrix before finalizing column defaults; it does not block navigation or layout work.

## 5. Delivery sequence

Each increment ends with a working result and relevant checks. Keep database/permission changes small enough to review independently.

### Increment 1 — Correct client sharing and Master DB semantics

1. Limit sharing to Recruiter Shortlisted. Simplify setup to preview, create/copy link, expiry, and revoke.
2. Include the requested recruiter columns and custom fields; allow only Notes writes. Remove client decision/rejection and other field-write paths from the shared contract.
3. Apply restrictions to existing links and backend endpoints as well as newly created links. Preserve prior feedback/history; explain any links needing replacement. Enforce resume access through the same scoped share authorization.
4. Persist first qualifying entry into AI Shortlisted. Backfill from reliable stage history/current-stage evidence; report ambiguous legacy records rather than assuming all imports qualify.
5. Drive Master DB rows, counts, search, and reuse selection from that permanent eligibility rule. Keep canonical candidate rows even when not eligible for the visible Master DB.
6. Correct stage counts in Master DB and Follow-ups.

Acceptance: a client can view only the linked role's Recruiter Shortlisted rows and edit Notes; direct attempts to edit other fields or another role fail. A newly imported/unrated candidate is absent from Master DB, appears after qualification, and remains after rejection. Reuse creates only a role membership.

### Increment 2 — Deliver the reference-style recruiting workspace

1. Establish shared tokens and table/toolbar/button/drawer components, using the existing icon/font foundation.
2. Simplify the sidebar and client/role pages, and implement the persistent authenticated layout without disrupting login or public share routes.
3. Rebuild the role heading, tabs, toolbar, and candidate table. Remove repeated cards/headings and apply consistent terminology: All Profiles, Rating Floor, Notes.
4. Replace the candidate modal with the side panel and next/previous review.
5. Apply the same visual system to the client share page, including a short explanation that Notes is editable.

Acceptance: show populated desktop, tablet, mobile, loading, and empty-state screenshots. A recruiter can open a role, find a candidate, review them, and advance them without losing table context. Existing sourcing records remain accessible.

### Increment 3 — Finish everyday table functionality and imports

1. Add server-side source/rating/date filters and deterministic sorting, with matching result counts and exports. Add column visibility, order, and widths with remembered per-user preferences.
2. Make Add candidates a three-choice flow: One candidate, Paste a list, Import CSV/Excel. Additional legacy inputs stay secondary.
3. Require Source choices: LI Recruiter, Resdex, Google Search, Job Post. Retain old source information for history; separate business source from import method internally.
4. Require LinkedIn URL for the new brief-defined input flow. Respect a file's nonblank Source value over the batch source; validate unsupported values in preview. Preserve existing non-LinkedIn records and identities.
5. Add Excel reading through the same normalized validation/mapping pipeline as CSV. Clearly handle sheet selection, size limits, empty values, and invalid rows.
6. Audit all brief fields, including Current CTC, Highest Qualification, Resume, and Notes. Verify mapping/editing across imports, table, detail, share, and export; add missing first-class fields without losing existing screening data.
7. Make imports retry-safe, show duplicate/conflict outcomes, and process larger files in bounded batches with progress and a useful row-error report.

Acceptance: import a representative CSV and Excel workbook; exercise row-specific source override and retry without duplicates. Filters and export agree across multiple pages. A failed or partial import explains exactly what happened.

### Increment 4 — Performance and whole-product finish

1. Capture cold/repeat timings for Clients → Roles → Pipeline and stage switches before altering loaders. Continue measuring throughout increment 2's layout changes.
2. Remove unnecessary serial reads and oversized selections. Lazy-load share management, sourcing imports, heavy detail, and analytics. Keep table pages bounded on the server.
3. Keep shared navigation visible while content loads; retain prior content only with a clear loading indication so it cannot be mistaken for the newly selected stage.
4. Use scoped invalidation after edits. Refresh counts and affected rows without resetting the whole workspace; preserve authorization and do not globally cache private candidate data.
5. Inspect slow query plans before adding indexes. Benchmark representative small and large roles; add virtualization only if rendering remains the bottleneck.
6. Finish Follow-ups, Offers, Analytics, Settings, and retained sourcing pages with the same controls and vocabulary. Make their existing functionality easier to find without expanding scope.

Target budgets, to validate rather than promise: visible interaction feedback within 100ms; repeat stage navigation p75 under 500ms; first usable role table p75 under 1.5s on a documented deployment/network/dataset. Report cold versus warm measurements separately and investigate misses.

## 6. Release evidence and completion standard

- Functional: stage/date/rating rules; cross-role identity reuse; required rejection details; eligibility retention; source precedence; custom fields; file uploads; Notes-only client writes, including old links and direct API calls.
- Data: forward-only migrations preserve candidate records, internal notes, resumes, source history, and events. Review migration ordering and validate backfill counts against fixtures before a hosted rollout.
- UX: desktop/tablet/mobile; keyboard and focus behavior; readable contrast; populated/empty/error/loading states; context preserved after mutations; no client access to recruiter-only controls.
- Performance: measured navigation/query/payload evidence, including a role larger than one page. No claim that buffering is fixed from source inspection alone.
- Engineering: relevant unit and integration tests, lint, typecheck, and production build. Database integration tests previously could not initialize embedded PostgreSQL on this Windows path; restore a working test environment or use an authorized isolated database before treating schema behavior as verified.
- Usability: exercise representative tasks with a nontechnical recruiter: import a list, rate profiles, review/advance candidates, share with a client, read Notes, reject with a reason, and reuse a qualified candidate.

The design reference is a strong fit. The quality bar is a fast, understandable workflow with verified permissions and data behavior; a visual resemblance or a self-assigned “10/10” score is not completion evidence.
