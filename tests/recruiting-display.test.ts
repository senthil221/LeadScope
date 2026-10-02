import { describe, expect, it } from "vitest";
import { formatRecruitingDate } from "../src/lib/recruiting/display";

describe("recruiting dates", () => {
  it("uses the same calendar day for date-only fields and UTC timestamps", () => {
    expect(formatRecruitingDate("2026-10-03")).toBe("Oct 3, 2026");
    expect(formatRecruitingDate("2026-10-03T23:59:00Z")).toBe("Oct 3, 2026");
    expect(formatRecruitingDate("2026-10-03T05:30:00+05:30")).toBe("Oct 3, 2026");
  });
  it("shows a clear missing value for absent or invalid dates", () => {
    expect(formatRecruitingDate(null)).toBe("Not provided");
    expect(formatRecruitingDate(undefined)).toBe("Not provided");
    expect(formatRecruitingDate("not-a-date")).toBe("Not provided");
  });
});
