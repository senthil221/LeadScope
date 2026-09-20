import type { RoleField } from "../types";
import type { Stage } from "./stages";

export type CellKind = "text" | "number" | "date" | "select" | "boolean";

export type CandidateColumnId =
  | "date_added"
  | "linkedin"
  | "source"
  | "rating"
  | "phone"
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

export type CandidateColumn = {
  id: CandidateColumnId | `custom:${string}`;
  label: string;
  kind: CellKind;
  editable: boolean;
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

type Spec = Omit<CandidateColumn, "field"> & { stages: Stage[] };

const specs: Spec[] = [
  { id: "date_added", label: "Date added", kind: "date", editable: false, stages: everyStage },
  { id: "linkedin", label: "LinkedIn", kind: "text", editable: false, stages: everyStage },
  { id: "source", label: "Source", kind: "text", editable: false, stages: triageStages },
  {
    id: "rating",
    label: "Rating",
    kind: "number",
    editable: true,
    placeholder: "0.0–5.0",
    stages: triageStages,
  },
  {
    id: "phone",
    label: "Mobile number",
    kind: "text",
    editable: true,
    placeholder: "+91…",
    stages: ["profile_shortlisted", ...detailStages],
  },
  { id: "email", label: "Email", kind: "text", editable: true, stages: detailStages },
  {
    id: "location",
    label: "Current location",
    kind: "text",
    editable: true,
    stages: detailStages,
  },
  {
    id: "current_company",
    label: "Current company",
    kind: "text",
    editable: true,
    stages: detailStages,
  },
  {
    id: "current_designation",
    label: "Current designation",
    kind: "text",
    editable: true,
    stages: detailStages,
  },
  {
    id: "total_experience_years",
    label: "Experience (yrs)",
    kind: "number",
    editable: true,
    stages: detailStages,
  },
  {
    id: "current_ctc",
    label: "Current CTC",
    kind: "text",
    editable: true,
    placeholder: "18 LPA",
    stages: detailStages,
  },
  {
    id: "highest_qualification",
    label: "Highest qualification",
    kind: "text",
    editable: true,
    stages: detailStages,
  },
  { id: "resume", label: "Resume", kind: "text", editable: false, stages: detailStages },
  { id: "notes", label: "Notes", kind: "text", editable: true, stages: detailStages },
];

// Rejections and offers are outcomes rather than details to fill in, so they
// sit after the detail block on the one tab each belongs to.
const tabExtras: Partial<Record<Stage, Spec[]>> = {
  rejected: [
    { id: "reject_type", label: "Reject type", kind: "text", editable: false, stages: [] },
    { id: "reject_reason", label: "Reason", kind: "text", editable: false, stages: [] },
  ],
  offer_sent: [
    { id: "offer_details", label: "Offer details", kind: "text", editable: false, stages: [] },
    { id: "outcome", label: "Outcome", kind: "select", editable: true, stages: [] },
  ],
};

function withoutStages(spec: Spec): CandidateColumn {
  return {
    id: spec.id,
    label: spec.label,
    kind: spec.kind,
    editable: spec.editable,
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
        field,
      })),
    );
  columns.push(...(tabExtras[stage] ?? []).map(withoutStages));
  return columns;
}
