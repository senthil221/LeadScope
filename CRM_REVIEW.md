# LeadScope recruiting CRM review

Reviewed 15 September 2026 against local commit `f13928f` and the signed-in production UI.

## Outcome

The application has a useful recruiting data foundation, but the visible product still puts the original search-campaign workflow first. Make Client → Role → Candidate pipeline the primary journey. Keep sourcing as an input to the role, with source history available when needed.

The requested pipeline is:

**Profiles → AI shortlisted → Recruiter shortlisted → Client shortlisted → Offer sent**

Rejections, hold decisions, and offer outcomes should remain visible without creating competing navigation systems. A person's reusable details belong to the master candidate; their score, stage, feedback, and decisions belong to the role.

## Review scope and limits

- Inspected the signed-in Clients, client overview, Roles, role pipeline, candidate details, CSV/URL import, custom-column dialog, sharing dialog, Master DB, Analytics, Leads & review, sourcing lead details, Prospect sheet, Excluded, Settings, campaign detail, and campaign builder screens.
- Reviewed the search-run component, offer outcomes, shared-client page, data-loading route, auth/proxy, import parsing, relevant SQL migrations, and tests in source.
- Live checks used existing records. No imports, candidate decisions, configuration saves, new share links, or paid searches were submitted. Opening a sourcing lead can record the application's normal review-time telemetry.
- This is a product/UX and code-loading review, not a full security audit or production load test.
- Full-workspace loading was reproduced. Browser performance entries were unavailable through the connected browser inspection API, so no precise latency baseline, query timings, or percentage improvement is claimed. A couple of navigation readiness checks exceeded the browser tool's roughly three-second selector deadline; those are observations, not performance benchmarks.
- Desktop layout was inspected in the current browser viewport. Mobile and keyboard interaction require a separate verification pass during implementation.
- Prior baseline in this task: lint and type checking passed; 72 unit tests passed. Tests were not rerun for this documentation-only review. Hosted migration inventory, database query plans, build, and database integration tests were not verified in this pass.

## Page-by-page changes

