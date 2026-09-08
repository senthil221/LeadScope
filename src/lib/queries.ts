import { createHash } from "node:crypto";
import type { CampaignConfig, Query } from "./domain";
import { unique } from "./domain";
const quote = (s: string) => `"${s.replace(/["\\]/g, " ").trim()}"`;
const group = (items: string[]) =>
  items.length === 1 ? quote(items[0]) : `(${items.map(quote).join(" OR ")})`;
const chunks = (items: string[]) =>
  Array.from({ length: Math.ceil(items.length / 3) }, (_, i) =>
    items.slice(i * 3, i * 3 + 3),
  );
export function normalizeQuery(raw: string): string {
  const text = raw
    .replace(/&#(?:x20|32);/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (text.length > 500 || /[\u0000-\u001f]/u.test(text))
    throw new Error("Queries must be one line and at most 500 characters.");
  const sites = [...text.matchAll(/(?:-?site:)\S+/gi)].map((m) =>
    m[0].toLowerCase(),
  );
  if (sites.some((s) => s !== "site:linkedin.com/in/"))
    throw new Error("Use only the site:linkedin.com/in/ restriction.");
  if (!sites.length)
    throw new Error("Every query needs site:linkedin.com/in/.");
  // A top-level OR or negated profile restriction can bypass the required scope.
  if (/(?:^|\s)OR(?:\s|$)/.test(text.replace(/\([^()]*\)/g, "")))
    throw new Error(
      "Put OR alternatives inside parentheses after the site restriction.",
    );
  if (
    !text.toLowerCase().startsWith("site:linkedin.com/in/ ") &&
    text.toLowerCase() !== "site:linkedin.com/in/"
  )
    throw new Error("Begin the query with site:linkedin.com/in/.");
  return text;
}
export function signature(
  text: string,
  country: string,
  language: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        q: normalizeQuery(text),
        gl: country,
        hl: language,
        provider: "serper",
        num: 10,
        type: "search",
      }),
    )
    .digest("hex");
}
export function generateQueries(config: CampaignConfig): {
  queries: Query[];
  warnings: string[];
} {
  const queries: Query[] = [],
    warnings: string[] = [],
    seen = new Set<string>();
  if (
    ![
      config.locations,
      config.roles,
      config.skills,
      config.requiredKeywords,
    ].some((items) => items.length)
  )
    return {
      queries: [],
      warnings: [
        "Add any location, role, skill or keyword, or paste your own query.",
      ],
    };
  const locations = config.locations.length ? unique(config.locations) : [""],
    roles = chunks(unique(config.roles)),
    skills = chunks(unique(config.skills));
  const rounds = Math.max(roles.length, skills.length, 1);
  for (let round = 0; round < rounds; round++)
    for (const location of locations)
      for (const strategy of ["focused", "broader"] as const) {
        const parts = ["site:linkedin.com/in/"];
        if (location) parts.push(quote(location));
        if (roles.length) parts.push(group(roles[round % roles.length]));
        if (
          (strategy === "focused" || (!location && !roles.length)) &&
          skills.length
        )
          parts.push(group(skills[round % skills.length]));
        if (
          (strategy === "focused" && config.includeRequired) ||
          parts.length === 1
        )
          parts.push(...config.requiredKeywords.map(quote));
        if (parts.length === 1) continue;
        parts.push(...config.queryExclusions.map((s) => `-${quote(s)}`));
        const text = parts.join(" ");
        if (text.length > 500) {
          warnings.push(
            `Skipped an overlength ${strategy} query for ${location}.`,
          );
          continue;
        }
        const key = text.toLowerCase();
        if (!seen.has(key) && queries.length < config.queryCap) {
          queries.push({ text, strategy, enabled: true });
          seen.add(key);
        }
      }
  return { queries, warnings: [...new Set(warnings)] };
}
