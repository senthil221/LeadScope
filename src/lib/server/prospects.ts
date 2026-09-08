import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prospectFilters } from "../prospects";

export function prospectQuery(
  db: SupabaseClient,
  client: string,
  filters: ReturnType<typeof prospectFilters>,
) {
  let query = db
    .from("accepted_prospect_rows")
    .select(
      "id,client_id,canonical_url,title,snippet,contact_status,notes,source_query,campaign_name,date_added",
      { count: "exact" },
    )
    .eq("client_id", client);
  if (filters.contact) query = query.eq("contact_status", filters.contact);
  if (filters.q)
    query = query.ilike(
      "search_text",
      `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`,
    );
  return query.order("date_added", { ascending: false }).order("id");
}
