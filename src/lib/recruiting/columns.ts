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

// Every column, on every stage.
//
// These used to be dealt out per stage — a profile URL and a rating on triage,
// the detail set only once somebody had been shortlisted — on the theory that
// a stage decides what is worth filling in. That was the tool deciding for the
// people using it. A column nobody wants on a tab is one click to hide, and
// the choice is remembered per tab; a column that is not offered at all is a
// conversation. So everything is shown, and hiding is theirs to do.
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

type Spec = Omit<CandidateColumn, "field">;

// Labels are what a recruiter would write at the top of a column. "Current"
// is redundant in a table of current employment, and the shorter heading
// leaves the column sized by its data instead of its title.
//
// The order here is the default reading order, left to right. It is a default:
// each tab remembers its own arrangement once somebody drags a column.
const specs: Spec[] = [
  { id: "date_added", label: "Added", kind: "date", editable: false, width: "sm" },
  // Where this person sits. On a stage tab every row says the same thing as
  // the tab itself, which is a fair column to hide and a fair one to keep:
  // All profiles spans every stage, so there it is the only way to tell.
  { id: "status", label: "Status", kind: "text", editable: false, width: "md" },
  { id: "linkedin", label: "LinkedIn", kind: "text", editable: true, width: "sm" },
  { id: "source", label: "Source", kind: "text", editable: false, width: "md" },
  {
    id: "rating",
    label: "Rating",
    kind: "number",
    editable: true,
    width: "xs",
    numeric: true,
    placeholder: "0.0–5.0",
  },
  { id: "phone", label: "Mobile", kind: "text", editable: true, width: "sm", placeholder: "98765 43210" },
  // The second number, for when the first does not answer.
  { id: "alternate_phone", label: "Alternate", kind: "text", editable: true, width: "sm", placeholder: "98765 43210" },
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

// Outcomes rather than details to fill in, so they sit after the detail block
// and after any custom columns. They are empty for anybody the outcome has not
// happened to, which on All profiles — a list that spans every stage,
// rejections included — is exactly the distinction worth seeing.
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
  // follows it: on these tabs the job is to look at a profile and score it, so
  // the two columns that do that work belong together.
  if (!stageShowsName(stage)) {
    const lead: CandidateColumnId[] = ["linkedin", "rating"];
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
