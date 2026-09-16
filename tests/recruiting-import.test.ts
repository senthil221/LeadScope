import { describe, expect, it } from "vitest";
import {
  buildImportRow,
  isRowError,
  nameFromProfileUrl,
  parseCsv,
  csvImportPreview,
  csvToDraftRows,
  csvHeaders,
  automaticCustomColumnMappings,
  spreadsheetRowsToCsv,
  type DraftRow,
} from "../src/lib/recruiting/import";

describe("buildImportRow", () => {
  it("requires a name", () => {
    const result = buildImportRow({ name: "  ", linkedin: "https://www.linkedin.com/in/x" });
    expect(isRowError(result) && result.reason).toBe("Missing a name.");
  });
  it("requires a mergeable identity, not just a phone number", () => {
    const result = buildImportRow({ name: "Priya Nair", phone: "+919876543210" });
    expect(isRowError(result) && result.reason).toContain("LinkedIn, Naukri, or email");
  });
  it("builds a row from a LinkedIn URL and normalizes it", () => {
    const result = buildImportRow({
      name: "Priya Nair",
      linkedin: "https://in.linkedin.com/in/priya-nair?trk=x",
    });
    expect(isRowError(result)).toBe(false);
    if (!isRowError(result)) {
      expect(result.identities).toEqual([
        { kind: "linkedin", value: "https://www.linkedin.com/in/priya-nair" },
      ]);
      expect(result.fields).toEqual({});
    }
  });
  it("collects multiple identities and drops invalid ones silently", () => {
    const result = buildImportRow({
      name: "Arjun Mehta",
      linkedin: "https://www.linkedin.com/in/arjun-mehta",
      email: "not-an-email",
      phone: "+91 90000 00000",
    });
    expect(isRowError(result)).toBe(false);
    if (!isRowError(result)) {
      expect(result.identities.map((i) => i.kind).sort()).toEqual([
        "linkedin",
        "phone",
      ]);
    }
  });
  it("carries optional fields only when present, trimmed and bounded", () => {
    const result = buildImportRow({
      name: "Sana Qureshi",
      email: "sana@example.com",
      currentCompany: "  Lumenbase  ",
      totalExperienceYears: "12",
    });
    expect(isRowError(result)).toBe(false);
    if (!isRowError(result)) {
      expect(result.fields).toEqual({
        email: "sana@example.com",
        currentCompany: "Lumenbase",
        totalExperienceYears: 12,
      });
    }
  });
  it("ignores an out-of-range or non-numeric experience value", () => {
    const bad: DraftRow = { name: "X", email: "x@example.com", totalExperienceYears: "abc" };
    const result = buildImportRow(bad);
    expect(isRowError(result)).toBe(false);
    if (!isRowError(result)) expect(result.fields.totalExperienceYears).toBeUndefined();
  });
  it("persists a normalized phone number with the candidate details", () => {
    const result = buildImportRow({
      name: "Arjun Mehta",
      email: "arjun@example.com",
      phone: "+91 90000 00000",
    });
    expect(isRowError(result)).toBe(false);
    if (!isRowError(result)) expect(result.fields.phone).toBe("+919000000000");
  });
});

describe("nameFromProfileUrl", () => {
  it("title-cases a LinkedIn slug", () => {
    expect(nameFromProfileUrl("https://www.linkedin.com/in/priya-nair")).toBe(
      "Priya Nair",
    );
  });
  it("drops a trailing hash-like suffix", () => {
    expect(
      nameFromProfileUrl("https://www.linkedin.com/in/arjun-mehta-3a2b1c90"),
    ).toBe("Arjun Mehta");
  });
  it("falls back for an unparseable or empty slug", () => {
    expect(nameFromProfileUrl("not a url")).toBe("Unnamed profile");
    expect(nameFromProfileUrl("https://www.linkedin.com/in/12345678")).toBe(
      "Unnamed profile",
    );
  });
});

