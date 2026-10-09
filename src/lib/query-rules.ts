// What a Google X-Ray query may be, checked the same way in the browser and
// on the server. Kept apart from queries.ts, which needs Node's crypto.
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
