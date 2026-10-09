import type { Role } from "../types";

// "open" is what the database stores for Active; the work queues test for it.
export const ROLE_STATUSES = [
  { value: "open", label: "Active" },
  { value: "hired", label: "Hired" },
  { value: "closed", label: "Closed" },
] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number]["value"];
export const roleStatusLabel = (status: string) => ROLE_STATUSES.find((s) => s.value === status)?.label ?? "Active";

const lpa = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(2))}`;
// The dashboard shows the top of the range; the form holds both ends.
export function ctcMaxLabel(role: Pick<Role, "ctc" | "ctc_min" | "ctc_max">) {
  if (role.ctc_max != null) return `${lpa(Number(role.ctc_max))} LPA`;
  if (role.ctc_min != null) return `${lpa(Number(role.ctc_min))}+ LPA`;
  return role.ctc?.trim() || "";
}

// Whole days since the role opened, in India time, never negative.
export function roleAgeDays(openedOn: string | undefined, now = new Date()) {
  if (!openedOn || !/^\d{4}-\d{2}-\d{2}$/.test(openedOn)) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const days = Math.round((Date.parse(today) - Date.parse(openedOn)) / 86400000);
  return Math.max(0, days);
}
export const todayInIndia = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

// Readable link parts: "Myna Mahila" becomes "myna-mahila", "M&E Lead" becomes "me-lead".
export function slug(text: string) {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "role";
}
export const SHARE_CODE = /^[a-z2-9]{6}$/;
export function shareLinkPath(clientName: string, roleName: string, code: string) {
  return `/c/${slug(clientName)}/${slug(roleName)}-${code}`;
}
// The code is the last part of the role segment; the names are only for reading.
export function shareCodeFromSegment(segment: string) {
  const code = segment.slice(segment.lastIndexOf("-") + 1);
  return SHARE_CODE.test(code) ? code : null;
}
