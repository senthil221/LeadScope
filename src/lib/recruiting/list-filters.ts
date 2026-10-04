/** One transport contract for the table, selection, saved views and exports. */
export const roleFilterKeys = ["q", "source", "source_detail", "rating", "entered_from", "entered_to", "sort", "contact", "stale"] as const;
export function serializeRoleFilters(params: Pick<URLSearchParams, "get">) {
  return Object.fromEntries(roleFilterKeys.flatMap((key) => {
    const value = params.get(key);
    return value ? [[key, value]] : [];
  }));
}
export function profileSearchTerm(value: string) {
  const text = value.trim().slice(0, 200);
  if (/^[+\d\s().-]+$/.test(text) && text.replace(/\D/g, "").length >= 6)
    return text.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (/linkedin\.com\/in\//i.test(text))
    return text.replace(/^https?:\/\//i, "").replace(/^(?:www|[a-z]{2})\./i, "").split(/[?#]/)[0].replace(/\/$/, "").toLowerCase();
  return text;
}
