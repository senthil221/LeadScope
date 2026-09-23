import { describe, expect, it } from "vitest";
import {
  templateColumns,
  templateCsv,
  templateFileName,
  importStages,
} from "@/lib/recruiting/template";
import { candidateColumns } from "@/lib/recruiting/columns";
import { csvImportPreview, parseCsv } from "@/lib/recruiting/import";

describe("import template", () => {
  it("leads every stage with the two columns a row cannot be created without", () => {
    for (const stage of importStages) {
      const columns = templateColumns(stage);
      expect(columns.map((column) => column.header).slice(0, 2)).toEqual([
        "Full Name",
        "LinkedIn URL",
      ]);
      expect(columns.filter((column) => column.required).map((column) => column.header)).toEqual([
        "Full Name",
        "LinkedIn URL",
      ]);
    }
  });

  it("asks a triage stage for less than a detail stage", () => {
    const triage = templateColumns("all_profiles").map((column) => column.header);
    const detail = templateColumns("recruiter_shortlisted").map((column) => column.header);
    expect(triage).toEqual(["Full Name", "LinkedIn URL"]);
    expect(detail).toEqual([
      "Full Name",
      "LinkedIn URL",
      "Phone",
      "Email",
      "Location",
      "Company",
      "Designation",
      "Experience (years)",
      "CTC",
      "Qualification",
    ]);
  });

  it("never offers a column the stage's grid does not show", () => {
    for (const stage of importStages) {
      const shown = new Set(candidateColumns(stage, []).map((column) => column.label));
      // Full Name is the grid's frozen first column rather than a stage column.
      for (const column of templateColumns(stage).slice(1)) {
        expect(shown.size).toBeGreaterThan(0);
        expect(
          shown.has(column.header) ||
            // Headers are spelled out where the grid abbreviates for width.
            ["LinkedIn URL", "Phone", "Experience (years)", "Qualification"].includes(column.header),
        ).toBe(true);
      }
    }
  });

  it("writes a header row and one example row that parse back to the same columns", () => {
    const rows = parseCsv(templateCsv("recruiter_shortlisted"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(templateColumns("recruiter_shortlisted").map((c) => c.header));
    expect(rows[1]).toHaveLength(rows[0].length);
  });

  it("produces an example row that imports cleanly against its own template", () => {
    const preview = csvImportPreview(templateCsv("recruiter_shortlisted"), [], {}, {
      requireLinkedin: true,
    });
    expect(preview.invalidRows).toEqual([]);
    expect(preview.ignoredColumns).toEqual([]);
    expect(preview.validRows).toHaveLength(1);
    expect(preview.validRows[0].name).toBe("Priya Raman");
    expect(preview.validRows[0].fields).toMatchObject({
      currentCompany: "Zoho",
      currentCtc: "42 LPA",
      highestQualification: "B.E. Computer Science",
      totalExperienceYears: 11,
    });
  });

  it("names the file after the role and the stage", () => {
    expect(templateFileName("Testing Manager", "client_shortlisted")).toBe(
      "testing-manager-client-shortlisted-import-template.csv",
    );
    expect(templateFileName("  ", "all_profiles")).toBe("role-all-profiles-import-template.csv");
  });
});
