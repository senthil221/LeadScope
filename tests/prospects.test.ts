import { describe, expect, it } from "vitest";
import {
  prospectFilters,
  prospectColumns,
  prospectCells,
  type Prospect,
} from "../src/lib/prospects";
import { serializeExport } from "../src/lib/export";
describe("prospect sheet filters and exports", () => {
  it("bounds pagination, validates status and preserves literal search text", () => {
    expect(
      prospectFilters(
        new URLSearchParams("page=-3&contact=invalid&q=100%25_exact"),
      ),
    ).toEqual({ page: 1, contact: "", q: "100%_exact" });
    expect(
      prospectFilters(new URLSearchParams("page=2.8&contact=contacted")),
    ).toMatchObject({ page: 2, contact: "contacted" });
  });
  it("exports sheet columns in display order with spreadsheet formula protection", () => {
    const row = {
      title: "Example",
      canonical_url: "https://www.linkedin.com/in/example",
      snippet: "Line one\nLine two",
      contact_status: "contacted",
      notes: "=DANGEROUS()",
      source_query: 'site:linkedin.com/in/ "Chennai"',
      date_added: "2026-09-08",
      campaign_name: "Campaign",
    } as Prospect;
    const csv = serializeExport([prospectCells(row)], "csv", prospectColumns);
    expect(csv).toContain(
      '"Title","LinkedIn URL","Snippet","Prospect contacted"',
    );
    expect(csv).toContain('"Contacted"');
    expect(csv).toContain("'=DANGEROUS()");
    expect(
      serializeExport([prospectCells(row)], "tsv", prospectColumns),
    ).toContain("Line one Line two");
  });
});
