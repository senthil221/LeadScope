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
} from "../src/lib/recruiting/stages";
import {
  normalizeIdentity,
  dedupeIdentities,
  hasMergeableIdentity,
  type Identity,
} from "../src/lib/recruiting/identity";

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
    expect(roleDashboardMigration).toContain("rc.stage='recruiter_shortlisted'");
    expect(roleDashboardMigration).toContain("rc.follow_up_at<=current_date");
    expect(roleDashboardMigration).toContain("coalesce(rc.outcome,'offer_sent')");
  });
});
