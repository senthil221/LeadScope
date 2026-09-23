# Recruiting CRM implementation plan

Status: proposed plan, 15 September 2026. No application changes implemented.

## Product objective

Give recruiters one clear place to work: **Client → Role → Candidates**.

Each role supports **Profiles → AI shortlisted → Recruiter shortlisted → Client shortlisted → Offer sent**, with rejection, hold, and offer outcomes handled clearly. Profiles can come from external vendors, LinkedIn, Upwork, CSV files, pasted lists, manual entry, or optional sourcing integrations.

Keep the existing master candidate and per-role membership model. Preserve current records, notes, sourcing evidence, and event history while changing the interface.

## Delivery approach

- Implement and review one phase at a time. Split larger phases into the small steps listed below.
- Begin with the primary recruiter journey; apply the same visual components throughout subsequent phases.
- Record performance before changing the affected journey and compare afterward. Separate cold loads from repeat navigation.
- Each phase ends with a working preview, appropriate checks, and a short summary of behavior/data changes.
- Do not treat this plan as authorization to enable paid sourcing or send candidate information to an AI provider. Those integrations remain a separate implementation decision.

## Phase 1 — Client and role navigation, with stable loading

**User outcome:** opening a client immediately shows its roles; navigation remains visible and responsive while content loads.

### 1A. Reorganize the main journey

- Make Roles the default client page.
- Show client role folders/rows with useful status and workload information.
- Use an understandable breadcrumb: Clients / Client / Role.
- Put New role on the client page and Add candidates inside the role.
- Move campaign/search tools to a secondary sourcing entry, retaining access to existing records.
- Remove search connection status from recruiting headers.

### 1B. Fix loading architecture and obvious count defects

- Keep the sidebar and shared header in a persistent layout.
- Show content-specific skeletons without replacing the whole workspace.
- Stop loading unused campaign/sourcing data for the role list.
- Audit repeated authentication and reference-data reads; retain current authorization checks.
- Correct Master DB and role-count behavior, using appropriately scoped counts.
- Measure client-list → client roles → role pipeline navigation.

**Completion checks:** roles open directly; sidebar stays usable during loading; counts remain consistent; existing sourcing routes/data remain accessible; before/after measurements are recorded.

## Phase 2 — The daily candidate workspace

**User outcome:** recruiters can find, compare, edit, and move candidates without losing their place.

### 2A. Build the role table

- Keep the five-stage progression visually prominent.
- Resolve the ambiguous All profiles label: distinguish the intake queue from a view of everyone in the role.
- Add server-side search, filters, sorting, pagination, and matching counts.
- Default columns: candidate/profile links, designation/company, source, score, stage-specific next action, and relevant dates.
- Add visible-column selection and ordering; then saved views if needed.
- Keep bulk actions clear about selected rows versus all matching candidates, and handle batch limits.
- Fix Date added to use the actual date added to the role; show time in stage separately.
- Add role candidate exports with the same scope/filter semantics as the table.

### 2B. Replace the long modal with a candidate side panel

- Show a readable summary and original profile links first.
- Separate Profile, Assessment, Recruiter screening, Client feedback, and Activity.
- Keep save/advance/reject actions visible.
- Add next/previous candidate navigation.
- Preserve search, filters, page, scroll, and useful selection state after closing the panel.
- Load heavy candidate details on demand and refresh only affected data after saves.
- Provide a deliberate restore flow for rejected candidates.

**Completion checks:** full-dataset filters/counts/exports agree; large roles are paginated; reviewing multiple candidates preserves position; stage changes and failed saves behave correctly.

## Phase 3 — Multi-source candidate imports

**User outcome:** the team can bring in real vendor spreadsheets and profile lists without manually rebuilding their data.

### 3A. One Add candidates flow

- Single candidate, bulk spreadsheet/text paste, CSV file upload, and optional sourcing.
- Preview rows and map source columns to candidate fields or custom role columns.
- Accept generic external profile identities, including Upwork/vendor references.
- Track platform/vendor separately from import method and batch.
- Preserve custom fields, source links, scores, and original evidence where supplied.

### 3B. Reliable import outcomes and reuse

