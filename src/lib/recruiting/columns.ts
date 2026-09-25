import type { RoleField } from "../types";
import type { Stage } from "./stages";

export type CellKind = "text" | "number" | "date" | "select" | "boolean";

export type CandidateColumnId =
  | "date_added"
  | "status"
  | "linkedin"
  | "source"
  | "rating"
  | "phone"
  | "alternate_phone"
  | "email"
  | "location"
  | "current_company"
  | "current_designation"
  | "total_experience_years"
  | "current_ctc"
  | "highest_qualification"
  | "resume"
  | "notes"
  | "reject_type"
  | "reject_reason"
  | "offer_details"
  | "outcome";

// Columns are sized to the data they hold rather than a uniform minimum, so
// a date does not take the same room as a job title and the table stays
// narrow enough to read without scrolling for the common stages.
export type ColumnWidth = "xs" | "sm" | "md" | "lg";

export type CandidateColumn = {
  id: CandidateColumnId | `custom:${string}`;
  label: string;
  kind: CellKind;
  editable: boolean;
  width: ColumnWidth;
  numeric?: boolean;
  placeholder?: string;
  field?: RoleField;
};

// Keep fields available in the Columns menu on every stage. The stage matrix
// below controls what appears before a recruiter customizes a tab.
const triageStages: Stage[] = ["all_profiles", "profile_shortlisted"];

// Where the work is scanning a long list, rows are tight by default. Where it
// is reading one person properly, they get the room. Either can be switched,
// and the choice is then remembered for that tab alone.
const compactByDefaultStages: string[] = [...triageStages, "rejected"];
export function stageDefaultsToCompact(tab: string) {
  return compactByDefaultStages.includes(tab);
}

// Only the LinkedIn URL is asked for when a candidate is added, so on the
// triage tabs the name is either derived from that URL or not filled in yet.
// A column of guesses is worse than no column: the URL is the identity there,
// and the name is still on the candidate panel and every later stage. This one
// stays off because it was asked for, not because the stage decided.
export function stageShowsName(tab: string) {
  return !triageStages.includes(tab as Stage);
}

const triageIds: CandidateColumnId[] = ["date_added", "linkedin", "source", "rating"];
const shortlistIds: CandidateColumnId[] = [
  "date_added", "linkedin", "phone", "alternate_phone", "email", "location", "current_company",
  "current_designation", "total_experience_years", "current_ctc",
  "highest_qualification", "resume", "notes",
];
// Rejects is not in the supplied five-tab matrix, so retain its former layout.
const rejectIds: CandidateColumnId[] = [
  ...shortlistIds, "reject_type", "reject_reason",
];

export function defaultVisibleColumnIds(stage: Stage, available: CandidateColumn[]) {
  const shown = new Set<CandidateColumnId>(
    // Status earns its place on All profiles and nowhere else: that tab lists
    // every stage, so it is the only view where the column says something the
    // tab does not already say.
    stage === "all_profiles" ? [...triageIds, "status"]
      : stage === "profile_shortlisted" ? [...triageIds, "phone", "alternate_phone"]
        : stage === "rejected" ? rejectIds : shortlistIds,
  );
  const showCustom = !triageStages.includes(stage);
  return available
    .filter((column) => shown.has(column.id as CandidateColumnId) ||
      (showCustom && column.id.startsWith("custom:")))
    .map((column) => column.id);
}

type Spec = Omit<CandidateColumn, "field">;

