import { mobileDigits } from "./contact";
export const mobileProviders = ["database", "signalhire", "apollo", "bettercontact"] as const;
export type MobileProvider = (typeof mobileProviders)[number];
export const mobileProviderLabels = { database: "Our database", signalhire: "SignalHire", apollo: "Apollo", bettercontact: "BetterContact" };
export type MobileResult = { number: string; provider: MobileProvider };
export type MobileJob = { id: string; candidate_id: string; candidate_name: string; status: string; provider_index: number; collect_all: boolean; results: MobileResult[]; steps: { provider: MobileProvider; outcome: string; count: number }[]; error_code: string | null; created_at: string; updated_at: string };
export type MobileLookupCell = { candidate_id: string; status: string; identifier: string; checked_at: string; phone_count: number };
export function hasZeroMobileResult(lookup: MobileLookupCell | undefined, linkedin: string | undefined) {
  return Boolean(lookup && lookup.status === "no_mobile" && lookup.phone_count === 0 && lookup.identifier === linkedin);
}
export function emptyMobileResultLabel(status: string) {
  if (status === "no_mobile") return "0 phones found";
  if (["failed", "cancelled", "needs_review"].includes(status)) return "Lookup incomplete";
  return "No mobiles returned yet";
}
/** Preserve international numbers; India retains the app's existing ten-digit format. */
export function directMobile(value: unknown): string | null {
  if (typeof value !== "string" || /[a-z]/i.test(value)) return null;
  const digits = mobileDigits(value);
  if (/^[6-9]\d{9}$/.test(digits)) return digits;
  const clean = value.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(clean) ? clean : null;
}
export function uniqueMobiles(numbers: unknown[], provider: MobileProvider): MobileResult[] {
  return [...new Set(numbers.map(directMobile).filter((n): n is string => Boolean(n)))].slice(0, 20).map((number) => ({ number, provider }));
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value.slice(0, 100) : [];
export function signalhireMobiles(raw: unknown, identifier: string): MobileResult[] {
  const row = list(raw).map(object).find((entry) => entry.item === identifier);
  if (!row || row.status !== "success") return [];
  return uniqueMobiles(list(object(row.candidate).contacts).map(object).filter((contact) => contact.type === "phone" && contact.subType === "mobile").map((contact) => contact.value), "signalhire");
}
export function apolloMobiles(raw: unknown): MobileResult[] {
  const root = object(raw);
  const people = root.person ? [root.person] : list(root.people);
  return uniqueMobiles(people.flatMap((person) => list(object(person).phone_numbers).map(object).filter((phone) => phone.type_cd === "mobile" && phone.status_cd !== "invalid_number").map((phone) => phone.sanitized_number ?? phone.raw_number)), "apollo");
}
export function bettercontactMobiles(raw: unknown, linkedin: string): MobileResult[] {
  const root = object(raw);
  if (root.status !== "terminated") return [];
  // contact_phone_number is the API's mobile enrichment field. Never company_phone.
  return uniqueMobiles(list(root.data).map(object).filter((row) => row.enriched === true && (!row.contact_linkedin_profile_url || String(row.contact_linkedin_profile_url).replace(/\/$/, "") === linkedin.replace(/\/$/, ""))).flatMap((row) => Array.isArray(row.contact_phone_number) ? row.contact_phone_number : [row.contact_phone_number]), "bettercontact");
}
export function mergeMobiles(existing: MobileResult[], added: MobileResult[]) {
  const byNumber = new Map(existing.map((result) => [result.number, result]));
  for (const result of added) if (!byNumber.has(result.number)) byNumber.set(result.number, result);
  return [...byNumber.values()].slice(0, 80);
}
