import { describe, expect, it } from "vitest";
import {
  isSingleValue,
  parsePastedBlock,
  PASTE_MAX_COLUMNS,
  PASTE_MAX_ROWS,
} from "../src/lib/recruiting/paste";

describe("pasting a block out of a spreadsheet", () => {
  it("reads tab-separated rows into a grid", () => {
    expect(parsePastedBlock("Pune\tZoho\nHyderabad\tFreshdesk")).toEqual([
      ["Pune", "Zoho"],
      ["Hyderabad", "Freshdesk"],
    ]);
  });

  it("accepts the line endings Excel and Sheets each produce", () => {
    const expected = [["a", "b"], ["c", "d"]];
    expect(parsePastedBlock("a\tb\r\nc\td")).toEqual(expected);
    expect(parsePastedBlock("a\tb\rc\td")).toEqual(expected);
    expect(parsePastedBlock("a\tb\nc\td")).toEqual(expected);
  });

  it("drops the terminating newline rather than pasting an empty row", () => {
    expect(parsePastedBlock("a\tb\nc\td\n")).toHaveLength(2);
    // Two trailing newlines really are a trailing blank row.
    expect(parsePastedBlock("a\tb\n\n")).toHaveLength(2);
  });

  it("keeps empty cells so columns stay aligned", () => {
    expect(parsePastedBlock("Pune\t\tSenior SDE")).toEqual([
      ["Pune", "", "Senior SDE"],
    ]);
  });

  it("trims the padding a spreadsheet export leaves around values", () => {
    expect(parsePastedBlock("  Pune \t Zoho  ")).toEqual([["Pune", "Zoho"]]);
  });

  it("caps a runaway paste", () => {
    const rows = Array.from({ length: 500 }, (_, i) => `r${i}`).join("\n");
    expect(parsePastedBlock(rows)).toHaveLength(PASTE_MAX_ROWS);
    const columns = Array.from({ length: 100 }, (_, i) => `c${i}`).join("\t");
    expect(parsePastedBlock(columns)[0]).toHaveLength(PASTE_MAX_COLUMNS);
  });

  it("treats one value as an ordinary paste the grid should ignore", () => {
    expect(isSingleValue(parsePastedBlock("Pune"))).toBe(true);
    expect(isSingleValue(parsePastedBlock("Pune\tZoho"))).toBe(false);
    expect(isSingleValue(parsePastedBlock("Pune\nZoho"))).toBe(false);
  });

  it("returns nothing for an empty clipboard", () => {
    expect(parsePastedBlock("")).toEqual([]);
  });
});
