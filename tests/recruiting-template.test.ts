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

  it("writes headers and nothing else", () => {
    for (const stage of importStages) {
      const rows = parseCsv(templateCsv(stage));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(templateColumns(stage).map((c) => c.header));
    }
  });

  // An example row inside the file becomes a real candidate the first time
  // somebody uploads the template without deleting it, which is exactly what
  // happened in production. A downloaded template must import nobody.
  it("imports nobody when uploaded untouched", () => {
    for (const stage of importStages) {
      const preview = csvImportPreview(templateCsv(stage), [], {}, { requireLinkedin: true });
      expect(preview.validRows).toEqual([]);
      expect(preview.invalidRows).toEqual([]);
      expect(preview.totalRows).toBe(0);
    }
  });

  it("names every column the parser recognises, so no column is silently dropped", () => {
    for (const stage of importStages) {
      const headers = templateColumns(stage).map((column) => column.header);
      const filled = [
        headers.join(","),
        headers
          .map((header) =>
            header === "LinkedIn URL"
              ? "https://www.linkedin.com/in/test-person"
              : header === "Experience (years)"
                ? "4"
                : header === "Email"
                  ? "test@example.com"
                  : header === "Phone"
                    ? "+919876543210"
                    : "value",
          )
          .join(","),
      ].join("\r\n");
      const preview = csvImportPreview(filled, [], {}, { requireLinkedin: true });
      expect(preview.ignoredColumns).toEqual([]);
      expect(preview.validRows).toHaveLength(1);
    }
  });

  it("names the file after the role and the stage", () => {
    expect(templateFileName("Testing Manager", "client_shortlisted")).toBe(
      "testing-manager-client-shortlisted-import-template.csv",
    );
    expect(templateFileName("  ", "all_profiles")).toBe("role-all-profiles-import-template.csv");
  });
});
