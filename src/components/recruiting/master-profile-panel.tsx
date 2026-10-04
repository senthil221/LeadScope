"use client";
import type { MasterCandidate } from "@/lib/types";
import { SheetCell } from "./sheet-cell";
import { TableDialog } from "./table-dialog";
import { ProfileContext } from "./profile-context";
import { saveCell } from "@/lib/client/save-cell";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
export function MasterProfilePanel({ profile, onClose, onChanged, onPrevious, onNext }: { profile: MasterCandidate; onClose: () => void; onChanged: () => void; onPrevious?: () => void; onNext?: () => void }) {
  const fields = [{ id: "full_name", label: "Full name" }, { id: "current_company", label: "Company" }, { id: "current_designation", label: "Designation" }, { id: "location", label: "Location" }, { id: "phone", label: "Mobile" }, { id: "alternate_phone", label: "Alternate mobile" }, { id: "email", label: "Email" }, { id: "headline", label: "Headline" }, { id: "total_experience_years", label: "Experience (years)" }, { id: "current_ctc", label: "Current CTC" }, { id: "highest_qualification", label: "Qualification" }] as const;
  return <TableDialog titleId="master-profile-title" className="candidate-drawer" onClose={onClose}>
    <div className="modal-heading candidate-drawer-heading"><h2 id="master-profile-title">{profile.full_name}</h2><div className="row"><button aria-label="Previous profile" disabled={!onPrevious} onClick={onPrevious}><ChevronLeft size={16} /></button><button aria-label="Next profile" disabled={!onNext} onClick={onNext}><ChevronRight size={16} /></button><button aria-label="Close profile" onClick={onClose}><X size={16} /></button></div></div>
    <div className="candidate-drawer-body">
    <p className="muted">Shared profile details update everywhere this person appears. Ratings and recruiter notes stay with each role.</p>
    <div data-sheet-grid className="profile-editor">{fields.map((f, i) => <div key={f.id}><span>{f.label}</span><SheetCell row={i} col={0} label={f.label} value={String(profile[f.id] ?? "")} placeholder={`Add ${f.label.toLowerCase()}`} kind={f.id === "total_experience_years" ? "number" : "text"} save={async (value, expected) => { await saveCell("profile", profile.id, f.id, value, expected); onChanged(); }} /></div>)}<div><span>LinkedIn</span><SheetCell row={fields.length} col={0} label="LinkedIn" value={profile.candidate_identities?.find((i) => i.kind === "linkedin")?.normalized_value ?? ""} save={async (value, expected) => { await saveCell("profile", profile.id, "linkedin", value, expected); onChanged(); }} /></div></div>
    <ProfileContext candidateId={profile.id} />
    </div>
  </TableDialog>;
}
