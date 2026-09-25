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
  sourceDetail: string;
  rating?: RatingFilter;
  enteredFrom?: string;
  enteredTo?: string;
  sort: "newest" | "oldest" | "rating_high" | "rating_low";
};

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || !parsed.toISOString().startsWith(value)
    ? undefined
    : value;
}

function startOfNextDay(value: string) {
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function searchTerm(value: string | undefined) {
  return (value ?? "")
    .trim()
    .slice(0, 200)
    .replace(/[\\%_,().]/g, "\\$&");
}

export function roleCandidateListFilters(
  raw: Record<string, string | undefined>,
): RoleCandidateListFilters {
  const source = candidateSources.includes(raw.source as CandidateSource)
    ? (raw.source as CandidateSource)
    : undefined;
  const rating = isRatingFilter(raw.rating) ? raw.rating : undefined;
  const enteredFrom = validDate(raw.entered_from);
  const enteredTo = validDate(raw.entered_to);
  const sort = ["oldest", "rating_high", "rating_low"].includes(raw.sort ?? "")
    ? (raw.sort as RoleCandidateListFilters["sort"])
    : "newest";
  return {
    query: searchTerm(raw.q),
    source,
    sourceDetail: searchTerm(raw.source_detail),
    rating,
    enteredFrom,
    enteredTo,
    sort,
  };
}

// An exact total is useful after a recruiter narrows the list, but it makes
// every ordinary stage switch scan the candidate join just to repeat the
// already-available stage total. Keep the expensive count for filtered lists.
export function hasRoleCandidateListFilters(filters: RoleCandidateListFilters) {
  return Boolean(
    filters.query ||
      filters.source ||
      filters.sourceDetail ||
      filters.rating ||
      filters.enteredFrom ||
      filters.enteredTo,
  );
}

export function roleCandidateListQuery(
  db: SupabaseClient,
  roleId: string,
  stage: Stage,
  ratingThreshold: number,
  filters: RoleCandidateListFilters,
  includeTotal = true,
  // The whole row by default; a caller that only needs ids says so, because
  // two thousand joined candidate records is a different kind of request.
  columns = "*,candidates!inner(*,candidate_identities(kind,normalized_value))",
) {
  let query = db
    .from("role_candidates")
    .select(
      columns,
      includeTotal ? { count: "exact" } : undefined,
    )
    .eq("role_id", roleId);
  // All profiles is the role's full list, not a stage. Rating someone moves
  // them into Profile shortlisted, and they stay visible here afterwards, so
  // it stays the one place to check whether a person is already on the role.
  // Rejected rows are included for the same reason: re-adding someone you
  // turned down is exactly the mistake this view prevents.
  if (stage !== "all_profiles") query = query.eq("stage", stage);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.sourceDetail)
    query = query.ilike("source_detail", `%${filters.sourceDetail}%`);
  if (filters.enteredFrom)
    query = query.gte("stage_entered_at", `${filters.enteredFrom}T00:00:00.000Z`);
  if (filters.enteredTo)
    query = query.lt("stage_entered_at", startOfNextDay(filters.enteredTo));
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
