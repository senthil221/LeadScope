import type { RoleCandidate } from "@/lib/types";
import {
  candidateSourceLabel,
  isStage,
  outcomes,
  stageLabels,
} from "./stages";

export const roleCandidateExportColumns = [
  "Date entered stage",
  "Stage",
  "Full name",
  "Headline",
  "Designation",
  "Company",
  "Location",
  "Experience (years)",
  "Rating (/5)",
  "Source",
  "Source detail",
  "Phone",
  "Email",
  "Client notes",
  "Offer amount",
  "Offer currency",
  "Offer sent",
  "Response due",
  "Expected start",
  "Offer outcome",
  "Rejection type",
  "Rejection reason",
];

export function roleCandidateExportCells(candidate: RoleCandidate): unknown[] {
  return [
    candidate.stage_entered_at,
    isStage(candidate.stage) ? stageLabels[candidate.stage] : candidate.stage,
    candidate.candidates.full_name,
    candidate.candidates.headline,
    candidate.candidates.current_designation,
    candidate.candidates.current_company,
    candidate.candidates.location,
    candidate.candidates.total_experience_years,
    candidate.rating,
    candidateSourceLabel(candidate.source),
    candidate.source_detail,
    candidate.candidates.phone,
    candidate.candidates.email,
    candidate.client_notes,
    candidate.offer_amount,
    candidate.offer_currency,
    candidate.offer_sent_on,
    candidate.offer_response_due_at,
    candidate.expected_start_at,
    outcomes[candidate.outcome as keyof typeof outcomes] ?? candidate.outcome,
    candidate.rejection_type,
    candidate.rejection_reason,
  ];
}
