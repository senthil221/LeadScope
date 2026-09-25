import type { RoleField } from "@/lib/types";
import { candidateSourceLabel, candidateSourceLabels, candidateSources } from "./stages";

export type EditMode = "replace" | "fill_empty" | "clear";
export type BulkField = {
  id: string; label: string; kind: string; shared?: boolean; options?: string[];
  // What to show for each stored option, when the two differ.
  optionLabels?: Record<string, string>;
};
export const bulkProfileFields: BulkField[] = [
  { id: "current_company", label: "Company", kind: "text", shared: true },
  { id: "current_designation", label: "Designation", kind: "text", shared: true },
  { id: "location", label: "Location", kind: "text", shared: true },
  { id: "headline", label: "Headline", kind: "text", shared: true },
  { id: "total_experience_years", label: "Experience (years)", kind: "number", shared: true },
  { id: "current_ctc", label: "Current CTC", kind: "text", shared: true },
  { id: "highest_qualification", label: "Highest qualification", kind: "text", shared: true },
];
export function bulkFields(custom: RoleField[]): BulkField[] {
  return [
    { id: "internal_notes", label: "Recruiter notes", kind: "text" },
    { id: "client_notes", label: "Client notes", kind: "text" },
    { id: "rating", label: "Rating", kind: "number" },
    // Where a batch came from is the thing most often recorded wrong, and it
    // is recorded once for a whole file. Correcting it row by row was the
    // only way to fix a mistake made in one click.
    {
      id: "source", label: "Source", kind: "select",
      options: [...candidateSources], optionLabels: candidateSourceLabels,
    },
    ...custom.filter((field) => !field.archived).map((field) => ({ id: `custom:${field.key}`, label: field.label, kind: field.kind, options: field.options })),
    ...bulkProfileFields,
  ];
}
export function bulkValue(field: BulkField, mode: EditMode, value: string): string | number | boolean | null {
  if (mode === "clear") return null;
  if (!value.trim()) throw new Error("Enter a value, or choose Clear values.");
  if (field.kind === "boolean") return value === "true";
  if (field.kind === "number" && !field.shared) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("Enter a valid number.");
    return number;
  }
  return value.trim();
}
export type BulkPreview = {
  token: string; changed: number; skipped: number; shared: boolean; otherRoleMemberships: number; batchId: string | null;
  rows: { id: string; name: string; before: unknown; after: unknown }[];
};
export type EditHistoryEntry = {
  id: string; candidateId: string; candidateName: string; field: string; fieldLabel: string | null;
  before: unknown; after: unknown; at: string; actor: string; batchId: string | null; scope: string;
};
export type Page<T> = { rows: T[]; nextCursor: string | null };
export type DuplicateStatus = "pending" | "confirmed" | "separate";
export type DuplicateProfile = {
  id: string; name: string; email: string | null; phone: string | null; company: string; designation: string; location: string; linkedin: string | null;
  roles: { id: string; name: string; client: string; stage: string }[];
};
export type DuplicatePair = {
  first: DuplicateProfile; second: DuplicateProfile; reasons: string[]; fingerprint: string; revision: number;
  status: DuplicateStatus; note: string; reviewedAt: string | null; cursor: string;
};
// A stored source reads as its label wherever the field is known; everything
// else is shown as it is held.
export function displayEditValue(value: unknown, field?: string): string {
  if (field === "source" && typeof value === "string" && value)
    return candidateSourceLabel(value);
  if (value === null || value === undefined || value === "") return "Empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((item) => displayEditValue(item, field)).join("\n");
  if (typeof value === "object") {
    const reviewLabels: Record<string, string> = { pending: "Needs review", confirmed: "Confirmed duplicate", separate: "Keep separate" };
    return Object.entries(value).map(([key, item]) => `${editFieldLabel(key)}: ${key === "status" && typeof item === "string" ? reviewLabels[item] ?? item : displayEditValue(item)}`).join("\n");
  }
  return String(value);
}
export function editFieldLabel(field: string): string {
  const known: Record<string, string> = { full_name: "Full name", current_company: "Company", current_designation: "Designation", internal_notes: "Recruiter notes", client_notes: "Client notes", duplicate_review: "Duplicate review", current_ctc: "Current CTC", "identity:linkedin": "LinkedIn profile", matchedProfile: "Matched profile" };
  return known[field] ?? field.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_", " ").replace(":", ": ").replace(/^./, (letter) => letter.toUpperCase());
}
