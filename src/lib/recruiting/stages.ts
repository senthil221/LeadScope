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
export const candidateSources = [
  "linkedin",
  "naukri",
  "manual",
  "url_paste",
  "csv",
  "sourcing_import",
  "other",
] as const;
export type CandidateSource = (typeof candidateSources)[number];
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
// Rejected is terminal here: advancing out of it is an explicit stage move,
// never the "next stage" button.
export function nextStage(stage: Stage): PipelineStage | null {
  const index = pipelineStages.indexOf(stage as PipelineStage);
  if (index < 0 || index === pipelineStages.length - 1) return null;
  return pipelineStages[index + 1];
}
