import type { Assessment, CampaignConfig, Query } from "./domain";
export type Client = {
  id: string;
  name: string;
  notes: string;
  archived: boolean;
  created_at: string;
};
export type Campaign = {
  id: string;
  client_id: string;
  name: string;
  config: CampaignConfig;
  revision: number;
  criteria_version: number;
  archived: boolean;
  created_at: string;
};
export type SavedQuery = Query & {
  id: string;
  ordinal: number;
  revision: number;
};
export type Run = {
  id: string;
  campaign_id: string;
  client_id: string;
  snapshot: CampaignConfig;
  status: string;
  budget: number;
  target: number;
  reserved: number;
  dispatched: number;
  new_client_profiles: number;
  new_candidates: number;
  rule_matches: number;
  reviews: number;
  rejected: number;
  suppressed: number;
  duplicates: number;
  errors: number;
  stop_reason: string | null;
  created_at: string;
};
export type Job = {
  id: string;
  run_query_id: string;
  page_number: number;
  attempts: number;
  status: string;
  retry_at: string | null;
  failure_code: string | null;
  metrics: Record<string, number | boolean>;
};
export type RunQuery = {
  id: string;
  text: string;
  strategy: string;
  skipped: boolean;
  skip_reason: string | null;
  prior_pages: number[];
  last_success_at: string | null;
};
export type Lead = {
  id: string;
  client_id: string;
  campaign_id: string;
  client_profile_id: string;
  canonical_url: string;
  title: string;
  snippet: string;
  campaign_name: string;
  status: string;
  automatic_status: string;
  manual_decision: string | null;
  decision_note: string;
  decided_at: string | null;
  notes: string;
  first_seen: string;
  last_seen: string;
  assessment: Assessment;
  prior_assessment: Assessment | null;
  current_version: number;
  criteria_version: number;
  suppressed: boolean;
  decision_was_rule_match: boolean | null;
};
export type Discovery = {
  id: string;
  title: string;
  snippet: string;
  original_url: string;
  position: number;
  observed_at: string;
  assessment: Assessment;
  search_jobs: {
    page_number: number;
    run_queries: { text: string; strategy: string };
  };
};
export type Suppression = {
  id: string;
  canonical_url: string;
  reason: string;
  note: string;
  active: boolean;
  updated_at: string;
};
export type ReviewEvent = {
  id: string;
  actor: string;
  decision: string;
  note: string;
  was_rule_match: boolean;
  created_at: string;
};
export type SuppressionEvent = {
  id: string;
  actor: string;
  canonical_url: string;
  reason: string;
  note: string;
  active: boolean;
  created_at: string;
};
export type Role = {
  id: string;
  client_id: string;
  name: string;
  description: string;
  rating_threshold: number;
  status: string;
  archived: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
};
export type MasterCandidate = {
  id: string;
  full_name: string;
  headline: string;
  current_company: string;
  current_designation: string;
  location: string;
  total_experience_years: number | null;
  phone: string | null;
  email: string | null;
  resume_path: string | null;
  enrichment_state: string;
  created_at: string;
};
export type RoleCandidate = {
  id: string;
  role_id: string;
  candidate_id: string;
  stage: string;
  rating: number | null;
  source: string;
  screening: Record<string, unknown>;
  custom: Record<string, string | number | boolean>;
  internal_notes: string;
  client_notes: string;
  rejection_type: string | null;
  rejection_reason: string;
  outcome: string | null;
  outcome_at: string | null;
  stage_entered_at: string;
  created_at: string;
  candidates: MasterCandidate;
};
export type RoleField = {
  id: string;
  role_id: string;
  key: string;
  label: string;
  kind: "text" | "number" | "date" | "select" | "boolean";
  options: string[];
  ordinal: number;
  archived: boolean;
};
export type StageFunnelRow = {
  role_id: string;
  client_id: string;
  stage: string;
  ever_reached: number;
  currently_here: number;
};
export type StageDurationRow = {
  role_id: string;
  client_id: string;
  stage: string;
  completed_count: number;
  median_days: number | null;
};
export type ShareLink = {
  id: string;
  stage: string;
  token_prefix: string;
  visible_columns: string[];
  allow_decisions: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_viewed_at: string | null;
};
export type Preflight = {
  revision: number;
  queries: {
    id: string;
    text: string;
    strategy: string;
    skipped: boolean;
    lastSuccess: string | null;
    priorPages: number[];
  }[];
  eligible: number;
  cap: number;
  pages: number;
  target: number;
};
export type PageData = {
  prospects?: import("./prospects").Prospect[];
  reviewEvents?: ReviewEvent[];
  suppressionEvents?: SuppressionEvent[];
  view: string;
  clients: Client[];
  campaigns: Campaign[];
  client?: Client;
  campaign?: Campaign;
  queries?: SavedQuery[];
  runs?: Run[];
  run?: Run;
  jobs?: Job[];
  runQueries?: RunQuery[];
  leads?: Lead[];
  lead?: Lead;
  discoveries?: Discovery[];
  suppressions?: Suppression[];
  total?: number;
  page?: number;
  counts?: Record<string, number>;
  checks?: Record<string, boolean>;
  live: boolean;
  serverCap?: number;
  activeRuns?: Pick<
    Run,
    | "id"
    | "client_id"
    | "campaign_id"
    | "status"
    | "reserved"
    | "budget"
    | "new_candidates"
  >[];
  email: string;
  reviewSeconds?: number;
  precision?: { accepted: number; adjudicated: number };
  dispatched?: number;
  roles?: Role[];
  role?: Role;
  roleCandidates?: RoleCandidate[];
  roleCandidateCounts?: Record<string, number>;
  masterCandidates?: MasterCandidate[];
  sourcingProspects?: { id: string; canonical_url: string; title: string }[];
  roleFields?: RoleField[];
  shareLinks?: ShareLink[];
  roleStageFunnel?: StageFunnelRow[];
  roleStageDurations?: StageDurationRow[];
};
