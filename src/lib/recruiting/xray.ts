import { canonicalLinkedIn } from "../urls";

export type XrayInputs = { titles: string; keywords: string; location: string; company: string; exclude: string };
const terms = (value: string) => [...new Set(value.split(/[,\n]/).map((term) => term.trim().replace(/["\u0000-\u001f]/g, "")).filter(Boolean))].slice(0, 15);
const quoted = (value: string) => `"${value}"`;
const alternatives = (value: string) => {
  const list = terms(value).map(quoted);
  return list.length > 1 ? `(${list.join(" OR ")})` : list[0] ?? "";
};
export function buildXrayQuery(input: XrayInputs) {
  return ["site:linkedin.com/in/", alternatives(input.titles), alternatives(input.keywords), ...terms(input.location).map(quoted), ...terms(input.company).map(quoted), ...terms(input.exclude).map((term) => `-${quoted(term)}`)].filter(Boolean).join(" ");
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
