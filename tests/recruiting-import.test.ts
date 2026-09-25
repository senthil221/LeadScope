import { describe, expect, it } from "vitest";
import {
  buildImportRow,
  isRowError,
  nameFromProfileUrl,
  parseCsv,
  csvImportPreview,
  csvToDraftRows,
  skippedRowsCsv,
  skippedReasonHeader,
  csvHeaders,
  automaticCustomColumnMappings,
  spreadsheetRowsToCsv,
  type DraftRow,
} from "../src/lib/recruiting/import";

describe("buildImportRow", () => {
  // A name is not asked for. The candidate record cannot hold a blank one, so
  // a missing name is read off the profile slug as a placeholder.
  it("reads a missing name off the profile URL rather than refusing the row", () => {
    const result = buildImportRow({
      name: "  ",
      linkedin: "https://www.linkedin.com/in/priya-nair",
    });
    expect(isRowError(result)).toBe(false);
    expect(!isRowError(result) && result.name).toBe("Priya Nair");
  });
  it("keeps a typed name in preference to the slug", () => {
    const result = buildImportRow({
      name: "Priya Nair",
      linkedin: "https://www.linkedin.com/in/pn-2847",
    });
    expect(!isRowError(result) && result.name).toBe("Priya Nair");
  });
  it("still refuses a row with neither a name nor anything to derive one from", () => {
    const result = buildImportRow({ name: "", email: "someone@example.com" });
    // An email is a mergeable identity, but it is not a profile to read a name
    // from, so this row genuinely has no name available.
    expect(isRowError(result) && result.reason).toBe("Missing a name.");
  });
  it("requires a mergeable identity, not just a phone number", () => {
    const result = buildImportRow({ name: "Priya Nair", phone: "+919876543210" });
    expect(isRowError(result) && result.reason).toContain("LinkedIn, Naukri, or email");
  });
  it("can require a LinkedIn identity for recruiter candidate intake", () => {
    const result = buildImportRow(
      { name: "Priya Nair", email: "priya@example.com" },
      { requireLinkedin: true },
    );
    expect(isRowError(result) && result.reason).toBe(
      "Add a valid LinkedIn profile URL.",
    );
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
  it("marks a row for attention when an optional contact value is invalid", () => {
    const result = buildImportRow({
      name: "Arjun Mehta",
      linkedin: "https://www.linkedin.com/in/arjun-mehta",
      email: "not-an-email",
      phone: "+91 90000 00000",
    });
    expect(isRowError(result) && result.reason).toContain("valid email");
  });
  it("refuses a mobile number that is not ten digits", () => {
    const result = buildImportRow({
      name: "Arjun Mehta",
      linkedin: "https://www.linkedin.com/in/arjun-mehta",
      phone: "90000",
    });
    expect(isRowError(result) && result.reason).toContain("10 digit");
  });
  it("drops an alternate that repeats the primary number", () => {
    const result = buildImportRow({
      name: "Arjun Mehta",
      linkedin: "https://www.linkedin.com/in/arjun-mehta",
      phone: "9000000000",
      alternatePhone: "+91 90000 00000",
    });
    expect(isRowError(result)).toBe(false);
    if (!isRowError(result)) {
      expect(result.fields.phone).toBe("9000000000");
      expect(result.fields.alternatePhone).toBeUndefined();
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
  it("stores both numbers as bare ten digits, whatever was pasted", () => {
    const result = buildImportRow({
      name: "Arjun Mehta",
      email: "arjun@example.com",
      phone: "+91 90000 00000",
      alternatePhone: "098765-43210",
    });
    expect(isRowError(result)).toBe(false);
    if (!isRowError(result)) {
      expect(result.fields.phone).toBe("9000000000");
      expect(result.fields.alternatePhone).toBe("9876543210");
      // The alternate is candidate data, never an identity to merge on.
      expect(result.identities.filter((i) => i.kind === "phone")).toHaveLength(1);
    }
  });
  it("takes a per-row source from the file when it names one of the six", () => {
    const result = buildImportRow({
      name: "Priya Nair",
      email: "priya@example.com",
      source: "naukri",
    });
    expect(isRowError(result)).toBe(false);
    if (!isRowError(result)) expect(result.source).toBe("naukri");
  });
  it("ignores a source the list does not hold, leaving the batch setting", () => {
    const result = buildImportRow({
      name: "Priya Nair",
      email: "priya@example.com",
      source: "Upwork",
    });
    expect(isRowError(result)).toBe(false);
    if (!isRowError(result)) expect(result.source).toBeUndefined();
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
  it("accepts First Name from CSV exports as the candidate name", () => {
    const csv = [
      '"First Name","LinkedIn"',
      '"Ajit","http://www.linkedin.com/in/ajitindia"',
      '"Joel","https://www.linkedin.com/in/joellimjohan"',
      '"Ramnik","https://www.linkedin.com/in/rrajvanshi"',
    ].join("\n");
    expect(csvToDraftRows(csv)).toEqual([
      { name: "Ajit", linkedin: "http://www.linkedin.com/in/ajitindia" },
      { name: "Joel", linkedin: "https://www.linkedin.com/in/joellimjohan" },
      { name: "Ramnik", linkedin: "https://www.linkedin.com/in/rrajvanshi" },
    ]);
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
  it("reads a Source column into the row's own source", () => {
    const preview = csvImportPreview(
      "Full Name,Email,Source\nPriya Nair,priya@example.com,LinkedIn Recruiter",
    );
    expect(preview.validRows[0].source).toBe("linkedin");
    expect(preview.recognizedColumns).toContain("Source");
  });
  it("holds CSV rows without LinkedIn when intake requires it", () => {
    const preview = csvImportPreview(
      "Full Name,Email\nPriya Nair,priya@example.com",
      [],
      {},
      { requireLinkedin: true },
    );
    expect(preview.validRows).toHaveLength(0);
    expect(preview.invalidRows[0].reason).toBe(
      "Add a valid LinkedIn profile URL.",
    );
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

describe("rows the file cannot import", () => {
  const sheet = [
    "Full Name,LinkedIn URL,Mobile,Alternate Mobile",
    "Shrinath Bedarkar,Sent by Purnima,9762357715,8605178721",
    "Abdul Ahad,https://www.linkedin.com/in/abdul-ahad,7908272276,",
    '"Roy, Chayan",(8) Chayan | LinkedIn,,',
  ].join("\n");
  const preview = () => csvImportPreview(sheet, [], {}, { requireLinkedin: true });

  it("points at the line in the file each skipped row came from", () => {
    const { validRows, invalidRows } = preview();
    expect(validRows).toHaveLength(1);
    expect(invalidRows.map((error) => error.line)).toEqual([2, 4]);
    expect(invalidRows[0].reason).toContain("LinkedIn");
  });

  it("writes the skipped rows back out as a file to fix and re-upload", () => {
    const rows = parseCsv(skippedRowsCsv(sheet, preview().invalidRows));
    expect(rows[0]).toEqual([
      "Full Name", "LinkedIn URL", "Mobile", "Alternate Mobile", skippedReasonHeader,
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1].slice(0, 4)).toEqual([
      "Shrinath Bedarkar", "Sent by Purnima", "9762357715", "8605178721",
    ]);
    // A cell with a comma in it survives the round trip.
    expect(rows[2][0]).toBe("Roy, Chayan");
    expect(rows[2][4]).toContain("LinkedIn");
  });

  it("imports the corrected file once the URLs are real", () => {
    const fixed = sheet
      .replace("Sent by Purnima", "https://www.linkedin.com/in/shrinath-bedarkar")
      .replace("(8) Chayan | LinkedIn", "https://www.linkedin.com/in/chayan-roy");
    const { validRows, invalidRows } = csvImportPreview(fixed, [], {}, { requireLinkedin: true });
    expect(invalidRows).toHaveLength(0);
    expect(validRows).toHaveLength(3);
  });
});
