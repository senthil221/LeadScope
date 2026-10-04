import { describe, expect, it } from "vitest";
import { roleStageUrl } from "../src/lib/recruiting/navigation";
import { nextStage, isPipelineStage } from "../src/lib/recruiting/stages";
describe("stage navigation", () => {
  it("clears every stage filter when moving to another stage", () => {
    const search = "stage=profile_shortlisted&q=person&source=csv&source_detail=batch&rating=unrated&entered_from=2026-01-01&entered_to=2026-02-01&sort=rating_high&page=3&bottom=1";
    const url = new URL(roleStageUrl("/roles/role", search, "profile_shortlisted", "later", 4), "https://example.com");
    expect([...url.searchParams.entries()]).toEqual([["stage", "later"], ["v", "4"]]);
  });
  it("retains filters when selecting the current stage", () => {
    const url = new URL(roleStageUrl("/roles/role", "q=person&source=csv&page=2", "profile_shortlisted", "profile_shortlisted"), "https://example.com");
    expect(url.searchParams.get("q")).toBe("person"); expect(url.searchParams.get("source")).toBe("csv"); expect(url.searchParams.has("page")).toBe(false);
  });
  it("keeps Later out of automatic advancement", () => {
    expect(nextStage("profile_shortlisted")).toBe("recruiter_shortlisted");
    expect(nextStage("later")).toBeNull(); expect(isPipelineStage("later")).toBe(false);
  });
});

it("clears saved-view contact and age filters, and an open profile, on stage changes", () => {
  const url=roleStageUrl("/roles/example","stage=all_profiles&contact=missing&stale=1&candidate=test","all_profiles","profile_shortlisted");
  expect(url).not.toContain("contact="); expect(url).not.toContain("stale="); expect(url).not.toContain("candidate=");
});