// Labels are what a recruiter would write at the top of a column. "Current"
// is redundant in a table of current employment, and the shorter heading
// leaves the column sized by its data instead of its title.
//
// The order here is the default reading order, left to right. It is a default:
// each tab remembers its own arrangement once somebody drags a column.
const specs: Spec[] = [
  { id: "date_added", label: "Added", kind: "date", editable: false, width: "sm" },
  // Status remains available in Columns but is outside the default matrix.
  { id: "status", label: "Status", kind: "text", editable: false, width: "md" },
  { id: "linkedin", label: "LinkedIn", kind: "text", editable: true, width: "sm" },
  {
    id: "rating",
    label: "Rating",
    kind: "number",
    editable: true,
    width: "xs",
    numeric: true,
    placeholder: "0.0–5.0",
  },
  // Beside the rating rather than further along: where a profile came from is
  // part of judging it, and on the tabs where it is judged the two are read
  // together.
  { id: "source", label: "Source", kind: "select", editable: true, width: "md" },
  { id: "phone", label: "Mobile", kind: "text", editable: true, width: "sm", placeholder: "Add mobile" },
  // The second number, for when the first does not answer.
  { id: "alternate_phone", label: "Alternate", kind: "text", editable: true, width: "sm", placeholder: "Add alternate" },
  { id: "email", label: "Email", kind: "text", editable: true, width: "lg" },
  { id: "location", label: "Location", kind: "text", editable: true, width: "md" },
  { id: "current_company", label: "Company", kind: "text", editable: true, width: "md" },
  { id: "current_designation", label: "Designation", kind: "text", editable: true, width: "lg" },
  {
    id: "total_experience_years",
    label: "Exp",
    kind: "number",
    editable: true,
    width: "xs",
    numeric: true,
  },
  {
    id: "current_ctc",
    label: "CTC",
    kind: "text",
    editable: true,
    width: "sm",
    numeric: true,
    placeholder: "18 LPA",
  },
  { id: "highest_qualification", label: "Qualification", kind: "text", editable: true, width: "md" },
  { id: "resume", label: "Resume", kind: "text", editable: false, width: "xs" },
  { id: "notes", label: "Notes", kind: "text", editable: true, width: "lg" },
];

// Outcome columns remain available in Columns but only rejection details are
// shown initially, on the Rejects tab.
const outcomeSpecs: Spec[] = [
  { id: "reject_type", label: "Reject type", kind: "text", editable: false, width: "sm" },
  { id: "reject_reason", label: "Reject reason", kind: "text", editable: false, width: "lg" },
  { id: "offer_details", label: "Offer", kind: "text", editable: false, width: "md" },
  { id: "outcome", label: "Outcome", kind: "select", editable: true, width: "md" },
];

function toColumn(spec: Spec): CandidateColumn {
  return {
    id: spec.id,
    label: spec.label,
    kind: spec.kind,
    editable: spec.editable,
    width: spec.width,
    numeric: spec.numeric,
    placeholder: spec.placeholder,
  };
}

export function candidateColumns(
  stage: Stage,
  roleFields: RoleField[],
): CandidateColumn[] {
  const columns: CandidateColumn[] = specs.map(toColumn);
  columns.push(
    ...roleFields.map((field) => ({
      id: `custom:${field.key}` as const,
      label: field.label,
      kind: field.kind as CellKind,
      editable: true,
      width: (field.kind === "number" || field.kind === "date"
        ? "sm"
        : "md") as ColumnWidth,
      numeric: field.kind === "number",
      field,
    })),
  );
  columns.push(...outcomeSpecs.map(toColumn));
  // With the name column gone from triage, the LinkedIn URL is what identifies
  // a row. It leads the table and takes the room the name gave up, so it reads
  // as the identity column rather than truncating three columns in. The rating
  // and the source follow it: on these tabs the job is to look at a profile and
  // score it, and where it came from is part of that, so the three columns
  // doing that work stay together.
  if (!stageShowsName(stage)) {
    const lead: CandidateColumnId[] = ["linkedin", "rating", "source"];
    const widths: Partial<Record<CandidateColumnId, ColumnWidth>> = { linkedin: "lg" };
    // Walked backwards, so each unshift lands in front of the one before it
    // and the list comes out in the order written above.
    for (const id of [...lead].reverse()) {
      const index = columns.findIndex((column) => column.id === id);
      if (index < 0) continue;
      const [column] = columns.splice(index, 1);
      columns.unshift({ ...column, width: widths[id] ?? column.width });
    }
  }
  return columns;
}
