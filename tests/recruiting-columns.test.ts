import { describe, expect, it } from "vitest";
import {
  candidateColumns,
  stageDefaultsToCompact,
  stageShowsName,
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

// The rule that replaced dealing columns out per stage. Hiding one is a click
// in the Columns menu and is remembered per tab; not offering it at all was
// the tool deciding for the people using it.
describe("every column, on every stage", () => {
  it("offers the same set whichever tab you are on", () => {
    const sorted = (stage: (typeof stages)[number]) =>
      candidateColumns(stage, [])
        .map((column) => column.id)
        .sort();
    const first = sorted(stages[0]);
    expect(first.length).toBeGreaterThan(15);
    for (const stage of stages) expect(sorted(stage)).toEqual(first);
  });

  it("includes the outcome columns, which All profiles spans as well", () => {
    for (const stage of stages) {
      const ids = candidateColumns(stage, []).map((column) => column.id);
      for (const id of ["reject_type", "reject_reason", "offer_details", "outcome"])
        expect(ids).toContain(id);
    }
  });

  it("offers a role's own custom columns everywhere too", () => {
    const field = {
      key: "visa",
      label: "Visa status",
      kind: "text" as const,
      options: [],
    };
    for (const stage of stages)
      expect(
        candidateColumns(stage, [field as never]).map((column) => column.id),
      ).toContain("custom:visa");
  });
});

describe("the Full name column", () => {
  // Only the LinkedIn URL is asked for on the way in, so on triage the name is
  // a guess derived from that URL or blank. The URL is the identity there.
  it("is hidden on the two triage tabs and shown from recruiter review on", () => {
    expect(stages.filter((stage) => !stageShowsName(stage))).toEqual([
      "all_profiles",
      "profile_shortlisted",
    ]);
  });

  // Where the name is hidden, LinkedIn is the identity: it leads the table and
  // inherits the room the name gave up, with the rating it earns beside it.
  // Where the name is shown, both stay where the registry puts them.
  it("leads the triage tabs with LinkedIn and then the rating", () => {
    for (const stage of ["all_profiles", "profile_shortlisted"] as const) {
      const columns = candidateColumns(stage, []);
      expect(columns.slice(0, 2).map((column) => column.id)).toEqual([
        "linkedin",
        "rating",
      ]);
      expect(columns[0].width).toBe("lg");
    }
    const detail = candidateColumns("recruiter_shortlisted", []);
    expect(detail[0].id).toBe("date_added");
    expect(detail.find((column) => column.id === "linkedin")?.width).toBe("sm");
  });
});

describe("the two mobile columns", () => {
  // Nothing is dealt out per stage any more: every column is offered
  // everywhere and hiding one is the reader's choice, remembered per tab.
  it("offers both numbers on every stage", () => {
    for (const stage of stages) {
      const ids = candidateColumns(stage, []).map((column) => column.id);
      expect(ids).toContain("phone");
      expect(ids).toContain("alternate_phone");
    }
  });
  it("puts the alternate immediately after the number it backs up", () => {
    for (const stage of stages) {
      const ids = candidateColumns(stage, []).map((c) => c.id);
      expect(ids.indexOf("alternate_phone")).toBe(ids.indexOf("phone") + 1);
    }
  });

  it("asks for ten digits, with no country code in the hint", () => {
    const columns = candidateColumns("recruiter_shortlisted", []);
    for (const id of ["phone", "alternate_phone"]) {
      const column = columns.find((c) => c.id === id);
      expect(column?.placeholder).toBe("98765 43210");
      expect(column?.placeholder).not.toContain("+");
    }
  });
});

describe("the Status column", () => {
  // All profiles spans every stage, so there this is the only way to tell
  // where somebody sits. On a stage tab it repeats the tab's own name, which
  // is a fair reason to hide it and the reader's call to make.
  it("appears on every stage, like every other column", () => {
    for (const stage of stages)
      expect(
        candidateColumns(stage, []).some((column) => column.id === "status"),
      ).toBe(true);
  });

  it("is read-only, because a stage is moved through, not typed", () => {
    const status = candidateColumns("all_profiles", []).find(
      (column) => column.id === "status",
    );
    expect(status?.editable).toBe(false);
    expect(status?.label).toBe("Status");
  });
});
