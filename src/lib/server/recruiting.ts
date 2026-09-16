import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  candidateSources,
  isRatingFilter,
  type CandidateSource,
  type RatingFilter,
  type Stage,
} from "@/lib/recruiting/stages";

export type RoleCandidateListFilters = {
  query: string;
  source?: CandidateSource;
  rating?: RatingFilter;
  sort: "newest" | "oldest" | "rating_high" | "rating_low";
};

export function roleCandidateListFilters(
  raw: Record<string, string | undefined>,
): RoleCandidateListFilters {
  const source = candidateSources.includes(raw.source as CandidateSource)
    ? (raw.source as CandidateSource)
    : undefined;
  const rating = isRatingFilter(raw.rating) ? raw.rating : undefined;
  const sort = ["oldest", "rating_high", "rating_low"].includes(raw.sort ?? "")
    ? (raw.sort as RoleCandidateListFilters["sort"])
    : "newest";
  return {
    query: (raw.q ?? "")
      .trim()
      .slice(0, 200)
      .replace(/[\\%_,().]/g, "\\$&"),
    source,
    rating,
    sort,
  };
}

export function roleCandidateListQuery(
  db: SupabaseClient,
  roleId: string,
  stage: Stage,
  ratingThreshold: number,
  filters: RoleCandidateListFilters,
) {
  let query = db
    .from("role_candidates")
    .select("*,candidates!inner(*)", { count: "exact" })
    .eq("role_id", roleId)
    .eq("stage", stage);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.rating === "unrated") query = query.is("rating", null);
  else if (filters.rating === "meets_floor")
    query = query.gte("rating", ratingThreshold);
  else if (filters.rating === "below_floor")
    query = query.lt("rating", ratingThreshold);
  if (filters.query)
    query = query.or(
      [
        `full_name.ilike.%${filters.query}%`,
        `headline.ilike.%${filters.query}%`,
        `current_company.ilike.%${filters.query}%`,
        `current_designation.ilike.%${filters.query}%`,
      ].join(","),
      { referencedTable: "candidates" },
    );
  if (filters.sort === "rating_high")
    query = query.order("rating", { ascending: false, nullsFirst: false });
  else if (filters.sort === "rating_low")
    query = query.order("rating", { ascending: true, nullsFirst: false });
  else
    query = query.order("stage_entered_at", {
      ascending: filters.sort !== "oldest",
    });
  return query.order("id");
}
