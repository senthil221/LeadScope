import { createHash } from "node:crypto";
import type { CampaignConfig, Query } from "./domain";
import { unique } from "./domain";
import { normalizeQuery } from "./query-rules";
const quote = (s: string) => `"${s.replace(/["\\]/g, " ").trim()}"`;
const group = (items: string[]) =>
  items.length === 1 ? quote(items[0]) : `(${items.map(quote).join(" OR ")})`;
const chunks = (items: string[]) =>
  Array.from({ length: Math.ceil(items.length / 3) }, (_, i) =>
    items.slice(i * 3, i * 3 + 3),
  );
export { normalizeQuery } from "./query-rules";
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
