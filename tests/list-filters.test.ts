import { describe, it, expect } from "vitest";
import { profileSearchTerm, serializeRoleFilters } from "../src/lib/recruiting/list-filters";
import { roleCandidateListFilters } from "../src/lib/server/recruiting";

describe("full dataset filter contract", () => {
  it("searches copied LinkedIn URLs and formatted Indian phone numbers", () => {
    expect(profileSearchTerm("https://in.linkedin.com/in/test-person/?trk=abc")).toBe("linkedin.com/in/test-person");
    expect(profileSearchTerm("+91 98765 43210")).toBe("9876543210");
    expect(profileSearchTerm("  person@example.com  ")).toBe("person@example.com");
  });
  it("retains every filter for selection, saved views and exports", () => {
    const result = serializeRoleFilters(new URLSearchParams("q=Test&source=naukri&source_detail=Upload&contact=missing&stale=1&rating=unrated&entered_from=2026-10-01&entered_to=2026-10-03&sort=updated&page=4&stage=all_profiles"));
    expect(result).toEqual({ q:"Test", source:"naukri", source_detail:"Upload", contact:"missing", stale:"1", rating:"unrated", entered_from:"2026-10-01", entered_to:"2026-10-03", sort:"updated" });
    expect(roleCandidateListFilters(result)).toMatchObject({ contact:"missing", stale:true, sourceDetail:"Upload", rating:"unrated", sort:"updated" });
  });
});
