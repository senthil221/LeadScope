// What the mobile lookups have found, by source.
export type SourceId = "database" | "prospectdb" | "signalhire" | "apollo" | "bettercontact";
export type CoverageSource = { provider: SourceId; checked: number; found: number; numbers: number; errors: number };
export type Coverage = {
  since: string | null;
  lookups: { total: number; found: number; none: number; failed: number; pending: number };
  providers: CoverageSource[];
};
// In the order a lookup asks them. Prospect DB is planned and has no data yet.
export const SOURCES: { id: SourceId; name: string; tag?: "free" | "planned" }[] = [
  { id: "database", name: "Already on file", tag: "free" },
  { id: "prospectdb", name: "Prospect DB", tag: "planned" },
  { id: "signalhire", name: "SignalHire" },
  { id: "apollo", name: "Apollo" },
  { id: "bettercontact", name: "BetterContact" },
];
export const hitRate = (s: Pick<CoverageSource, "checked" | "found">) => (s.checked ? s.found / s.checked : 0);
// Every source gets a row, in order, whether or not it has been asked yet.
export function coverageRows(c: Coverage) {
  return SOURCES.map((source) => ({ ...source, ...(c.providers.find((p) => p.provider === source.id) ?? { provider: source.id, checked: 0, found: 0, numbers: 0, errors: 0 }) }));
}
