import { describe, expect, it } from "vitest";
import {
  draftBlocker,
  draftImportRow,
  draftLinkedIn,
  isDraftColumnEditable,
  isDraftEmpty,
  isDraftReady,
  type DraftRow,
} from "../src/lib/recruiting/drafts";

const row = (values: Record<string, string>): DraftRow => ({ key: "k", values });

describe("new rows typed into the candidate grid", () => {
  it("stays a draft until it has both a name and a profile URL", () => {
    expect(isDraftReady(row({}))).toBe(false);
    expect(isDraftReady(row({ full_name: "Asha" }))).toBe(false);
    expect(
      isDraftReady(row({ linkedin: "https://www.linkedin.com/in/asha" })),
    ).toBe(false);
    expect(
      isDraftReady(
        row({ full_name: "Asha", linkedin: "https://www.linkedin.com/in/asha" }),
      ),
    ).toBe(true);
  });

  it("accepts the profile URL shapes people actually paste", () => {
    for (const value of [
      "https://www.linkedin.com/in/asha",
      "https://linkedin.com/in/asha",
      "http://in.linkedin.com/in/asha/?trk=x",
    ])
      expect(draftLinkedIn(row({ linkedin: value }))).toBe(
        "https://www.linkedin.com/in/asha",
      );
  });

  it("refuses anything that is not a profile URL", () => {
    for (const value of [
      "https://www.linkedin.com/jobs/asha",
      "https://example.com/in/asha",
      "asha",
    ])
      expect(draftLinkedIn(row({ linkedin: value }))).toBeNull();
  });

  it("says what a part-filled row still needs", () => {
    expect(draftBlocker(row({}))).toBeNull();
    expect(draftBlocker(row({ email: "a@b.com" }))).toBe(
      "Add a name and LinkedIn URL",
    );
    expect(draftBlocker(row({ full_name: "Asha" }))).toBe("Add a LinkedIn URL");
    expect(
      draftBlocker(row({ linkedin: "https://www.linkedin.com/in/asha" })),
    ).toBe("Add a name");
    expect(
      draftBlocker(row({ full_name: "Asha", linkedin: "notaurl" })),
    ).toBe("That LinkedIn URL is not a /in/ profile");
    expect(
      draftBlocker(
        row({ full_name: "Asha", linkedin: "https://www.linkedin.com/in/asha" }),
      ),
    ).toBeNull();
  });

  it("treats a row of blanks as untouched", () => {
    expect(isDraftEmpty(row({}))).toBe(true);
    expect(isDraftEmpty(row({ full_name: "  " }))).toBe(true);
    expect(isDraftEmpty(row({ full_name: "Asha" }))).toBe(false);
  });

  it("only offers the columns a new person can be created from", () => {
    for (const id of ["full_name", "linkedin", "email", "current_ctc"])
      expect(isDraftColumnEditable(id)).toBe(true);
    for (const id of ["date_added", "source", "rating", "notes", "resume"])
      expect(isDraftColumnEditable(id)).toBe(false);
  });

  it("builds an import row with the profile URL as the identity", () => {
    const built = draftImportRow(
      row({
        full_name: "  Asha Example  ",
        linkedin: "https://linkedin.com/in/asha",
        email: "asha@example.com",
        total_experience_years: "6.5",
        current_ctc: "18 LPA",
        highest_qualification: "B.Tech",
        current_company: "",
      }),
    );
    expect(built.name).toBe("Asha Example");
    expect(built.identities).toEqual([
      { kind: "linkedin", value: "https://www.linkedin.com/in/asha" },
    ]);
    expect(built.fields).toEqual({
      email: "asha@example.com",
      totalExperienceYears: 6.5,
      currentCtc: "18 LPA",
      highestQualification: "B.Tech",
    });
  });

  it("leaves out experience that is not a number", () => {
    expect(
      draftImportRow(row({ full_name: "A", linkedin: "https://www.linkedin.com/in/a", total_experience_years: "six" })).fields,
    ).toEqual({});
  });
});
