import { describe, expect, it } from "vitest";
import { addsNobody, lastPage, runResults, savedRuns, type XrayResult, type XrayRun } from "../src/lib/recruiting/xray";

const person = (slug: string, position = 1): XrayResult => ({ url: `https://www.linkedin.com/in/${slug}`, name: slug, title: slug, snippet: "", position });
const run = (pages: [number, string[]][]): XrayRun => ({ query: "q", country: "in", exhausted: false, pages: pages.map(([page, slugs]) => ({ id: `s${page}`, page, results: slugs.map((s) => person(s)) })) });

describe("X-Ray runs across several pages", () => {
  it("lists each person once, in the order Google first showed them", () => {
    expect(runResults(run([[2, ["c", "a"]], [1, ["a", "b"]]])).map((r) => r.name)).toEqual(["a", "b", "c"]);
  });
  it("treats a page with nobody new as the end of the results", () => {
    const so_far = run([[1, ["a", "b"]]]);
    expect(addsNobody(so_far, [person("b"), person("a")])).toBe(true);
    expect(addsNobody(so_far, [person("a"), person("z")])).toBe(false);
    expect(addsNobody(so_far, [])).toBe(true);
  });
  it("continues after the last page fetched without a gap", () => {
    expect(lastPage(run([[1, []], [2, []], [4, []]]))).toBe(2);
    expect(lastPage(run([]))).toBe(0);
  });
  it("groups saved pages back into searches, newest first, keeping a page's latest copy", () => {
    const saved = [
      { id: "old1", page: 1, query: "q", country: "in", created_at: "2026-10-01T00:00:00Z", results: [person("old")] },
      { id: "new1", page: 1, query: "q", country: "in", created_at: "2026-10-03T00:00:00Z", results: [person("new")] },
      { id: "p2", page: 2, query: "q", country: "in", created_at: "2026-10-03T00:01:00Z", results: [person("two")] },
      { id: "us", page: 1, query: "q", country: "us", created_at: "2026-10-02T00:00:00Z", results: [] },
    ];
    const runs = savedRuns(saved);
    expect(runs.map((r) => r.country)).toEqual(["in", "us"]);
    expect(runs[0].pages.map((p) => p.id).sort()).toEqual(["new1", "p2"]);
  });
});

import { batchResults, buildXrayQuery, xrayVariations } from "../src/lib/recruiting/xray";
const blank = { titles: "", keywords: "", location: "", company: "", exclude: "" };
describe("X-Ray search variations", () => {
  it("treats several locations as any of them, not all of them", () => {
    expect(buildXrayQuery({ ...blank, titles: "QA Manager", location: "Chennai, Bangalore" })).toBe('site:linkedin.com/in/ "QA Manager" ("Chennai" OR "Bangalore")');
  });
  it("runs one search per location or title when asked, up to five", () => {
    const input = { ...blank, titles: "QA Manager, Test Lead", location: "Chennai, Pune, Delhi, Mumbai, Hyderabad, Kochi" };
    const byPlace = xrayVariations(input, "location");
    expect(byPlace.map((v) => v.label)).toEqual(["Chennai", "Pune", "Delhi", "Mumbai", "Hyderabad"]);
    expect(byPlace[0].query).toBe('site:linkedin.com/in/ ("QA Manager" OR "Test Lead") "Chennai"');
    expect(xrayVariations(input, "titles").map((v) => v.query)).toEqual([
      'site:linkedin.com/in/ "QA Manager" ("Chennai" OR "Pune" OR "Delhi" OR "Mumbai" OR "Hyderabad" OR "Kochi")',
      'site:linkedin.com/in/ "Test Lead" ("Chennai" OR "Pune" OR "Delhi" OR "Mumbai" OR "Hyderabad" OR "Kochi")',
    ]);
  });
  it("stays one search when there is nothing to split", () => {
    expect(xrayVariations({ ...blank, titles: "QA", location: "Chennai" }, "location")).toEqual([{ label: "", query: 'site:linkedin.com/in/ "QA" "Chennai"' }]);
    expect(xrayVariations({ ...blank, titles: "QA", location: "Chennai, Pune" }, "none")).toHaveLength(1);
  });
  it("merges variations, keeping each person once", () => {
    const a = run([[1, ["x", "y"]]]), b = { ...run([[1, ["y", "z"]]]), query: "other" };
    expect(batchResults([a, b]).map((r) => r.name)).toEqual(["x", "y", "z"]);
  });
});
