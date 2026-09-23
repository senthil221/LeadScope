import { describe, expect, it } from "vitest";
import {
  candidateColumns,
  stageDefaultsToCompact,
} from "@/lib/recruiting/columns";
import { stages } from "@/lib/recruiting/stages";

describe("stage table defaults", () => {
  // Triage is scanning a long list, so the rows are tight. The later stages
  // are read one person at a time, so they get the room.
  it("starts the triage stages and rejects compact, and the rest comfortable", () => {
    expect(stages.filter(stageDefaultsToCompact)).toEqual([
      "all_profiles",
      "profile_shortlisted",
      "rejected",
    ]);
    expect(stages.filter((stage) => !stageDefaultsToCompact(stage))).toEqual([
      "recruiter_shortlisted",
      "client_shortlisted",
      "offer_sent",
    ]);
  });

  it("treats the non-stage tabs as comfortable rather than throwing", () => {
    for (const tab of ["follow_ups", "master_db", "analytics"])
      expect(stageDefaultsToCompact(tab)).toBe(false);
  });
});

describe("the Status column", () => {
  // All profiles spans every stage now, so each row has to say where its
  // person actually sits. On a stage tab that would repeat the tab's own name.
  it("appears on All profiles and nowhere else", () => {
    const has = (stage: (typeof stages)[number]) =>
      candidateColumns(stage, []).some((column) => column.id === "status");
    expect(has("all_profiles")).toBe(true);
    for (const stage of stages.filter((s) => s !== "all_profiles"))
      expect(has(stage)).toBe(false);
  });

  it("is read-only, because a stage is moved through, not typed", () => {
    const status = candidateColumns("all_profiles", []).find(
      (column) => column.id === "status",
    );
    expect(status?.editable).toBe(false);
    expect(status?.label).toBe("Status");
  });
});