| Area | Current friction | Recommended change |
| --- | --- | --- |
| Clients | Cards show creation dates and empty notes but no hiring workload. | Show open roles, candidate totals, items needing attention, and last activity. Open the client's roles directly. |
| Client overview | Main action is New campaign; search budgets, rule matches, and run history dominate. | Make Roles the default, with a compact client summary and New role action. Put sourcing history under a secondary area. |
| Sidebar and header | Campaigns, Leads & review, Roles, Prospect sheet, Excluded, and Settings split one job across separate places. Breadcrumb stops at client; Search connected appears on recruiting screens. | Use Clients, All candidates, and Settings at agency level. Inside a client, show its roles and active role. Breadcrumb: Clients / Client / Role. Put provider status in sourcing settings. |
| Roles list | Threshold/state/edit/archive take priority over actual work. No candidate counts or workload indicators. | Role folders/cards or compact rows with stage counts, candidates awaiting action, status, and last activity. Move edit/archive to an overflow menu. |
| Role pipeline | Five stages share a tab row with Rejects, Master DB, and Analytics. Large metrics and toolbars compete with the table. | Keep the five-stage strip dominant. Put Analytics and rejected records in secondary views; make All candidates agency-wide. Use one compact toolbar and one main candidate table. |
| Candidate table | No stage-table search, filters, sorting, or pagination. Source/profile links and client feedback are missing from displayed columns. | Search and filter by source, score, recruiter decision, client response, company, experience, and follow-up. Keep name/profile accessible, provide column visibility/order and saved views, and paginate on the server. |
| Candidate detail | A 440px-wide scrolling modal starts with a long edit form. Screening and decision actions are far below; no next/previous candidate or profile-source links. | Use a wider side panel with a concise summary, source links, and sections for Profile, Assessment, Screening, Client feedback, and Activity. Keep primary actions visible and allow next/previous review. |
| Imports | CSV requires pasting raw text. No file upload, preview, mapping, or custom-column import. URL paste only accepts LinkedIn/Naukri. | One Add candidates flow: single entry, bulk paste, file upload, or sourcing connector. Preview and map columns, retain custom fields, identify source/vendor/batch, and show row-level errors and duplicates before/after import. |
| AI shortlisting | Manual 0–5 rating with threshold logic exists; no AI provider call or scoring workflow exists. | Support external score import first if that matches current operations, then optional AI scoring from actual profile/resume content and role criteria. Store score, explanation, scoring source/version/date, and human override. Do not relabel manual scores as AI output. |
| Client handoff | Link setup requires many column permissions. Client responses exist but are not displayed in the recruiter's role table/detail. | Provide a client-review preset and preview. Surface decision, notes, interview date, and pending-review state to recruiters; show explicit stage actions. |
| Offers | Moving into Offer sent and recording the offer_sent outcome are separate actions. | Make the transition clear and unified from the user's perspective; show Sent, Accepted, Declined, and Joined with dates in the role. |
| Master DB | Agency-global data is inside an individual role and cannot be opened/added to another role from this screen. | Give All candidates its own destination with profile detail, existing role memberships, search, and Add to role. |
| Leads & review | Another set of statuses: rule match, review, accepted, rejected, suppressed. Search snippets and source metrics dominate. | Treat this as an optional sourcing inbox within the role. Keep raw evidence in detail; use the same candidate-facing terminology and table patterns. |
| Prospect sheet | Another version of accepted profiles; raw URLs/snippets/query text consume width. No direct role workflow. | Move useful contact fields and exports into candidate views. Preserve original sourcing evidence and existing contact data during consolidation. |
| Excluded / Settings | Both manage the same sourcing suppression concept with different labels. Settings also mixes provider connection and raw-response cleanup. | One clearly named exclusion area under settings; keep role rejection distinct from client-wide sourcing exclusions. Separate provider/admin maintenance from recruiter work. |
| Campaign builder / run history | Useful sourcing controls, but too prominent for a CRM used with many vendors. | Keep as an optional source adapter within Add candidates. Show simple progress to recruiters; keep query, request-budget, retry, and raw-response details in an advanced view. |
| Analytics | Useful underlying event history, presented as technical tables rather than next actions. | Secondary role view with a readable funnel, waiting time, offers/joining, and source quality. Keep metric definitions available. |

## Concrete defects and functional gaps

### 1. Counts change incorrectly when opening Master DB — reproduced live

The role showed two candidates in the pipeline: one in All profiles and one in Client shortlisted. Opening Master DB displayed two master candidates but changed all role stage counts and In pipeline to zero. Returning to Analytics restored the role counts. The Master DB tab also displays zero outside the Master DB view.

Cause: the `master_db` branch does not populate `roleCandidateCounts`; the parent supplies `{}`. The Master DB badge uses `total`, which is only loaded for the active master view and is also affected by its filters.

Source: `src/app/[[...path]]/page.tsx:157`, `src/components/workspace.tsx:564`, `src/components/recruiting/role-pipeline.tsx:287`.

### 2. Client feedback is not surfaced to recruiters — code-confirmed

SQL stores `client_decision`, `client_notes`, and `interview_at`. Sharing allows client feedback. The internal role table and candidate panel do not render these fields. Shortlist/Hold records a decision without advancing the stage; Reject does move to Rejected. This asymmetry is not explained in the internal workflow.

Show feedback and a pending-action state on the role. Keep the requested stage names, but explicitly distinguish awaiting client review, approved, and on hold within the client-review work.

Source: `supabase/migrations/20260912000000_recruiting_client_decisions.sql:59`, `src/components/recruiting/role-pipeline.tsx:460`, `src/components/recruiting/candidate-panel.tsx`.

### 3. Date added is actually stage-entry date — code-confirmed

The role table labels a column Date added but renders `stage_entered_at`, which changes when the person moves stages. Use the role-membership `created_at` for Date added and show Time in stage separately.

Source: `src/components/recruiting/role-pipeline.tsx:460` and `:501`.

