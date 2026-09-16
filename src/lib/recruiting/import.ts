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
  sourceDetail?: string;
  custom?: Record<string, string | number | boolean>;
};
export type RowError = { row: DraftRow; reason: string };
export function isRowError(x: ImportRow | RowError): x is RowError {
  return "reason" in x;
}

export type CsvImportPreview = {
  totalRows: number;
  validRows: ImportRow[];
  invalidRows: RowError[];
  recognizedColumns: string[];
  ignoredColumns: string[];
};
export type CsvCustomField = {
  key: string;
  label: string;
  kind: "text" | "number" | "date" | "select" | "boolean";
  options: string[];
};

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
  // Contact identity is also candidate data. Keeping it in fields lets the
  // import RPC populate the master record, while identities continue to own
  // duplicate detection.
  const email = deduped.find((identity) => identity.kind === "email");
  const phone = deduped.find((identity) => identity.kind === "phone");
  if (email) fields.email = email.value;
  if (phone) fields.phone = phone.value;
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

// Excel uploads are converted to the same CSV-shaped input as pasted CSV
// before validation. This keeps column aliases, custom-field mapping, and
// duplicate handling identical across both file formats.
export function spreadsheetRowsToCsv(
  rows: unknown[][],
): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text =
            value == null
              ? ""
              : value instanceof Date
                ? value.toISOString().slice(0, 10)
                : String(value);
          return /[",\r\n]/.test(text)
            ? `"${text.replaceAll('"', '""')}"`
            : text;
        })
        .join(","),
    )
    .join("\n");
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
function csvColumnForHeader(header: string): keyof DraftRow | undefined {
  return csvColumnAliases[header.replace(/^\uFEFF/, "").trim().toLowerCase()];
}

export function csvHeaders(text: string): string[] {
  return (parseCsv(text)[0] ?? []).map((header) =>
    header.replace(/^\uFEFF/, "").trim(),
  );
}

function comparableColumnName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function automaticCustomColumnMappings(
  headers: string[],
  fields: CsvCustomField[],
): Record<string, number> {
  const mappings: Record<string, number> = {};
  for (const field of fields) {
    const targets = [field.label, field.key].map(comparableColumnName);
    const index = headers.findIndex((header) =>
      targets.includes(comparableColumnName(header)),
    );
    if (index >= 0) mappings[field.key] = index;
  }
  return mappings;
}

function customValue(
  field: CsvCustomField,
  raw: string,
): string | number | boolean | undefined | { error: string } {
  const value = raw.trim();
  if (!value) return undefined;
  if (field.kind === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : { error: `${field.label} must be a number.` };
  }
  if (field.kind === "boolean") {
    if (["yes", "true", "1"].includes(value.toLowerCase())) return true;
    if (["no", "false", "0"].includes(value.toLowerCase())) return false;
    return { error: `${field.label} must be Yes or No.` };
  }
  if (field.kind === "select" && !field.options.includes(value))
    return { error: `${field.label} must match one of its dropdown options.` };
  if (value.length > 2000) return { error: `${field.label} is too long.` };
  return value;
}

export function csvToDraftRows(text: string): DraftRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const columns = rows[0].map(csvColumnForHeader);
  return rows.slice(1).map((cells) => {
    const draft: DraftRow = { name: "" };
    cells.forEach((cell, i) => {
      const key = columns[i];
      if (key) (draft as Record<string, string>)[key] = cell.trim();
    });
    return draft;
  });
}

// Build all CSV feedback before the request begins. The dialog can then show
// exactly what will be sent, while the API remains the final validation layer.
export function csvImportPreview(
  text: string,
  customFields: CsvCustomField[] = [],
  customMappings: Record<string, number | undefined> = {},
): CsvImportPreview {
  const parsed = parseCsv(text);
  const headers = csvHeaders(text);
  const mappedCustomColumns = new Set(
    Object.values(customMappings).filter((index): index is number => index != null),
  );
  const knownHeaders = new Set<string>();
  const ignoredHeaders = new Set<string>();
  for (const [index, header] of headers.entries()) {
    const label = header.replace(/^\uFEFF/, "").trim();
    if (!label) continue;
    if (csvColumnForHeader(label) || mappedCustomColumns.has(index)) knownHeaders.add(label);
    else ignoredHeaders.add(label);
  }

  const validRows: ImportRow[] = [];
  const invalidRows: RowError[] = [];
  const drafts = csvToDraftRows(text);
  for (const [index, draft] of drafts.entries()) {
    const built = buildImportRow(draft);
    if (isRowError(built)) {
      invalidRows.push(built);
      continue;
    }
    const custom: Record<string, string | number | boolean> = {};
    let customError: string | undefined;
    for (const field of customFields) {
      const columnIndex = customMappings[field.key];
      if (columnIndex == null) continue;
      const value = customValue(field, parsed[index + 1]?.[columnIndex] ?? "");
      if (typeof value === "object") {
        customError = value.error;
        break;
      }
      if (value !== undefined) custom[field.key] = value;
    }
    if (customError) invalidRows.push({ row: draft, reason: customError });
    else validRows.push({ ...built, ...(Object.keys(custom).length ? { custom } : {}) });
  }
  return {
    totalRows: Math.max(parsed.length - 1, 0),
    validRows,
    invalidRows,
    recognizedColumns: [...knownHeaders],
    ignoredColumns: [...ignoredHeaders],
  };
}
