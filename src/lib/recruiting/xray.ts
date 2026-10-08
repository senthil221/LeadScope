import { canonicalLinkedIn } from "../urls";

export type XrayInputs = { titles: string; keywords: string; location: string; company: string; exclude: string };
const terms = (value: string) => [...new Set(value.split(/[,\n]/).map((term) => term.trim().replace(/["\u0000-\u001f]/g, "")).filter(Boolean))].slice(0, 15);
const quoted = (value: string) => `"${value}"`;
const alternatives = (value: string) => {
  const list = terms(value).map(quoted);
  return list.length > 1 ? `(${list.join(" OR ")})` : list[0] ?? "";
};
// A person is in one place at a time, so several locations mean any of them.
export function buildXrayQuery(input: XrayInputs) {
  return ["site:linkedin.com/in/", alternatives(input.titles), alternatives(input.keywords), alternatives(input.location), ...terms(input.company).map(quoted), ...terms(input.exclude).map((term) => `-${quoted(term)}`)].filter(Boolean).join(" ");
}
// Google stops at about a hundred results a search, so one wide search finds
// fewer people than the same search run once per location or per title.
export type XraySplit = "none" | "location" | "titles";
export const MAX_VARIATIONS = 5;
export function xrayVariations(input: XrayInputs, split: XraySplit): { label: string; query: string }[] {
  const field = split === "location" ? "location" : split === "titles" ? "titles" : null;
  const parts = field ? terms(input[field]).slice(0, MAX_VARIATIONS) : [];
  if (!field || parts.length < 2) return [{ label: "", query: buildXrayQuery(input) }];
  return parts.map((part) => ({ label: part, query: buildXrayQuery({ ...input, [field]: part }) }));
}
export type XrayResult = { url: string; name: string; title: string; snippet: string; position: number };
export function xrayResults(organic: { link: string; title: string; snippet: string; position: number }[]): XrayResult[] {
  const results = new Map<string, XrayResult>();
  for (const item of organic) {
    const url = canonicalLinkedIn(item.link);
    if (!url || results.has(url)) continue;
    const title = item.title.replace(/\s*[|\-–—]\s*LinkedIn\s*$/i, "").replace(/—/g, ",").trim();
    const name = title.split(/\s+[|\-–]\s+/)[0].trim().slice(0, 200) || "LinkedIn profile";
    results.set(url, { url, name, title: title.slice(0, 300), snippet: item.snippet.replace(/—/g, ",").slice(0, 4000), position: item.position });
  }
  return [...results.values()];
}

// One run of an X-Ray search: the Google pages fetched for a query, in order.
export type XrayPage = { id: string; page: number; results: XrayResult[] };
export type XrayRun = { query: string; country: string; pages: XrayPage[]; exhausted: boolean; label?: string };
// Every person across the run once, in the order Google first showed them.
export function runResults(run: XrayRun): XrayResult[] {
  const seen = new Map<string, XrayResult>();
  for (const page of [...run.pages].sort((a, b) => a.page - b.page))
    for (const result of page.results) if (!seen.has(result.url)) seen.set(result.url, result);
  return [...seen.values()];
}
// A page that adds nobody new means Google has run out for this query.
export function addsNobody(run: XrayRun, page: XrayResult[]) {
  const seen = new Set(runResults(run).map((r) => r.url));
  return !page.some((r) => !seen.has(r.url));
}
export function lastPage(run: XrayRun) {
  let page = 0;
  while (run.pages.some((p) => p.page === page + 1)) page += 1;
  return page;
}
// Saved pages grouped back into runs, most recent first. A page fetched twice
// keeps its latest copy.
export function savedRuns(searches: (XrayPage & { query: string; country: string; created_at: string })[], limit = 6): XrayRun[] {
  const runs = new Map<string, XrayRun & { at: string }>();
  for (const search of [...searches].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const key = `${search.country}\u0000${search.query}`;
    const run = runs.get(key) ?? { query: search.query, country: search.country, pages: [], exhausted: false, at: search.created_at };
    if (!run.pages.some((p) => p.page === search.page)) run.pages.push({ id: search.id, page: search.page, results: search.results });
    runs.set(key, run);
  }
  return [...runs.values()].slice(0, limit).map((run) => ({ query: run.query, country: run.country, pages: run.pages, exhausted: run.exhausted }));
}
// Everyone across a set of runs once, run by run in the order they were asked.
export function batchResults(runs: XrayRun[]): XrayResult[] {
  const seen = new Map<string, XrayResult>();
  for (const run of runs) for (const result of runResults(run)) if (!seen.has(result.url)) seen.set(result.url, result);
  return [...seen.values()];
}
