import { csvTemplateColumns } from "./import";
import { pipelineStages, type PipelineStage } from "./stages";

// One template, for every stage.
//
// It used to be cut down to the columns the chosen stage happens to show,
// which meant an All profiles import could carry a name and a URL and nothing
// else. But a stage decides what is worth *looking at* there, not what a
// candidate record can hold: every column below is written to the candidate
// itself, so detail typed in at All profiles is waiting on the row by the time
// it reaches recruiter review. Asking a team to come back and type it again
// later, into a different sheet, is work for nothing.
//
// Columns the app owns are still absent, because they are recorded rather than
// typed: when a row was added, which resume is attached, why somebody was
// rejected and what was offered.

export type TemplateColumn = { header: string; example: string; required: boolean };

// Keyed by the header the template writes, so a column cannot be added to the
// file without an example beside it in the dialog. A test holds the two
// together. A Naukri URL still imports — it is a recognised alias — it is just
// not one of the columns we hand out.
const examples: Record<string, string> = {
  "Full Name": "Priya Raman",
  "LinkedIn URL": "https://www.linkedin.com/in/priya-raman",
  Rating: "4.6",
  Email: "priya.raman@example.com",
  Phone: "+91 98765 43210",
  Company: "Zoho",
  Designation: "Engineering Manager",
  Location: "Bengaluru",
  "Experience (years)": "11",
  CTC: "42 LPA",
  Qualification: "B.E. Computer Science",
  Source: "LinkedIn Recruiter",
};

export function templateColumns(): TemplateColumn[] {
  // Only the profile URL is required. A blank name is read off the profile
  // slug on import, so a file of URLs alone is a valid import.
  return csvTemplateColumns.map((header) => ({
    header,
    example: examples[header] ?? "",
    required: header === "LinkedIn URL",
  }));
}

function csvValue(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

// Headers only. An example row inside the file gets imported by anyone who
// uploads the template without deleting it first, which puts an invented
// person into the database. The examples are shown in the import dialog
// instead, where they teach the format without being data.
export function templateCsv(): string {
  return templateColumns()
    .map((column) => csvValue(column.header))
    .join(",");
}

// No stage in the name: the same file is correct at every one of them, and a
// name that claimed otherwise would have people downloading it again.
export function templateFileName(roleName: string): string {
  const slug =
    roleName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "role";
  return `${slug}-import-template.csv`;
}

export const importStages: readonly PipelineStage[] = pipelineStages;
