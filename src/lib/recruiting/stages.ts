// The pipeline, in order. Mirrored by the stage CHECK constraint on
// public.role_candidates; tests/recruiting.test.ts asserts the two agree.
export const pipelineStages = [
  "all_profiles",
  "profile_shortlisted",
  "recruiter_shortlisted",
  "client_shortlisted",
  "offer_sent",
] as const;
export type PipelineStage = (typeof pipelineStages)[number];
export type Stage = PipelineStage | "rejected";
export const stages: readonly Stage[] = [...pipelineStages, "rejected"];
export const stageLabels: Record<Stage, string> = {
  all_profiles: "All profiles",
  profile_shortlisted: "Profile shortlisted",
  recruiter_shortlisted: "Recruiter shortlisted",
  client_shortlisted: "Client shortlisted",
  offer_sent: "Offer sent",
  rejected: "Rejected",
};
export const rejectionTypes = {
  recruiter: "Recruiter reject",
  client: "Client reject",
} as const;
export type RejectionType = keyof typeof rejectionTypes;
// Where a profile came from — the six the agency actually works with. The
// list used to mix these with the mechanism a row arrived by (typed, pasted,
// a CSV), which is not the same question and answered a less useful one.
export const candidateSources = [
  "linkedin",
  "naukri",
  "google",
  "csv",
  "master_db",
  "other",
] as const;
export type CandidateSource = (typeof candidateSources)[number];
export const candidateSourceLabels: Record<CandidateSource, string> = {
  linkedin: "LinkedIn Recruiter",
  naukri: "Naukri",
  google: "Google Search",
  csv: "CSV Import",
  master_db: "Master Database",
  other: "Other Source",
};
// Most profiles come from LinkedIn Recruiter, so that is what a row gets
// unless somebody says otherwise.
export const defaultCandidateSource: CandidateSource = "linkedin";
// Not offered any more. Kept so a row recorded before the list settled still
// reads as something rather than as its database value.
const retiredSourceLabels: Record<string, string> = {
  manual: "Manual entry",
  url_paste: "Pasted profile URLs",
  sourcing_import: "Sourcing workspace",
};
// What a Source cell in an uploaded file means. The label as we write it, the
// stored value, and the short spellings a sheet actually carries. Anything
// else is not a source we know, and the batch setting stands instead.
const sourceCellAliases: Record<string, CandidateSource> = {
  linkedin: "linkedin",
  "linked in": "linkedin",
  "linkedin recruiter": "linkedin",
  recruiter: "linkedin",
  naukri: "naukri",
  resdex: "naukri",
  "naukri resdex": "naukri",
  google: "google",
  "google search": "google",
  csv: "csv",
  "csv import": "csv",
  sheet: "csv",
  "master database": "master_db",
  "master db": "master_db",
  master_db: "master_db",
  other: "other",
  "other source": "other",
};
export function candidateSourceFromCell(value: string): CandidateSource | null {
  const key = value.trim().toLowerCase().replace(/[^a-z_ ]+/g, " ").replace(/\s+/g, " ").trim();
  return sourceCellAliases[key] ?? null;
}
// Naukri profiles are not rated here, so waiting in All profiles for a score
// nobody intends to give would be waiting forever. They start one stage on.
export function sourceSkipsRating(source: string) {
  return source === "naukri";
}
export const ratingFilters = [
  "unrated",
  "meets_floor",
  "below_floor",
] as const;
export type RatingFilter = (typeof ratingFilters)[number];
export const ratingFilterLabels: Record<RatingFilter, string> = {
  unrated: "Needs rating",
  meets_floor: "At or above rating floor",
  below_floor: "Below rating floor",
};
// The source alone. A free text note about the batch used to win over it,
// which made the same source read three different ways down one column.
export function candidateSourceLabel(source: string) {
  return (
    candidateSourceLabels[source as CandidateSource] ??
    retiredSourceLabels[source] ??
    "Other Source"
  );
}
export const outcomes = {
  offer_sent: "Offer sent",
  offer_accepted: "Offer accepted",
  offer_declined: "Offer declined",
  joined: "Joined",
} as const;
export type Outcome = keyof typeof outcomes;
export function isPipelineStage(value: unknown): value is PipelineStage {
  return pipelineStages.includes(value as PipelineStage);
}
export function isStage(value: unknown): value is Stage {
  return stages.includes(value as Stage);
}
export function isRatingFilter(value: unknown): value is RatingFilter {
  return ratingFilters.includes(value as RatingFilter);
}
// Rejected is terminal here: advancing out of it is an explicit stage move,
// never the "next stage" button.
export function nextStage(stage: Stage): PipelineStage | null {
  const index = pipelineStages.indexOf(stage as PipelineStage);
  if (index < 0 || index === pipelineStages.length - 1) return null;
  return pipelineStages[index + 1];
}