### 4. All profiles is only the intake stage — reproduced live and code-confirmed

The role had two active candidates but All profiles displayed only one. This tab filters `stage = all_profiles`; it is not a view of all candidates. The hint Awaiting a rating is also imprecise: candidates rated below threshold remain there.

Provide an explicit all-candidates view across stages, and use New profiles / Needs assessment for the intake stage, or otherwise make the scope unmistakable.

### 5. Import handling does not preserve the requested multi-vendor CRM data — code-confirmed

- The UI cannot enter a generic external/Upwork identity even though the backend has an `external` identity kind.
- Source is largely recorded as an import method such as csv or url_paste. Source/vendor and import batch are not modeled in the visible workflow.
- Unknown CSV columns are ignored; score and custom role columns are not mapped.
- Import from sourcing uses the result title as the candidate's full name and passes empty detail fields. This explains the long search-result titles and blank company/designation/experience cells visible in the role.
- URL-only imports guess a name from the URL; they do not fetch profile contents or enrich data.
- Invalid rows filtered out in the dialog are not sent to the backend, and the dialog closes on success. The final summary uses backend counts, so it can omit those client-side skipped rows.
- Imports have a 200-row limit. A larger-file experience needs preview, chunking/recovery or a defined import job.

Source: `src/components/recruiting/add-candidates.tsx:69`, `src/lib/recruiting/import.ts`, `src/app/api/action/route.ts:129`.

### 6. Common recovery/reuse actions are missing — code-confirmed

Rejected candidates cannot open their candidate panel or be restored from the Rejects table. Master DB is read-only and offers no Add to role. The role screen exposes no candidate export flow, while exports exist in sourcing. Core custom columns can be added/archived, but there is no visible rename, reorder, hide, or saved-view workflow.

### 7. Small consistency issues compound the confusion — code-confirmed

- Open roles lists all non-archived roles, including on_hold or closed if those statuses are set.
- The sourcing lead's Back link replaces the prior filters/page with a campaign-specific list.
- A new Master DB search retains the old page parameter, which can produce an empty page for matching results on an earlier page.
- Role tab URLs recreate search parameters with only stage, and the parent remounts the entire workspace using a key containing the route and filters.
- A large stage's Select all visible action can exceed the mutation endpoints' 200-candidate limit.

## Why navigation feels slow

### Confirmed work in the current implementation

1. **The shell is inside the page.** `AppShell` is rendered by `Workspace`, after all server data has loaded. The route's loading fallback replaces it, so the sidebar disappears. Put stable navigation in a persistent layout and load the changing content area independently.
2. **Auth is checked in two layers.** `proxy.ts` calls `getUser()`, and `admin()` calls it again before checking the operator profile. Measure those calls and remove avoidable repeated work while retaining session refresh and current operator authorization.
3. **Every workspace loads clients and active search runs first.** The role itself is fetched after that gate. Every client-scoped view also loads all client campaigns, including recruiting views that do not display them.
4. **The role inbox waits for hidden features.** It fetches candidate rows/count inputs/custom fields, then share-link data, then up to 200 sourcing prospects for a dialog that may never be opened. Load dialog data when needed and parallelize truly independent requests.
5. **Full candidate records load for the table.** `select("*,candidates(*)")` includes notes, screening, custom data, and all candidate fields. Load displayed fields first; fetch detail on demand.
6. **Stage rows and count inputs are unpaginated.** One query loads all stage records; another retrieves each role membership's stage and counts in JavaScript. Use database aggregates for counts and deterministic server pagination for rows. Without this, large roles may also be truncated by the configured Data API row cap.
7. **Many saves refresh the entire route.** Rating, outcome, detail, and stage changes call `router.refresh()`. Update the affected row/counts and invalidate the appropriate queries. Retain correct rollback/error handling.
8. **All major page UIs share a large client entry.** `workspace.tsx` statically imports recruiting and sourcing views. Split by feature/route and load heavy dialogs on demand; measure bundle sizes before choosing a strategy.
9. **The original sourcing views add work.** Leads load rows, counts, review metrics, and campaigns. Lead detail loads history even if closed. Settings retrieves all suppressions without pagination. Defer supporting information and bound list queries.
10. **Active sourcing runs refresh whichever workspace is open.** When runs exist, polling can refresh recruiting pages too. No active run was observed during this inspection; this is a conditional source of extra work.

