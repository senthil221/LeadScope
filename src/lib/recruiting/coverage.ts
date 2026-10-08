// What the mobile lookups have found, by source, and what that suggests.
export type CoverageSource = { provider: "database" | "signalhire" | "apollo" | "bettercontact"; checked: number; found: number; numbers: number; errors: number };
export type Coverage = {
  since: string | null;
  lookups: { total: number; found: number; none: number; failed: number; pending: number };
  providers: CoverageSource[];
};
export const sourceName: Record<CoverageSource["provider"], string> = { database: "Already on file", signalhire: "SignalHire", apollo: "Apollo", bettercontact: "BetterContact" };
export const PAID = ["signalhire", "apollo", "bettercontact"] as const;
export const hitRate = (s: Pick<CoverageSource, "checked" | "found">) => (s.checked ? s.found / s.checked : 0);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const SMALL = 20;

// Plain-language notes drawn from the numbers. The waterfall only asks a
// source when the ones before it found nothing, so a later source's rate is
// over the harder cases: it is what that source adds, not how it would do alone.
export function coverageNotes(c: Coverage, balances: Partial<Record<string, number | null>> = {}): string[] {
  const notes: string[] = [];
  const by = (p: CoverageSource["provider"]) => c.providers.find((s) => s.provider === p);
  const { total, found } = c.lookups;
  if (!total) return ["No mobile lookups in this period yet. Run Find mobiles on a few profiles and this fills in."];
  notes.push(`${pct(found / total)} of lookups ended with at least one number (${found} of ${total}).`);
  const onFile = by("database");
  if (onFile?.found) notes.push(`${onFile.found} ${onFile.found === 1 ? "lookup was" : "lookups were"} answered from numbers already on file, without spending a credit.`);
  const paid = PAID.map(by).filter((s): s is CoverageSource => Boolean(s && s.checked));
  const best = [...paid].sort((a, b) => hitRate(b) - hitRate(a))[0];
  if (best && paid.length > 1 && best.checked >= 5) notes.push(`${sourceName[best.provider]} has the best hit rate so far: ${pct(hitRate(best))} of the people it was asked about.`);
  for (const s of paid.slice(1)) {
    if (s.found) notes.push(`${sourceName[s.provider]} found ${s.found} ${s.found === 1 ? "person" : "people"} the sources before it missed (${pct(hitRate(s))} of what reached it).`);
    else if (s.checked >= 10) notes.push(`${sourceName[s.provider]} has found nobody in ${s.checked} tries after the earlier sources missed. It may not be worth its credits as a fallback.`);
  }
  for (const p of PAID) {
    const s = by(p);
    if (!s || (!s.checked && !s.errors)) notes.push(`${sourceName[p]} was not asked in this period: the earlier sources answered every lookup, or it was not set up.`);
    if (s?.errors) notes.push(`${sourceName[p]} returned ${s.errors} ${s.errors === 1 ? "error" : "errors"}. Check its key and balance above.`);
  }
  const bc = balances.bettercontact;
  if (typeof bc === "number" && bc < 50 && by("bettercontact")?.checked) notes.push(`BetterContact has ${bc} credits left and is the last fallback; top up or lookups that reach it will stop finding numbers.`);
  if (c.lookups.failed) notes.push(`${c.lookups.failed} ${c.lookups.failed === 1 ? "lookup" : "lookups"} failed or needed review; those are not counted as misses.`);
  if (total < SMALL) notes.push(`Only ${total} lookups so far; rates will steady as more run.`);
  return notes;
}
