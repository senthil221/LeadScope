import { canonicalLinkedIn } from "../urls";

// A blank row at the bottom of the grid, the way a spreadsheet always leaves
// somewhere to type. It becomes a real candidate once it carries a name and a
// LinkedIn profile: the profile URL is the identity the whole database
// deduplicates on, so nothing can be created without one.
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

export function isDraftReady(row: DraftRow) {
  return Boolean((row.values.full_name ?? "").trim()) && Boolean(draftLinkedIn(row));
}

// What is missing, phrased for someone filling the row in.
export function draftBlocker(row: DraftRow): string | null {
  if (isDraftEmpty(row)) return null;
  const name = (row.values.full_name ?? "").trim();
  const linkedin = (row.values.linkedin ?? "").trim();
  if (!name && !linkedin) return "Add a name and LinkedIn URL";
  if (!name) return "Add a name";
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
  return {
    name: (row.values.full_name ?? "").trim(),
    identities: [{ kind: "linkedin" as const, value: draftLinkedIn(row)! }],
    fields,
    sourceDetail: "Added in sheet",
    custom: {},
  };
}
