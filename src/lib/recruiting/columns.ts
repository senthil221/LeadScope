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

// The stage a candidate is in decides what a recruiter is asked to fill in.
// Early stages stay deliberately narrow — a profile URL, where it came from
// and a rating — and the full detail set only appears once someone has
// committed to shortlisting the person.
const detailStages: Stage[] = [
  "recruiter_shortlisted",
  "client_shortlisted",
  "offer_sent",
  "rejected",
];
const everyStage: Stage[] = [
  "all_profiles",
  "profile_shortlisted",
  ...detailStages,
];
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
// and the name is still on the candidate panel and every later stage.
export function stageShowsName(tab: string) {
  return !triageStages.includes(tab as Stage);
}

type Spec = Omit<CandidateColumn, "field"> & { stages: Stage[] };

// Labels are what a recruiter would write at the top of a column. "Current"
// is redundant in a table of current employment, and the shorter heading
// leaves the column sized by its data instead of its title.
const specs: Spec[] = [
  { id: "date_added", label: "Added", kind: "date", editable: false, width: "sm", stages: everyStage },
  // Only on All profiles, which spans every stage. On a stage tab every row
  // would say the same thing as the tab itself.
  { id: "status", label: "Status", kind: "text", editable: false, width: "md", stages: ["all_profiles"] },
  { id: "linkedin", label: "LinkedIn", kind: "text", editable: true, width: "sm", stages: everyStage },
  { id: "source", label: "Source", kind: "text", editable: false, width: "md", stages: triageStages },
  {
    id: "rating",
    label: "Rating",
    kind: "number",
    editable: true,
    width: "xs",
    numeric: true,
    placeholder: "0.0–5.0",
    stages: triageStages,
  },
  {
    id: "phone",
    label: "Mobile",
    kind: "text",
    editable: true,
    width: "sm",
    placeholder: "98765 43210",
    stages: ["profile_shortlisted", ...detailStages],
  },
  // The second number a candidate gives for when the first does not answer.
  // It sits beside the primary wherever the primary is: calling starts at
  // Profile shortlisted, and that is where the first number goes unanswered.
  {
    id: "alternate_phone",
    label: "Alternate",
    kind: "text",
    editable: true,
    width: "sm",
    placeholder: "98765 43210",
    stages: ["profile_shortlisted", ...detailStages],
  },
  { id: "email", label: "Email", kind: "text", editable: true, width: "lg", stages: detailStages },
  {
    id: "location",
    label: "Location",
    kind: "text",
    editable: true,
    width: "md",
    stages: detailStages,
  },
  {
    id: "current_company",
    label: "Company",
    kind: "text",
    editable: true,
    width: "md",
    stages: detailStages,
  },
  {
    id: "current_designation",
    label: "Designation",
    kind: "text",
    editable: true,
    width: "lg",
    stages: detailStages,
  },
  {
    id: "total_experience_years",
    label: "Exp",
    kind: "number",
    editable: true,
    width: "xs",
    numeric: true,
    stages: detailStages,
  },
  {
    id: "current_ctc",
    label: "CTC",
    kind: "text",
    editable: true,
    width: "sm",
    numeric: true,
    placeholder: "18 LPA",
    stages: detailStages,
  },
  {
    id: "highest_qualification",
    label: "Qualification",
    kind: "text",
    editable: true,
    width: "md",
    stages: detailStages,
  },
  { id: "resume", label: "Resume", kind: "text", editable: false, width: "xs", stages: detailStages },
  { id: "notes", label: "Notes", kind: "text", editable: true, width: "lg", stages: detailStages },
];

// Rejections and offers are outcomes rather than details to fill in, so they
// sit after the detail block on the one tab each belongs to.
const tabExtras: Partial<Record<Stage, Spec[]>> = {
  rejected: [
    { id: "reject_type", label: "Reject type", kind: "text", editable: false, width: "sm", stages: [] },
    { id: "reject_reason", label: "Reason", kind: "text", editable: false, width: "lg", stages: [] },
  ],
  offer_sent: [
    { id: "offer_details", label: "Offer", kind: "text", editable: false, width: "md", stages: [] },
    { id: "outcome", label: "Outcome", kind: "select", editable: true, width: "md", stages: [] },
  ],
};

function withoutStages(spec: Spec): CandidateColumn {
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
  const columns: CandidateColumn[] = specs
    .filter((spec) => spec.stages.includes(stage))
    .map(withoutStages);
  if (detailStages.includes(stage))
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
  columns.push(...(tabExtras[stage] ?? []).map(withoutStages));
  // With the name column gone from triage, the LinkedIn URL is what identifies
  // a row. It leads the table and takes the room the name gave up, so it reads
  // as the identity column rather than truncating three columns in. The rating
  // follows it: on these tabs the job is to look at a profile and score it, so
  // the two columns that work belong together rather than with a date and a
  // source between them.
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
