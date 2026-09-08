import {
  RULE_VERSION,
  type Assessment,
  type CampaignConfig,
  type Criterion,
  type Evidence,
} from "./domain";
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function phraseSpans(
  text: string,
  phrase: string,
  source: Evidence["source"],
): Evidence[] {
  const regex = new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped(phrase)}(?![\\p{L}\\p{N}])`,
    "giu",
  );
  return [...text.matchAll(regex)].map((m) => ({
    source,
    start: m.index!,
    end: m.index! + m[0].length,
    text: m[0],
  }));
}
const result = (
  state: Criterion["state"],
  reason: string,
  spans: Evidence[] = [],
): Criterion => ({ state, reason, spans });
function historical(text: string, at: number) {
  return /(?:formerly|previously|past|former|studied|university|college|school|graduated|headquarters|headquartered)\b[^.;|\n]{0,80}$/i.test(
    text.slice(Math.max(0, at - 100), at),
  );
}
function negated(text: string, at: number) {
  return /(?:no|not|without|lacks|never|does not have)\s+(?:experience (?:in|with)\s+)?$/i.test(
    text.slice(Math.max(0, at - 45), at),
  );
}
export function qualify(
  title: string,
  snippet: string,
  c: CampaignConfig,
  observedAt = new Date().toISOString(),
): Assessment {
  const sources = [
    { text: title, source: "title" as const },
    { text: snippet, source: "snippet" as const },
  ];
  const spans = (items: string[]) =>
    sources.flatMap((s) =>
      items.flatMap((p) => phraseSpans(s.text, p, s.source)),
    );
  const textFor = (s: Evidence) => (s.source === "title" ? title : snippet);
  // Location passes only from an explicit profile-location phrase in the snippet.
  const locMatches = [
    ...snippet.matchAll(
      /(?:\b(?:current\s+)?location\s*:\s*|\bbased in\s+|\blives in\s+)([^.;|\n]+)|([^.;|\n]{1,80})\s+[·•]\s*(?:\d[\d,+]*\s+)?connections/gi,
    ),
  ];
  let target = false,
    other = false;
  const locationSpans: Evidence[] = [];
  for (const match of locMatches) {
    if (historical(snippet, match.index!)) continue;
    const candidate = match[1] ?? match[2];
    const matching = c.locations.some(
      (p) => phraseSpans(candidate, p, "snippet").length > 0,
    );
    if (matching) target = true;
    else if (match[1] && candidate.trim().length > 1) other = true;
    locationSpans.push({
      source: "snippet",
      start: match.index!,
      end: match.index! + match[0].length,
      text: match[0],
    });
  }
  const location =
    target && other
      ? result("review", "conflicting_current_locations", locationSpans)
      : target
        ? result("pass", "explicit_profile_location", locationSpans)
        : other
          ? result("fail", "different_current_location", locationSpans)
          : result("review", "location_not_established", spans(c.locations));
  const currentRole = (s: Evidence) => {
    const text = textFor(s);
    if (historical(text, s.start) || negated(text, s.start)) return false;
    if (s.source === "title")
      return (
        /(?:\s[-–—|]\s)/u.test(text.slice(0, s.start)) &&
        !/\b(?:aspiring|seeking|student|interested in)\b/i.test(
          text.slice(0, s.start),
        )
      );
    return /(?:\b(?:current(?:ly)?(?: role)?|works? as|role|position)\s*:?\s*(?:an?\s+)?)$/i.test(
      text.slice(Math.max(0, s.start - 45), s.start),
    );
  };
  const roleHits = spans(c.roles).filter(currentRole),
    excluded = spans(c.leadExclusions).filter(currentRole);
  const role =
    roleHits.length && excluded.length
      ? result("review", "conflicting_current_roles", [
          ...roleHits,
          ...excluded,
        ])
      : excluded.length
        ? result("fail", "excluded_current_role", excluded)
        : roleHits.length
          ? result("pass", "direct_current_role", roleHits)
          : result("review", "current_role_not_established", spans(c.roles));
  const affirmative = (
    items: string[],
    all: boolean,
    name: string,
  ): Criterion => {
    if (!items.length) return result("pass", `${name}_not_required`);
    const hits = items.map((item) => spans([item]));
    const negatives = hits.flat().filter((s) => negated(textFor(s), s.start));
    const positive = hits.map((h) =>
      h.filter(
        (s) =>
          !negated(textFor(s), s.start) && !historical(textFor(s), s.start),
      ),
    );
    if (negatives.length && positive.flat().length)
      return result("review", `${name}_conflicting`, [
        ...positive.flat(),
        ...negatives,
      ]);
    if (negatives.length)
      return result("fail", `${name}_explicit_contradiction`, negatives);
    return (
      all
        ? positive.every((h) => h.length > 0)
        : positive.some((h) => h.length > 0)
    )
      ? result("pass", `${name}_affirmative`, positive.flat())
      : result("review", `${name}_missing`, positive.flat());
  };
  const criteria = {
    location,
    role,
    skills: affirmative(c.skills, false, "skills"),
    keywords: affirmative(c.requiredKeywords, true, "keywords"),
  };
  const states = Object.values(criteria).map((r) => r.state);
  return {
    status: states.includes("fail")
      ? "rejected"
      : states.every((s) => s === "pass")
        ? "rule_match"
        : "review",
    criteria,
    version: RULE_VERSION,
    title,
    snippet,
    observedAt,
  };
}
export function mergeAssessment(
  previous: Assessment,
  next: Assessment,
): Assessment {
  const conflict = Object.keys(previous.criteria).some((k) => {
    const key = k as keyof Assessment["criteria"];
    return (
      [previous.criteria[key].state, next.criteria[key].state].includes(
        "pass",
      ) &&
      [previous.criteria[key].state, next.criteria[key].state].includes("fail")
    );
  });
  if (conflict || previous.conflict)
    return { ...next, status: "review", conflict: true };
  return next.status === "rule_match"
    ? next
    : previous.status === "rule_match"
      ? previous
      : next;
}
export function effectiveStatus(
  assessment: string,
  manual: string | null,
  suppressed: boolean,
  current: boolean,
) {
  if (suppressed) return "suppressed";
  if (!current) return "review";
  return manual ?? assessment;
}
