import {
  normalizeIdentity,
  dedupeIdentities,
  hasMergeableIdentity,
  type Identity,
} from "./identity";

// The shape every import surface (paste, manual entry, CSV, sourcing pull)
// converges on before it reaches the importCandidates action. Centralizing
// row-building here means the four UI modes share one validation path.
export type DraftRow = {
  name: string;
  linkedin?: string;
  naukri?: string;
  email?: string;
  phone?: string;
  currentCompany?: string;
  currentDesignation?: string;
  location?: string;
  headline?: string;
  totalExperienceYears?: string;
};
export type ImportRow = {
  name: string;
  identities: Identity[];
  fields: Record<string, string | number>;
};
export type RowError = { row: DraftRow; reason: string };
export function isRowError(x: ImportRow | RowError): x is RowError {
  return "reason" in x;
}

export function buildImportRow(draft: DraftRow): ImportRow | RowError {
  const name = draft.name.trim();
  if (!name) return { row: draft, reason: "Missing a name." };
  if (name.length > 200)
    return { row: draft, reason: "Name is too long." };
  const identities: Identity[] = [];
  const tryAdd = (kind: "linkedin" | "naukri" | "email" | "phone", raw?: string) => {
    if (!raw?.trim()) return;
    const identity = normalizeIdentity(kind, raw);
    if (identity) identities.push(identity);
  };
  tryAdd("linkedin", draft.linkedin);
  tryAdd("naukri", draft.naukri);
  tryAdd("email", draft.email);
  tryAdd("phone", draft.phone);
  const deduped = dedupeIdentities(identities);
  if (!hasMergeableIdentity(deduped))
    return {
      row: draft,
      reason: "Add a valid LinkedIn, Naukri, or email identity.",
    };
  const fields: Record<string, string | number> = {};
  if (draft.currentCompany?.trim())
    fields.currentCompany = draft.currentCompany.trim().slice(0, 200);
  if (draft.currentDesignation?.trim())
    fields.currentDesignation = draft.currentDesignation.trim().slice(0, 200);
  if (draft.location?.trim()) fields.location = draft.location.trim().slice(0, 200);
  if (draft.headline?.trim()) fields.headline = draft.headline.trim().slice(0, 300);
  const years = Number(draft.totalExperienceYears);
  if (draft.totalExperienceYears?.trim() && Number.isFinite(years) && years >= 0 && years <= 70)
    fields.totalExperienceYears = years;
  return { name, identities: deduped, fields };
}

// Guesses a display name from a profile URL slug when no name was given
// (a plain URL paste). Recruiters correct it later; a candidate is never
// left with a blank name.
export function nameFromProfileUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const slug = decodeURIComponent(path.split("/").pop() ?? "");
    const words = slug
      .split(/[-_.]+/)
      .filter((w) => w && !/^[0-9a-f]{6,}$/i.test(w));
    if (!words.length) return "Unnamed profile";
    return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  } catch {
    return "Unnamed profile";
  }
}

// Minimal CSV parser: quoted fields, embedded commas/newlines, "" escapes.
// Good enough for a Sheets/Excel export; not a full RFC4180 implementation.
// No external dependency, matching the rest of this codebase.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length));
}

const csvColumnAliases: Record<string, keyof DraftRow> = {
  name: "name",
  "full name": "name",
  linkedin: "linkedin",
  "linkedin url": "linkedin",
  naukri: "naukri",
  "naukri url": "naukri",
  email: "email",
  "email address": "email",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  company: "currentCompany",
  "current company": "currentCompany",
  designation: "currentDesignation",
  "current designation": "currentDesignation",
  title: "currentDesignation",
  headline: "headline",
  location: "location",
  experience: "totalExperienceYears",
  "experience (years)": "totalExperienceYears",
  "total experience": "totalExperienceYears",
};
export const csvTemplateColumns = [
  "Full Name",
  "LinkedIn URL",
  "Naukri URL",
  "Email",
  "Phone",
  "Company",
  "Designation",
  "Location",
  "Experience (years)",
];

// The first row is always treated as a header; column order does not matter
// as long as the names are recognized (case-insensitive). Unknown columns
// are ignored rather than rejected, so a richer export still imports.
export function csvToDraftRows(text: string): DraftRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const columns = rows[0].map((h) => csvColumnAliases[h.trim().toLowerCase()]);
  return rows.slice(1).map((cells) => {
    const draft: DraftRow = { name: "" };
    cells.forEach((cell, i) => {
      const key = columns[i];
      if (key) (draft as Record<string, string>)[key] = cell.trim();
    });
    return draft;
  });
}
