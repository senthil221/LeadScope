import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  stages,
  pipelineStages,
  stageLabels,
  nextStage,
  isPipelineStage,
  candidateSources,
  isRatingFilter,
  ratingFilters,
} from "../src/lib/recruiting/stages";
import {
  normalizeIdentity,
  dedupeIdentities,
  hasMergeableIdentity,
  type Identity,
} from "../src/lib/recruiting/identity";
import {
  roleCandidateExportCells,
  roleCandidateExportColumns,
  roleCandidateExportColumnsWithFields,
} from "../src/lib/recruiting/export";
import type { RoleCandidate, RoleField } from "../src/lib/types";

const migration = readFileSync(
  resolve("supabase/migrations/20260910061500_recruiting_foundation.sql"),
  "utf8",
);
const latestSourceMigration = readFileSync(
  resolve("supabase/migrations/20260916093000_recruiting_master_database_reuse.sql"),
  "utf8",
);
const offerMigration = readFileSync(
  resolve("supabase/migrations/20260916044004_offer_closing_workspace.sql"),
  "utf8",
);
const sourcePerformanceMigration = readFileSync(
  resolve("supabase/migrations/20260916044546_source_performance_analytics.sql"),
  "utf8",
);
const manualRatingsMigration = readFileSync(
  resolve("supabase/migrations/20260916045517_manual_decimal_ratings.sql"),
  "utf8",
);
const clientShareMigration = readFileSync(
  resolve("supabase/migrations/20260916053912_client_share_and_master_eligibility.sql"),
  "utf8",
);
const roleDashboardMigration = readFileSync(
  resolve("supabase/migrations/20260916101500_role_dashboard_counts.sql"),
  "utf8",
);
const clientDirectoryMigration = readFileSync(
  resolve("supabase/migrations/20260916103000_client_directory_counts.sql"),
  "utf8",
);
const candidateListIndexesMigration = readFileSync(
  resolve("supabase/migrations/20260916104000_candidate_list_filter_indexes.sql"),
  "utf8",
);
const roleLifecycleMigration = readFileSync(
  resolve("supabase/migrations/20260916105000_role_lifecycle_status.sql"),
  "utf8",
);
const agencyWorkQueueRepairMigration = readFileSync(
  resolve("supabase/migrations/20260916106000_repair_agency_work_queue.sql"),
  "utf8",
);
const roleStatusWorkQueueMigration = readFileSync(
  resolve("supabase/migrations/20260916107000_role_status_work_queues.sql"),
  "utf8",
);
const missingFunctionsRepairMigration = readFileSync(
  resolve("supabase/migrations/20260916108000_repair_missing_recruiting_functions.sql"),
  "utf8",
);
// Pulls the list out of `check(<column> in ('a','b'))` in the migration itself,
// so the constraint and the TypeScript union can never drift apart silently.
function checkList(column: string, sql = migration): string[] {
  const match = sql.match(
    new RegExp(`check\\(${column} in \\(([^)]*)\\)\\)`),
  );
  if (!match) throw new Error(`No CHECK constraint found for ${column}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("recruiting stages match the database constraint", () => {
  it("declares exactly the stages the role_candidates CHECK allows", () => {
    expect(checkList("stage").sort()).toEqual([...stages].sort());
  });
  it("declares exactly the sources the role_candidates CHECK allows", () => {
    expect(checkList("source", latestSourceMigration).sort()).toEqual([...candidateSources].sort());
  });
  it("keeps rejected out of the pipeline and labels every stage", () => {
    expect(pipelineStages).not.toContain("rejected");
    expect(Object.keys(stageLabels).sort()).toEqual([...stages].sort());
    expect(isPipelineStage("rejected")).toBe(false);
    expect(stageLabels.profile_shortlisted).toBe("Profile shortlisted");
  });
  it("advances through the pipeline and stops at the last stage", () => {
    expect(nextStage("all_profiles")).toBe("profile_shortlisted");
    expect(nextStage("client_shortlisted")).toBe("offer_sent");
    expect(nextStage("offer_sent")).toBeNull();
    expect(nextStage("rejected")).toBeNull();
  });
  it("only allows move_stage to target pipeline stages", () => {
    const allowed = [
      ...migration
        .matchAll(/p_to_stage not in\s*\n?\s*\(([^)]*)\)/g),
    ].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    expect(allowed.sort()).toEqual([...pipelineStages].sort());
  });
});

describe("candidate identity normalization", () => {
  it("collapses LinkedIn URL variants to one stored identity", () => {
    const variants = [
      "https://www.linkedin.com/in/priya-nair",
      "https://in.linkedin.com/in/priya-nair",
      "http://linkedin.com/in/priya-nair/",
      "www.linkedin.com/in/priya-nair",
      "  https://www.linkedin.com/in/priya-nair  ",
    ].map((raw) => normalizeIdentity("linkedin", raw));
    expect(new Set(variants.map((v) => v?.value)).size).toBe(1);
    expect(variants[0]?.value).toBe("https://www.linkedin.com/in/priya-nair");
  });
  it("rejects identities that cannot be a stable key", () => {
    expect(normalizeIdentity("linkedin", "https://example.com/in/x")).toBeNull();
    expect(normalizeIdentity("linkedin", "https://www.linkedin.com/company/x")).toBeNull();
    expect(normalizeIdentity("email", "not-an-email")).toBeNull();
    expect(normalizeIdentity("naukri", "https://example.com/profile")).toBeNull();
    expect(normalizeIdentity("phone", "12345")).toBeNull();
    expect(normalizeIdentity("linkedin", "")).toBeNull();
  });
  it("lowercases email and strips phone separators", () => {
    expect(normalizeIdentity("email", " Priya.Nair@Example.COM ")?.value).toBe(
      "priya.nair@example.com",
    );
    expect(normalizeIdentity("phone", "+91 98765 43210")?.value).toBe(
      "+919876543210",
    );
  });
  it("dedupes repeats within one import and requires a mergeable identity", () => {
    const identities = dedupeIdentities(
      [
        normalizeIdentity("linkedin", "https://www.linkedin.com/in/arjun"),
        normalizeIdentity("linkedin", "https://in.linkedin.com/in/arjun?trk=x"),
        normalizeIdentity("phone", "+91 90000 00000"),
      ].filter((x): x is Identity => x !== null),
    );
    expect(identities).toHaveLength(2);
    expect(hasMergeableIdentity(identities)).toBe(true);
    expect(
      hasMergeableIdentity([{ kind: "phone", value: "+919000000000" }]),
    ).toBe(false);
  });
});

describe("offer closing workspace", () => {
  it("keeps private offer details and queues response deadlines", () => {
    expect(offerMigration).toContain("add column offer_amount numeric(14,2)");
    expect(offerMigration).toContain("add column offer_response_due_at date");
    expect(offerMigration).toContain("create function private.save_offer_details");
    expect(offerMigration).toContain("rc.offer_response_due_at<=current_date");
  });
});

describe("candidate exports", () => {
  it("exports the current role journey without exposing private recruiter notes", () => {
    const row = {
      stage_entered_at: "2026-09-16T00:00:00.000Z",
      stage: "offer_sent",
      rating: 4.5,
      source: "linkedin",
      source_detail: "Recruiter seat",
      custom: { current_ctc: 1200000, availability: "30 days" },
      client_notes: "Available from October",
      internal_notes: "Do not export this",
      offer_amount: 1500000,
      offer_currency: "INR",
      offer_sent_on: "2026-09-15",
      offer_response_due_at: "2026-09-20",
      expected_start_at: "2026-10-01",
      outcome: "offer_sent",
      rejection_type: null,
      rejection_reason: "",
      candidates: {
        full_name: "Priya Nair",
        headline: "Senior recruiter",
        current_designation: "Recruiter",
        current_company: "Example Co",
        location: "Chennai",
        total_experience_years: 7,
        phone: "+919999999999",
        email: "priya@example.com",
      },
    } as unknown as RoleCandidate;
    const fields = [
      { key: "current_ctc", label: "Current CTC" },
      { key: "availability", label: "Availability" },
    ] as RoleField[];

    expect(roleCandidateExportColumns).not.toContain("Internal recruiter notes");
    expect(roleCandidateExportCells(row)).toContain("Offer sent");
    expect(roleCandidateExportCells(row)).toContain("Available from October");
    expect(roleCandidateExportCells(row)).not.toContain("Do not export this");
    expect(roleCandidateExportColumnsWithFields(fields).slice(-2)).toEqual([
      "Current CTC",
      "Availability",
    ]);
    expect(roleCandidateExportCells(row, fields).slice(-2)).toEqual([
      1200000,
      "30 days",
    ]);
  });
});

describe("source performance analytics", () => {
  it("counts every source through the recruiting stages", () => {
    expect(sourcePerformanceMigration).toContain("create function public.role_source_performance");
    expect(sourcePerformanceMigration).toContain("reached_ai");
    expect(sourcePerformanceMigration).toContain("reached_offer");
  });
});

describe("manual decimal ratings", () => {
  it("supports tenth-point ratings and limits rejection to recruiter review onwards", () => {
    expect(manualRatingsMigration).toContain("alter column rating type numeric(3,1)");
    expect(manualRatingsMigration).toContain("alter column rating_threshold type numeric(3,1)");
    expect(manualRatingsMigration).toContain("stage not in ('recruiter_shortlisted','client_shortlisted','offer_sent')");
  });
  it("keeps the table rating filters constrained to the supported review states", () => {
    expect(ratingFilters).toEqual(["unrated", "meets_floor", "below_floor"]);
    expect(isRatingFilter("meets_floor")).toBe(true);
    expect(isRatingFilter("any rating")).toBe(false);
  });
});

describe("client sharing and master eligibility", () => {
  it("keeps qualified candidates permanently eligible for Master DB and restricts client links", () => {
    expect(clientShareMigration).toContain("add column master_qualified_at timestamptz");
    expect(clientShareMigration).toContain("role_candidates_mark_master_qualified");
    expect(clientShareMigration).toContain("p_stage is distinct from 'recruiter_shortlisted'");
    expect(clientShareMigration).toContain("Clients can edit Notes only.");
    expect(clientShareMigration).toContain("Client links cannot move or reject candidates.");
  });
});

describe("role dashboard counts", () => {
  it("summarizes every pipeline stage and active recruiter work per role", () => {
    expect(roleDashboardMigration).toContain("create function public.role_dashboard_counts");
    expect(roleDashboardMigration).toContain("add column if not exists follow_up_at date");
    expect(roleDashboardMigration).toContain("rc.stage='recruiter_shortlisted'");
    expect(roleDashboardMigration).toContain("rc.follow_up_at<=current_date");
    expect(roleDashboardMigration).toContain("coalesce(rc.outcome,'offer_sent')");
  });
});

describe("client directory counts", () => {
  it("summarizes active roles and pipeline work in one database-side query", () => {
    expect(clientDirectoryMigration).toContain("create function public.client_directory_counts");
    expect(clientDirectoryMigration).toContain("count(distinct r.id)");
    expect(clientDirectoryMigration).toContain("left join public.roles r");
    expect(clientDirectoryMigration).toContain("rc.follow_up_at<=current_date");
  });
});

describe("candidate list indexes", () => {
  it("covers source filtering and both manual-rating sort orders", () => {
    expect(candidateListIndexesMigration).toContain(
      "role_candidates_role_stage_source_entered",
    );
    expect(candidateListIndexesMigration).toContain(
      "role_candidates_role_stage_rating_ascending",
    );
    expect(candidateListIndexesMigration).toContain(
      "role_candidates_role_stage_rating_descending",
    );
  });
});

describe("role lifecycle status", () => {
  it("adds status to the role save path and validates every lifecycle state", () => {
    expect(roleLifecycleMigration).toContain("p_status text");
    expect(roleLifecycleMigration).toContain("('open','on_hold','closed')");
    expect(roleLifecycleMigration).toContain("status=p_status");
  });
});

describe("agency work queue migration repair", () => {
  it("aliases ordered aggregates for a portable database function", () => {
    expect(agencyWorkQueueRepairMigration).toContain(
      "::integer as due_follow_ups",
    );
    expect(agencyWorkQueueRepairMigration).toContain(
      "::integer as client_review",
    );
    expect(agencyWorkQueueRepairMigration).toContain(
      "::integer as offers_in_progress",
    );
  });
});

describe("role lifecycle work queues", () => {
  it("counts only open roles in active client summaries", () => {
    expect(roleStatusWorkQueueMigration).toContain("r.status='open'");
  });
});

describe("missing recruiting functions repair", () => {
  it("restores the role stage counts and agency work queue used by the workspace", () => {
    expect(missingFunctionsRepairMigration).toContain(
      "create or replace function public.role_candidate_stage_counts",
    );
    expect(missingFunctionsRepairMigration).toContain(
      "create or replace function public.agency_today_work_queue",
    );
    expect(missingFunctionsRepairMigration).toContain("r.status='open'");
  });
});