describe("parseCsv", () => {
  it("splits plain comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });
  it("handles quoted fields with embedded commas, newlines and escaped quotes", () => {
    const csv = 'name,notes\n"Nair, Priya","Line one\nLine two ""quoted"""';
    expect(parseCsv(csv)).toEqual([
      ["name", "notes"],
      ["Nair, Priya", 'Line one\nLine two "quoted"'],
    ]);
  });
  it("drops blank rows", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("spreadsheetRowsToCsv", () => {
  it("preserves values that need CSV quoting before shared import validation", () => {
    const text = spreadsheetRowsToCsv([
      ["Full Name", "Email", "Notes"],
      ["Priya, Nair", "priya@example.com", 'Called "last week"'],
    ]);
    expect(parseCsv(text)).toEqual([
      ["Full Name", "Email", "Notes"],
      ["Priya, Nair", "priya@example.com", 'Called "last week"'],
    ]);
  });
  it("serializes an Excel date as an ISO date string", () => {
    expect(spreadsheetRowsToCsv([[new Date("2026-09-16T00:00:00Z")]])).toBe(
      "2026-09-16",
    );
  });
});

describe("csvToDraftRows", () => {
  it("maps recognized headers case-insensitively regardless of order", () => {
    const csv =
      "Email,Full Name,Company\nsana@example.com,Sana Qureshi,Lumenbase";
    expect(csvToDraftRows(csv)).toEqual([
      { name: "Sana Qureshi", email: "sana@example.com", currentCompany: "Lumenbase" },
    ]);
  });
  it("ignores unrecognized columns instead of rejecting the file", () => {
    const csv = "Full Name,Astrological Sign\nPriya Nair,Leo";
    expect(csvToDraftRows(csv)).toEqual([{ name: "Priya Nair" }]);
  });
  it("returns nothing for a header-only or empty file", () => {
    expect(csvToDraftRows("Full Name,Email")).toEqual([]);
    expect(csvToDraftRows("")).toEqual([]);
  });
});

describe("csvImportPreview", () => {
  it("shows the accepted rows, rejected rows, and detected columns before import", () => {
    const preview = csvImportPreview(
      "Full Name,Email,Source system\nPriya Nair,priya@example.com,LinkedIn\nNo Identity,,Manual",
    );
    expect(preview.totalRows).toBe(2);
    expect(preview.validRows.map((row) => row.name)).toEqual(["Priya Nair"]);
    expect(preview.invalidRows).toHaveLength(1);
    expect(preview.recognizedColumns).toEqual(["Full Name", "Email"]);
    expect(preview.ignoredColumns).toEqual(["Source system"]);
  });
  it("handles a UTF-8 byte-order mark in the first header", () => {
    expect(csvToDraftRows("\uFEFFFull Name,Email\nPriya Nair,priya@example.com")).toEqual([
      { name: "Priya Nair", email: "priya@example.com" },
    ]);
  });
  it("maps matching role columns and converts their typed values", () => {
    const fields = [
      { key: "notice_period", label: "Notice period", kind: "number" as const, options: [] },
      { key: "open_to_relocate", label: "Open to relocate", kind: "boolean" as const, options: [] },
      { key: "fit", label: "Fit", kind: "select" as const, options: ["Strong", "Possible"] },
    ];
    const text = "Full Name,Email,Notice Period,Open to relocate,Fit\nPriya Nair,priya@example.com,30,yes,Strong";
    const mappings = automaticCustomColumnMappings(csvHeaders(text), fields);
    expect(mappings).toEqual({ notice_period: 2, open_to_relocate: 3, fit: 4 });
    const preview = csvImportPreview(text, fields, mappings);
    expect(preview.validRows[0].custom).toEqual({
      notice_period: 30,
      open_to_relocate: true,
      fit: "Strong",
    });
    expect(preview.ignoredColumns).toEqual([]);
  });
  it("holds a row when a mapped dropdown value is not valid for the role", () => {
    const preview = csvImportPreview(
      "Full Name,Email,Fit\nPriya Nair,priya@example.com,Weak",
      [{ key: "fit", label: "Fit", kind: "select", options: ["Strong"] }],
      { fit: 2 },
    );
    expect(preview.validRows).toHaveLength(0);
    expect(preview.invalidRows[0].reason).toContain("Fit");
  });
});
