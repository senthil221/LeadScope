import { describe, expect, it } from "vitest";
import { coverageRows, hitRate } from "../src/lib/recruiting/coverage";

describe("mobile coverage rows", () => {
  it("lists every source in lookup order, filling in ones not asked yet", () => {
    const rows = coverageRows({ since: null, lookups: { total: 11, found: 6, none: 5, failed: 0, pending: 0 }, providers: [
      { provider: "bettercontact", checked: 8, found: 3, numbers: 3, errors: 0 },
      { provider: "signalhire", checked: 11, found: 3, numbers: 5, errors: 0 },
    ] });
    expect(rows.map((r) => r.name)).toEqual(["Already on file", "Prospect DB", "SignalHire", "Apollo", "BetterContact"]);
    expect(rows.map((r) => r.checked)).toEqual([0, 0, 11, 0, 8]);
    expect(rows[1].tag).toBe("planned");
    expect(hitRate(rows[4])).toBeCloseTo(0.375);
    expect(hitRate(rows[3])).toBe(0);
  });
});
