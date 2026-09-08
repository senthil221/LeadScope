import { describe, expect, it } from "vitest";
import { defaults, configSchema, type CampaignConfig } from "../src/lib/domain";
import { generateQueries, normalizeQuery, signature } from "../src/lib/queries";
import { canonicalLinkedIn } from "../src/lib/urls";
import {
  effectiveStatus,
  mergeAssessment,
  phraseSpans,
  qualify,
} from "../src/lib/qualification";
import { safeCell, serializeExport } from "../src/lib/export";
import { providerGuard } from "../src/lib/server/serper";
const config: CampaignConfig = {
  ...defaults,
  locations: ["Chennai"],
  roles: ["SDR", "Sales Development Representative"],
  skills: ["Prospecting"],
  requiredKeywords: ["SaaS"],
  leadExclusions: ["Recruiter"],
};
describe("query construction and signatures", () => {
  it("deduplicates input and covers strategies and locations early", () => {
    const c = configSchema.parse({
      ...config,
      locations: ["Chennai", "CHENNAI", "Bengaluru"],
      roles: ["SDR", "AE", "BDR", "Account Manager"],
    });
    const a = generateQueries(c);
    expect(c.locations).toHaveLength(2);
    expect(a.queries.slice(0, 4).map((q) => q.strategy)).toEqual([
      "focused",
      "broader",
      "focused",
      "broader",
    ]);
    expect(a.queries[2].text).toContain('"Bengaluru"');
    expect(a.queries[0].text).not.toContain("SaaS");
    expect(a.queries[0].text).not.toContain("-hiring");
    expect(a).toEqual(generateQueries(c));
  });
  it("enforces caps, quotes phrases and warns about overlength", () => {
    expect(generateQueries({ ...config, queryCap: 2 }).queries).toHaveLength(2);
    expect(generateQueries(config).queries[0].text).toContain(
      '"Sales Development Representative"',
    );
    const result = generateQueries({
      ...config,
      roles: ["r".repeat(200), "s".repeat(200), "t".repeat(200)],
    });
    expect(result.queries).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("keeps custom Boolean ordering and makes option changes distinct", () => {
    const a = 'site:linkedin.com/in/ ("SDR" OR "AE") "Chennai"';
    expect(normalizeQuery(`  ${a} `)).toBe(a);
    expect(signature(a, "in", "en")).toBe(signature(` ${a} `, "in", "en"));
    expect(signature(a, "in", "en")).not.toBe(signature(a, "us", "en"));
    expect(signature(a, "in", "en")).not.toBe(signature(a, "in", "fr"));
    expect(() => normalizeQuery("site:evil.test people")).toThrow();
    expect(() =>
      normalizeQuery("site:linkedin.com/in/ OR site:example.com"),
    ).toThrow();
    expect(() => normalizeQuery("site:linkedin.com/in/ SDR OR AE")).toThrow();
    expect(() => normalizeQuery("-site:linkedin.com/in/ SDR")).toThrow();
  });
  it("rejects missing roles and unsafe budgets", () => {
    expect(configSchema.safeParse({ ...defaults }).success).toBe(false);
    expect(configSchema.safeParse({ ...config, budget: 51 }).success).toBe(
      false,
    );
  });
});
describe("LinkedIn URL canonicalization", () => {
  it("allows real country subdomains and preserves slug case and encoding", () => {
    expect(
      canonicalLinkedIn("http://in.linkedin.com/in/Ada-Example/?trk=x#foo"),
    ).toBe("https://www.linkedin.com/in/Ada-Example");
    expect(canonicalLinkedIn("https://linkedin.com/in/%C3%A9mile")).toBe(
      "https://www.linkedin.com/in/%C3%A9mile",
    );
  });
  it.each([
    "https://linkedin.com.evil.test/in/a",
    "https://fake-linkedin.com/in/a",
    "https://www.linkedin.com/jobs/a",
    "https://linkedin.com/in/",
    "https://linkedin.com/in/a/posts",
    "ftp://linkedin.com/in/a",
    "https://x:y@linkedin.com/in/a",
    "https://linkedin.com/in/a%2Fb",
    "https://linkedin.com/in/%20",
    "https://linkedin.com:444/in/a",
  ])("rejects %s", (url) => expect(canonicalLinkedIn(url)).toBeNull());
});
describe("deterministic evidence", () => {
  const title = "Asha Example - SDR at Example";
  const snippet = "Location: Chennai. Prospecting for SaaS teams.";
  it("passes explicit supporting evidence with exact source spans", () => {
    const result = qualify(title, snippet, config);
    expect(result.status).toBe("rule_match");
    for (const criterion of Object.values(result.criteria))
      for (const span of criterion.spans)
        expect(
          (span.source === "title" ? title : snippet).slice(
            span.start,
            span.end,
          ),
        ).toBe(span.text);
  });
  it("reviews missing skill, education-only or headline-only location", () => {
    expect(
      qualify(title, "Location: Chennai. SaaS teams.", config).status,
    ).toBe("review");
    expect(
      qualify(
        title,
        "Studied at Chennai University. Prospecting and SaaS.",
        config,
      ).criteria.location.state,
    ).toBe("review");
    expect(
      qualify(`${title} - Chennai`, "Prospecting and SaaS.", config).criteria
        .location.state,
    ).toBe("review");
    expect(
      qualify(
        title,
        "Company headquarters Location: Chennai. Prospecting SaaS.",
        config,
      ).criteria.location.state,
    ).toBe("review");
  });
  it("rejects explicit different current location and reviews conflicting current locations", () => {
    expect(
      qualify(title, "Current location: Pune. Prospecting SaaS.", config)
        .status,
    ).toBe("rejected");
    expect(
      qualify(
        title,
        "Location: Chennai. Based in Pune. Prospecting SaaS.",
        config,
      ).criteria.location.state,
    ).toBe("review");
  });
  it("rejects a clearly excluded current role but not incidental words", () => {
    expect(
      qualify("Asha Example - Recruiter at Example", snippet, config).status,
    ).toBe("rejected");
    expect(
      qualify(title, `${snippet} Works with recruiters.`, config).status,
    ).toBe("rule_match");
    expect(
      qualify("Asha Example - Former SDR", snippet, config).criteria.role.state,
    ).toBe("review");
  });
  it("uses Unicode phrase boundaries and recognizes explicit contradictions", () => {
    expect(phraseSpans("éSDRx SDR SDRé", "SDR", "title")).toHaveLength(1);
    expect(
      qualify(title, "Location: Chennai. No prospecting. SaaS.", config)
        .criteria.skills.state,
    ).toBe("fail");
    expect(
      qualify(title, "Location: Chennai. Prospecting SaaS.", {
        ...config,
        requiredKeywords: ["SaaS", "enterprise"],
      }).criteria.keywords.state,
    ).toBe("review");
  });
  it("allows improved evidence and routes contradictions to review", () => {
    const weak = qualify(title, "SaaS", config),
      good = qualify(title, snippet, config),
      different = qualify(title, "Location: Pune. Prospecting SaaS.", config);
    expect(mergeAssessment(weak, good).status).toBe("rule_match");
    expect(mergeAssessment(good, different).status).toBe("review");
    expect(mergeAssessment(mergeAssessment(good, different), good).status).toBe(
      "review",
    );
  });
  it("preserves manual decisions, applies suppression, and blocks stale acceptance", () => {
    expect(effectiveStatus("rule_match", "rejected", false, true)).toBe(
      "rejected",
    );
    expect(effectiveStatus("rule_match", "accepted", true, true)).toBe(
      "suppressed",
    );
    expect(effectiveStatus("rule_match", "accepted", false, false)).toBe(
      "review",
    );
  });
});
describe("exports and credit safety", () => {
  it.each(["=IMPORTXML(1)", " +2", "\t@cmd", "-1", "\rformula"])(
    "neutralizes formula cell %s",
    (value) => expect(safeCell(value).startsWith("'")).toBe(true),
  );
  it("quotes CSV and strips structural tabs/newlines for Sheets", () => {
    expect(serializeExport([['A, "quoted"', "multi\nline"]], "csv")).toContain(
      '"A, ""quoted""","multi\nline"',
    );
    expect(serializeExport([["one\ttwo\nthree"]], "tsv")).toContain(
      "one two three",
    );
  });
  it("always refuses provider dispatch inside tests", () => {
    expect(providerGuard).toThrow("test_dispatch_forbidden");
  });
});
