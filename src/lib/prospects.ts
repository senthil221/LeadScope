export const contactStatuses = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  replied: "Replied",
  follow_up: "Follow up",
  not_interested: "Not interested",
} as const;
export type ContactStatus = keyof typeof contactStatuses;
export type Prospect = {
  id: string;
  client_id: string;
  canonical_url: string;
  title: string;
  snippet: string;
  contact_status: ContactStatus;
  notes: string;
  source_query: string;
  campaign_name: string;
  date_added: string;
};
export function prospectFilters(params: { get(name: string): string | null }) {
  const contact = params.get("contact") ?? "";
  return {
    q: (params.get("q") ?? "").trim().slice(0, 200),
    contact: Object.hasOwn(contactStatuses, contact)
      ? (contact as ContactStatus)
      : "",
    page: Math.max(
      1,
      Math.min(100000, Math.floor(Number(params.get("page")) || 1)),
    ),
  };
}
export const prospectColumns = [
  "Title",
  "LinkedIn URL",
  "Snippet",
  "Prospect contacted",
  "Notes",
  "Query info",
  "Date added",
  "Campaign",
];
export function prospectCells(row: Prospect) {
  return [
    row.title,
    row.canonical_url,
    row.snippet,
    contactStatuses[row.contact_status],
    row.notes,
    row.source_query,
    row.date_added,
    row.campaign_name,
  ];
}
