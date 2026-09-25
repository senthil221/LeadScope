import { describe, expect, it } from "vitest";
import {
  candidateColumns,
  defaultVisibleColumnIds,
  stageDefaultsToCompact,
  stageShowsName,
} from "@/lib/recruiting/columns";
import { stages, type Stage } from "@/lib/recruiting/stages";

const customField = {
  key: "visa",
  label: "Visa status",
  kind: "text" as const,
  options: [],
};

const visible = (stage: Stage) =>
  defaultVisibleColumnIds(stage, candidateColumns(stage, [customField as never]));

describe("stage table defaults", () => {
  it("starts the triage stages and rejects compact", () => {
    expect(stages.filter(stageDefaultsToCompact)).toEqual([
      "all_profiles", "profile_shortlisted", "rejected",
    ]);
    expect(stageDefaultsToCompact("follow_ups")).toBe(false);
  });

  it("follows the supplied five-tab column matrix", () => {
    expect(visible("all_profiles")).toEqual([
      "linkedin", "rating", "source", "date_added", "status",
    ]);
    expect(visible("profile_shortlisted")).toEqual([
      "linkedin", "rating", "source", "date_added", "phone", "alternate_phone",
    ]);
    const detail = [
      "date_added", "linkedin", "phone", "alternate_phone", "email", "location",
      "current_company", "current_designation", "total_experience_years",
      "current_ctc", "highest_qualification", "resume", "notes", "custom:visa",
    ];
    for (const stage of ["recruiter_shortlisted", "client_shortlisted", "offer_sent"] as const)
      expect(visible(stage)).toEqual(detail);
  });

  it("shows Status only where a row's stage is not the tab it is on", () => {
    expect(stages.filter((stage) => visible(stage).includes("status"))).toEqual([
      "all_profiles",
    ]);
  });
  it("keeps Full name on the stages marked in the matrix", () => {
    expect(stages.filter((stage) => !stageShowsName(stage))).toEqual([
      "all_profiles", "profile_shortlisted",
    ]);
  });

  it("retains the earlier Rejects layout outside the supplied matrix", () => {
    expect(visible("rejected")).toEqual([
      "date_added", "linkedin", "phone", "alternate_phone", "email",
      "location", "current_company", "current_designation",
      "total_experience_years", "current_ctc", "highest_qualification",
      "resume", "notes", "custom:visa", "reject_type", "reject_reason",
    ]);
  });

  it("keeps other saved fields available for deliberate selection", () => {
    for (const stage of stages) {
      const available = candidateColumns(stage, [customField as never]);
      expect(available.map((column) => column.id)).toContain("status");
      expect(available.map((column) => column.id)).toContain("alternate_phone");
      expect(available.map((column) => column.id)).toContain("custom:visa");
      expect(available.find((column) => column.id === "status")?.editable).toBe(false);
    }
  });

  it("leads the triage tabs with the profile, its rating and its source", () => {
    for (const stage of ["all_profiles", "profile_shortlisted"] as const) {
      const available = candidateColumns(stage, []);
      expect(available.slice(0, 3).map((column) => column.id)).toEqual([
        "linkedin", "rating", "source",
      ]);
      expect(available[0].width).toBe("lg");
    }
  });
  // Everywhere else the reading order is the same idea without the hoist.
  it("keeps Source beside Rating on the stages that show a name", () => {
    for (const stage of stages.filter(stageShowsName)) {
      const ids = candidateColumns(stage, []).map((column) => column.id);
      expect(ids.indexOf("source")).toBe(ids.indexOf("rating") + 1);
    }
  });

  it("keeps alternate mobile adjacent with clearly empty cell labels", () => {
    for (const stage of stages) {
      const available = candidateColumns(stage, []);
      const ids = available.map((column) => column.id);
      expect(ids.indexOf("alternate_phone")).toBe(ids.indexOf("phone") + 1);
      expect(available.find((column) => column.id === "phone")?.placeholder).toBe("Add mobile");
      expect(available.find((column) => column.id === "alternate_phone")?.placeholder).toBe("Add alternate");
    }
  });

  it("keeps outcome fields available for deliberate selection", () => {
    for (const stage of stages) {
      const ids = candidateColumns(stage, []).map((column) => column.id);
      for (const id of ["reject_type", "reject_reason", "offer_details", "outcome"])
        expect(ids).toContain(id);
    }
  });
});
