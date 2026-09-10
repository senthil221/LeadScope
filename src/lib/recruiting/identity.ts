import { canonicalLinkedIn } from "../urls";

// Identity kinds the database will merge candidates on. Phone is stored and
// searchable but never merges: a shared office line is not one person.
export const identityKinds = [
  "linkedin",
  "naukri",
  "email",
  "phone",
  "external",
] as const;
export type IdentityKind = (typeof identityKinds)[number];
export const mergeableKinds: readonly IdentityKind[] = [
  "linkedin",
  "naukri",
  "email",
  "external",
];
export type Identity = { kind: IdentityKind; value: string };

function naukriProfile(input: string): string | null {
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || url.port) return null;
    if (!/^(?:[a-z0-9-]+\.)*naukri\.com$/i.test(url.hostname)) return null;
    const path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return null;
    // Drop tracking parameters and fragments the way LinkedIn URLs are handled.
    return `https://www.naukri.com${path}`.toLowerCase();
  } catch {
    return null;
  }
}

// Returns the value the database stores, or null when the input cannot be a
// stable identity. Callers must reject null rather than fall back to the name.
export function normalizeIdentity(
  kind: IdentityKind,
  raw: string,
): Identity | null {
  const input = raw.trim();
  if (!input || input.length > 500) return null;
  if (kind === "linkedin") {
    const withScheme = /^(?:www\.|[a-z]{2}\.)?linkedin\.com\//i.test(input)
      ? `https://${input}`
      : input;
    const url = canonicalLinkedIn(withScheme);
    return url ? { kind, value: url } : null;
  }
  if (kind === "naukri") {
    const withScheme = /^(?:[a-z0-9-]+\.)*naukri\.com\//i.test(input)
      ? `https://${input}`
      : input;
    const url = naukriProfile(withScheme);
    return url ? { kind, value: url } : null;
  }
  if (kind === "email") {
    const value = input.toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? { kind, value } : null;
  }
  if (kind === "phone") {
    // Keep a leading +, drop separators. Not a merge key, so this only has to
    // be stable enough to search on.
    const digits = input.replace(/(?!^\+)[^0-9]/g, "");
    return /^\+?[0-9]{7,15}$/.test(digits) ? { kind, value: digits } : null;
  }
  return { kind: "external", value: input };
}

// Collapses URL variants and repeats within one import before it reaches the
// database, so a paste of the same profile twice is a single identity.
export function dedupeIdentities(identities: Identity[]): Identity[] {
  const seen = new Map<string, Identity>();
  for (const identity of identities)
    seen.set(`${identity.kind}:${identity.value}`, identity);
  return [...seen.values()];
}

export function hasMergeableIdentity(identities: Identity[]): boolean {
  return identities.some((identity) => mergeableKinds.includes(identity.kind));
}
