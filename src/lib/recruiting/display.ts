// Shared by server-rendered pages and client tables. An explicit locale and
// zone prevent hydration mismatches and keep date-only fields on their day.
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

export function formatRecruitingDate(value: string | null | undefined): string {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not provided" : dateFormatter.format(date);
}