Source entry points: `src/proxy.ts:22`, `src/lib/server/db.ts:50`, `src/app/[[...path]]/page.tsx:46`, `:207`, `:233`, `:287`, `:477`, `:490`, `src/components/workspace.tsx:163`, `src/components/shell/AppShell.tsx`.

### What remains to measure

- Cold versus warm client/role/stage navigation: time to usable table, request count, response bytes, and server timing.
- Auth/network time versus actual query time, with the real deployment/database regions checked before attributing latency to infrastructure.
- Query plans for membership filtering, stage counts, text search, and analytics. Existing indexes are present; additions should follow measured query plans.
- Bundle/hydration cost and the effect of large candidate/custom-column datasets.

Do not remove authenticated data protections or broadly cache private records as a speed shortcut. Reuse data within the correct session/scope and invalidate it after changes.

## Proposed role workspace

- Breadcrumb: Clients / Client name / Role name.
- Compact header: role title, status, candidate total, Add candidates, Share shortlist, More.
- One clear five-stage strip with trustworthy counts.
- One toolbar: Search, Filters, Sort, Columns, Saved views, Export.
- Table starts with Candidate (name + profile links), Designation/company, Source, Score, Next action, and relevant stage-specific fields.
- Clicking a candidate opens a side panel and preserves the table's search, filters, selection, and scroll.
- Client decisions and interview details are visible in the same workspace.
- Activity and source evidence are accessible without becoming the default reading surface.
- Analytics and rejected/archived records remain secondary, explicit views.

## Recommended implementation sequence

### Change 1 — Make Clients → Roles the default and stabilize navigation

Open a client's roles directly, simplify sidebar/header, keep the shell mounted, remove unnecessary sourcing/campaign loads from role-list requests, and fix the misleading counts. Preserve access to existing sourcing data through a secondary entry.

Acceptance: opening a client reaches roles; sidebar remains usable while loading; role counts remain consistent across views; no candidate/campaign data is deleted; measured navigation baseline and after-change results are recorded.

### Change 2 — Build the everyday candidate workspace

Create the unified stage table, server search/filter/sort/pagination, useful default columns, and a candidate side panel. Fix date labeling, return-state preservation, missing profile/source access, and rejection recovery. Add role-level exports.

Acceptance: filters/counts/exports agree across all pages, candidate review preserves position, and large roles do not depend on fetching every record.

### Change 3 — Make imports work for real vendors

File upload and spreadsheet paste, column mapping, source/vendor identity, custom-field/score mapping, duplicate preview, and row-error results. Connect optional sourcing adapters to the selected role. Preserve evidence, provenance, existing notes, and identity rules when consolidating records.

Acceptance: representative LinkedIn, Upwork, vendor, and custom CSV inputs can be mapped without losing requested fields; repeated imports remain idempotent; source identifiers do not collide across vendors.

### Change 4 — Complete assessment and client handoff

Add external score ingestion or AI scoring according to the selected operating method, explanations and override, a straightforward threshold action, recruiter screening actions, client-review presets, and visible client responses. Unify offer-stage/outcome actions.

Acceptance: the team can tell who assessed a candidate, why they qualified, which action is next, and what the client decided without switching between unrelated screens.

### Change 5 — Finish the visual system and reporting

Apply consistent spacing/type/actions across remaining screens, saved views, follow-up queues, and readable funnel/source/placement reporting. Verify mobile layouts, keyboard interaction, loading/error/empty states, and measured performance at realistic data volumes.

Each change should be independently reviewable and verified before moving to the next. The existing role/candidate/membership structure, event history, custom-field foundation, and transactional writes can be retained.
