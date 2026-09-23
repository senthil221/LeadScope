import { describe, expect, it } from "vitest";
import {
  templateColumns,
  templateCsv,
  templateFileName,
} from "@/lib/recruiting/template";
import { csvImportPreview, csvTemplateColumns, parseCsv } from "@/lib/recruiting/import";

describe("import template", () => {
  it("marks the profile URL as the only required column", () => {
    const columns = templateColumns();
    expect(columns.map((column) => column.header).slice(0, 2)).toEqual([
      "Full Name",
      "LinkedIn URL",
    ]);
    // A name is filled in later, or read off the profile slug on import.
    expect(
      columns.filter((column) => column.required).map((column) => column.header),
    ).toEqual(["LinkedIn URL"]);
  });

  // The stage decides what is worth looking at, not what a candidate record
  // can hold, so the same file is right whichever stage it is going into.
  it("offers every column at every stage, with an example for each", () => {
    const columns = templateColumns();
    expect(columns.map((column) => column.header)).toEqual([
      "Full Name",
      "LinkedIn URL",
      "Naukri URL",
      "Email",
      "Phone",
      "Company",
      "Designation",
      "Location",
      "Experience (years)",
      "CTC",
      "Qualification",
      "Source",
    ]);
    for (const column of columns) expect(column.example).not.toBe("");
  });

  // A column the parser learns but the template never names would be a column
  // nobody knows they can send.
  it("names exactly the columns the parser recognises", () => {
    expect(templateColumns().map((column) => column.header)).toEqual([
      ...csvTemplateColumns,
    ]);
  });

  it("writes headers and nothing else", () => {
    const rows = parseCsv(templateCsv());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(templateColumns().map((column) => column.header));
  });

  // An example row inside the file becomes a real candidate the first time
  // somebody uploads the template without deleting it, which is exactly what
  // happened in production. A downloaded template must import nobody.
  it("imports nobody when uploaded untouched", () => {
    const preview = csvImportPreview(templateCsv(), [], {}, { requireLinkedin: true });
    expect(preview.validRows).toEqual([]);
    expect(preview.invalidRows).toEqual([]);
    expect(preview.totalRows).toBe(0);
  });

  // The point of the change: a team pastes a column of profile URLs and fills
  // the rest in afterwards, so a file with nothing but URLs has to import.
  it("imports a file of profile URLs with every other column blank", () => {
    const headers = templateColumns().map((column) => column.header);
    const blanks = ",".repeat(headers.length - 2);
    const csv = [
      headers.join(","),
      `,https://www.linkedin.com/in/asha-menon${blanks}`,
      `,https://www.linkedin.com/in/ravi-kumar${blanks}`,
    ].join("\r\n");
    const preview = csvImportPreview(csv, [], {}, { requireLinkedin: true });
    expect(preview.invalidRows).toEqual([]);
    expect(preview.validRows.map((row) => row.name)).toEqual([
      "Asha Menon",
      "Ravi Kumar",
    ]);
  });

  it("drops no column when every one of them is filled in", () => {
    const headers = templateColumns().map((column) => column.header);
    const value = (header: string) =>
      header === "LinkedIn URL"
        ? "https://www.linkedin.com/in/test-person"
        : header === "Naukri URL"
          ? "https://www.naukri.com/mnjuser/profile/test-person"
          : header === "Experience (years)"
            ? "4"
            : header === "Email"
              ? "test@example.com"
              : header === "Phone"
                ? "+919876543210"
                : "value";
    const csv = [headers.join(","), headers.map(value).join(",")].join("\r\n");
    const preview = csvImportPreview(csv, [], {}, { requireLinkedin: true });
    expect(preview.ignoredColumns).toEqual([]);
    expect(preview.validRows).toHaveLength(1);
  });

  it("names the file after the role, and after no stage", () => {
    expect(templateFileName("Testing Manager")).toBe(
      "testing-manager-import-template.csv",
    );
    expect(templateFileName("  ")).toBe("role-import-template.csv");
  });
});
