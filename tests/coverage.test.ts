import { describe, expect, it } from "vitest";
import { coverageNotes, type Coverage } from "../src/lib/recruiting/coverage";

const base = (providers: Coverage["providers"], lookups: Partial<Coverage["lookups"]> = {}): Coverage => ({
  since: null,
  lookups: { total: 40, found: 30, none: 10, failed: 0, pending: 0, ...lookups },
  providers,
});
const s = (provider: Coverage["providers"][number]["provider"], checked: number, found: number, errors = 0) => ({ provider, checked, found, numbers: found, errors });

describe("coverage notes", () => {
  it("says so when there is nothing yet", () => {
    expect(coverageNotes(base([], { total: 0, found: 0, none: 0 }))).toEqual([expect.stringContaining("No mobile lookups")]);
  });
  it("names the best source, what the fallbacks add, and the free answers", () => {
    const notes = coverageNotes(base([s("database", 40, 4), s("signalhire", 36, 20), s("apollo", 16, 6), s("bettercontact", 10, 0)]), { bettercontact: 20 });
    expect(notes[0]).toBe("75% of lookups ended with at least one number (30 of 40).");
    expect(notes).toContain("4 lookups were answered from numbers already on file, without spending a credit.");
    expect(notes).toContain("Of the people found, SignalHire found 20, Apollo found 6.");
    expect(notes).toContain("Apollo found 6 people the sources before it missed (38% of what reached it).");
    expect(notes).toContain("BetterContact has found nobody in 10 tries after the earlier sources missed. It may not be worth its credits as a fallback.");
    expect(notes.some((n) => n.startsWith("BetterContact has 20 credits left"))).toBe(true);
  });
  it("flags a source that was never asked, errors, and a small sample", () => {
    const notes = coverageNotes(base([s("signalhire", 5, 5, 1)], { total: 5, found: 5, none: 0 }));
    expect(notes).toContain("Apollo was not asked in this period: the earlier sources answered every lookup, or it was not set up.");
    expect(notes).toContain("SignalHire returned 1 error. Check its key and balance above.");
    expect(notes).toContain("Only 5 lookups so far; rates will steady as more run.");
  });
});