- Preview duplicates and identity conflicts; avoid merging by name alone.
- Explain whether a row creates a person, adds a role membership, or matches an existing membership.
- Show row-level validation errors and retain skipped-row counts in the final summary.
- Handle files larger than a single request through bounded processing and recoverable progress.
- Make All candidates an agency-wide page with Add to role and existing memberships.
- Connect retained sourcing results to the destination role while preserving provenance.

**Completion checks:** representative vendor files import without losing mapped fields; retries do not duplicate people/memberships; source identifiers are scoped to avoid cross-vendor collisions; invalid rows are understandable and recoverable.

## Phase 4 — Assessment and AI shortlisting

**User outcome:** scores have an understandable basis, and moving qualified profiles to AI shortlisted is a clear, auditable action.

- Define role criteria and score scale.
- Store score, rationale, assessment source, date, and version separately from recruiter judgments.
- Support importing externally produced ratings and explanations.
- Add an explicit threshold preview/apply workflow and human override.
- Show missing profile information as missing rather than inventing details or a confident score.
- Keep a manually entered rating distinguishable from an AI-generated assessment.

**Decision before implementation:** use external ChatGPT/CSV scores, in-app AI scoring, or both. External imports can ship first. In-app scoring needs a chosen provider, actual profile/resume content, clear data handling, cost limits, and job progress/retry design.

**Completion checks:** score provenance is visible; threshold changes have predictable effects; manual decisions are preserved; insufficient-data and scoring failures are explicit.

## Phase 5 — Recruiter screening, client feedback, and offers

**User outcome:** a candidate can move through the requested hiring process in the same role workspace.

### 5A. Recruiter and client decisions

- Make recruiter screening and next-step actions easy to reach.
- Surface follow-up dates and a useful pending-action filter.
- Provide a client-review sharing preset and preview with appropriate visible/editable fields.
- Show client decisions, notes, and interview dates to recruiters.
- Clearly represent awaiting client review, shortlisted, and on hold within the agreed pipeline.
- Define when a client action changes stage versus recording feedback for recruiter action.

### 5B. Offer outcomes

- Unify moving to Offer sent and recording the sent event from the user's perspective.
- Show offer sent, accepted, declined, and joined with dates.
- Preserve an activity trail and provide explicit correction/recovery behavior where appropriate.

**Completion checks:** recruiters can see client responses without changing workspaces; internal notes stay internal; stage transitions and outcomes are consistent; shared-link behavior is verified in a safe test flow.

## Phase 6 — Consolidate remaining pages and finish reporting

**User outcome:** the whole application follows one consistent design and vocabulary.

- Consolidate useful Prospect sheet contact fields and exports into candidate views.
- Keep sourcing qualification evidence/history accessible through the source area or candidate detail.
- Unify Excluded and suppression administration while preserving the distinction between a role rejection and a client-wide sourcing exclusion.
- Separate provider settings and maintenance from everyday recruiter work.
- Make Analytics secondary: readable funnel, waiting time, offers/joining, and source quality.
- Apply consistent typography, spacing, table density, action hierarchy, and loading/error/empty states.
- Verify desktop/tablet/mobile layouts and keyboard/focus behavior.
- Measure larger datasets and inspect slow query plans before adding indexes or further caching.

**Completion checks:** no dead-end navigation or contradictory terminology; existing data remains reachable; responsive and keyboard checks pass; measured performance and remaining limits are documented.

## Design direction

- A compact working CRM with readable tables and useful stage colors.
- Use available screen width for candidate work; avoid large empty margins and oversized summary cards.
- One primary action per context; put maintenance actions in a secondary menu.
- Keep frequently used information visible and detailed evidence one click away.
- Use the same candidate side panel and table behaviors across the product.

## Verification for each change

- Targeted tests for affected data/transition/filter invariants.
- Lint, type checking, and production build for application changes.
- Database tests for schema, import, permissions, or transactional-rule changes.
- Authenticated browser checks with safe records; desktop plus affected responsive layouts.
- Query/navigation measurement when changing loading or data access.
- A forward migration/data-preservation plan for schema changes.

## First implementation task

**Phase 1A, followed by the necessary Phase 1B work:** make the client page a role workspace, simplify navigation, keep the shell visible during transitions, and remove irrelevant sourcing loads from that journey. Review that working change before rebuilding the candidate table.

Detailed evidence and code locations are recorded in `CRM_REVIEW.md`.
