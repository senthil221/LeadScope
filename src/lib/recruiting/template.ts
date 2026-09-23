import { candidateColumns, type CandidateColumnId } from "./columns";
import { csvTemplateColumns } from "./import";
import { pipelineStages, stageLabels, type PipelineStage } from "./stages";

// An import fills the same columns the grid shows for that stage, and nothing
// else. The template is generated from the column registry rather than written
// out by hand, so a column added to a stage appears in its template on the
// next build instead of quietly going missing.

// Grid column -> the header a recruiter sees in the template, and the import
// column it feeds. Columns the app owns (date added, source, resume) and
// outcomes (rejection, offer) are absent: they are recorded by the app, not
// typed into a sheet.
const importable: Partial<Record<CandidateColumnId, { header: string; example: string }>> = {
  linkedin: { header: "LinkedIn URL", example: "https://www.linkedin.com/in/priya-raman" },
  phone: { header: "Phone", example: "+91 98765 43210" },
  email: { header: "Email", example: "priya.raman@example.com" },
  location: { header: "Location", example: "Bengaluru" },
  current_company: { header: "Company", example: "Zoho" },
  current_designation: { header: "Designation", example: "Engineering Manager" },
  total_experience_years: { header: "Experience (years)", example: "11" },
  current_ctc: { header: "CTC", example: "42 LPA" },
  highest_qualification: { header: "Qualification", example: "B.E. Computer Science" },
};

export type TemplateColumn = { header: string; example: string; required: boolean };

// Full Name leads every template. It is the frozen first column of the grid
// rather than one of the stage columns, so it is not in the registry.
export function templateColumns(stage: PipelineStage): TemplateColumn[] {
  const columns: TemplateColumn[] = [
    { header: "Full Name", example: "Priya Raman", required: true },
  ];
  for (const column of candidateColumns(stage, [])) {
    const entry = importable[column.id as CandidateColumnId];
    if (entry) columns.push({ ...entry, required: column.id === "linkedin" });
  }
  return columns;
}

function csvValue(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

// Headers only. An example row inside the file gets imported by anyone who
// uploads the template without deleting it first, which puts an invented
// person into the database. The examples are shown in the import dialog
// instead, where they teach the format without being data.
export function templateCsv(stage: PipelineStage): string {
  return templateColumns(stage)
    .map((column) => csvValue(column.header))
    .join(",");
}

export function templateFileName(roleName: string, stage: PipelineStage): string {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "role";
  return `${slug(roleName)}-${slug(stageLabels[stage])}-import-template.csv`;
}

export const importStages: readonly PipelineStage[] = pipelineStages;

// Every header the parser understands, for the "recognized columns" hint. The
// template is the subset a given stage asks for; a file exported from another
// stage still imports, its extra columns simply ignored.
export const everyTemplateHeader = csvTemplateColumns;
