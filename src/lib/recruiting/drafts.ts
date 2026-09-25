import { canonicalLinkedIn } from "../urls";
import { nameFromProfileUrl } from "./import";

// A blank row at the bottom of the grid, the way a spreadsheet always leaves
// somewhere to type. It becomes a real candidate as soon as it carries a
// LinkedIn profile, which is the identity the whole database deduplicates on
// and so the one thing that cannot be filled in later.
export type DraftRow = { key: string; values: Record<string, string> };

// Grid column -> the key import_candidates reads out of `fields`.
export const draftImportFields: Record<string, string> = {
  phone: "phone",
  email: "email",
  location: "location",
  current_company: "currentCompany",
  current_designation: "currentDesignation",
  total_experience_years: "totalExperienceYears",
  current_ctc: "currentCtc",
  highest_qualification: "highestQualification",
};

export function isDraftColumnEditable(columnId: string) {
  return (
    columnId === "full_name" ||
    columnId === "linkedin" ||
    columnId in draftImportFields
  );
}

export function isDraftEmpty(row: DraftRow) {
  return Object.values(row.values).every((value) => !value.trim());
}

export function draftLinkedIn(row: DraftRow) {
  return canonicalLinkedIn((row.values.linkedin ?? "").trim());
}

// The profile URL is the whole requirement. Everything else, name included,
// is filled in afterwards by whoever works the row.
export function isDraftReady(row: DraftRow) {
  return Boolean(draftLinkedIn(row));
}

// What is missing, phrased for someone filling the row in.
export function draftBlocker(row: DraftRow): string | null {
  if (isDraftEmpty(row)) return null;
  const linkedin = (row.values.linkedin ?? "").trim();
  if (!linkedin) return "Add a LinkedIn URL";
  if (!draftLinkedIn(row)) return "That LinkedIn URL is not a /in/ profile";
  return null;
}

export function draftImportRow(row: DraftRow) {
  const fields: Record<string, string | number> = {};
  for (const [columnId, fieldKey] of Object.entries(draftImportFields)) {
    const value = (row.values[columnId] ?? "").trim();
    if (!value) continue;
    if (fieldKey === "totalExperienceYears") {
      const years = Number(value);
      if (Number.isFinite(years)) fields[fieldKey] = years;
      continue;
    }
    fields[fieldKey] = value;
  }
  const linkedin = draftLinkedIn(row)!;
  return {
    // A blank name becomes the profile slug, which the candidate record
    // requires and which reads as a placeholder until someone corrects it.
    name: (row.values.full_name ?? "").trim() || nameFromProfileUrl(linkedin),
    identities: [{ kind: "linkedin" as const, value: linkedin }],
    fields,
    custom: {},
  };
}
