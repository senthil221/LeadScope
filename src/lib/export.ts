export const exportColumns = [
  "LinkedIn URL",
  "Result Title",
  "Snippet",
  "Campaign",
  "Manual Decision",
  "Rule Assessment",
  "Qualification Reasons",
  "Source Query",
  "First Seen",
  "Last Seen",
  "Reviewed At",
  "Notes",
];
export function safeCell(value: unknown): string {
  const text = String(value ?? "").replace(/\u0000/g, "");
  return /^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)
    ? `'${text}`
    : text;
}
export function serializeExport(
  rows: unknown[][],
  format: "csv" | "tsv",
): string {
  return [exportColumns, ...rows]
    .map((row) =>
      row
        .map((cell) => {
          const text = safeCell(cell);
          return format === "csv"
            ? `"${text.replace(/"/g, '""')}"`
            : text.replace(/[\t\r\n]+/g, " ");
        })
        .join(format === "csv" ? "," : "\t"),
    )
    .join("\r\n");
}
