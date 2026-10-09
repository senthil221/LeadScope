import { describe, expect, it } from "vitest";
import { ctcMaxLabel, roleAgeDays, roleStatusLabel, shareCodeFromSegment, shareLinkPath, slug } from "../src/lib/recruiting/roles";

describe("role helpers", () => {
  it("labels the stored statuses", () => {
    expect(["open", "hired", "closed"].map(roleStatusLabel)).toEqual(["Active", "Hired", "Closed"]);
  });
  it("shows the top of the CTC range, or the old text when there is no range", () => {
    expect(ctcMaxLabel({ ctc_min: 12, ctc_max: 18 })).toBe("18 LPA");
    expect(ctcMaxLabel({ ctc_min: 12.5, ctc_max: null })).toBe("12.5+ LPA");
    expect(ctcMaxLabel({ ctc: "Negotiable", ctc_min: null, ctc_max: null })).toBe("Negotiable");
    expect(ctcMaxLabel({})).toBe("");
  });
  it("counts whole days since opening in India time", () => {
    const now = new Date("2026-10-10T20:00:00Z"); // 11 Oct, 01:30 in India
    expect(roleAgeDays("2026-10-01", now)).toBe(10);
    expect(roleAgeDays("2026-10-11", now)).toBe(0);
    expect(roleAgeDays("2026-10-20", now)).toBe(0);
    expect(roleAgeDays(undefined, now)).toBeNull();
  });
  it("builds a short readable client link and reads its code back", () => {
    expect(slug("M&E Lead")).toBe("me-lead");
    expect(slug("Myna Mahila")).toBe("myna-mahila");
    expect(shareLinkPath("Myna Mahila", "M&E Lead", "k7q2xm")).toBe("/c/myna-mahila/me-lead-k7q2xm");
    expect(shareCodeFromSegment("me-lead-k7q2xm")).toBe("k7q2xm");
    expect(shareCodeFromSegment("me-lead-K7Q2XM")).toBeNull();
    expect(shareCodeFromSegment("me-lead")).toBeNull();
  });
});
