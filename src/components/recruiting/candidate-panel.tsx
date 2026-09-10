"use client";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { RoleCandidate } from "@/lib/types";
import {
  isStage,
  nextStage,
  stageLabels,
  type Stage,
} from "@/lib/recruiting/stages";
import { RejectDialog } from "./reject-dialog";

async function act<T = { ok: true }>(action: string, payload: unknown): Promise<T> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not save. Try again.");
  return result;
}

// Screening keys, matching the spec's list minus location and recruiter
// notes: location already lives on the candidate record, and "recruiter
// notes" is the existing internal_notes column, saved alongside this in one
// action rather than duplicated inside the jsonb.
type Screening = {
  interest?: "" | "yes" | "no" | "maybe";
  currentCtc?: string;
  expectedCtc?: string;
  noticePeriod?: string;
  availability?: string;
  experienceNote?: string;
  recruiterAssessment?: string;
  followUpAt?: string;
};
const screeningLabels: Record<keyof Screening, string> = {
  interest: "Interest",
  currentCtc: "Current CTC",
  expectedCtc: "Expected CTC",
  noticePeriod: "Notice period",
  availability: "Availability",
  experienceNote: "Experience notes",
  recruiterAssessment: "Recruiter assessment",
  followUpAt: "Follow-up date",
};

// Recruiter Screening is a panel on a candidate row, not a tab: this dialog
// is that panel. It edits reusable candidate details (folding in the manual
// phone/email entry originally scoped as its own enrichment phase),
// role-specific screening answers, internal notes, and a resume, then offers
// the same Suitable/Not-suitable outcome the flow diagram describes —
// reusing the existing moveStage and reject actions rather than duplicating
// their logic here.
export function CandidatePanel({
  clientId,
  roleCandidate,
  onClose,
  onChanged,
}: {
  clientId: string;
  roleCandidate: RoleCandidate;
  onClose: () => void;
  onChanged: () => void;
}) {
  const rc = roleCandidate;
  const c = rc.candidates;
  const currentStage: Stage = isStage(rc.stage) ? rc.stage : "all_profiles";
  const advanceTo = nextStage(currentStage);
  const fileRef = useRef<HTMLInputElement>(null);

  const [details, setDetails] = useState({
    fullName: c.full_name,
    headline: c.headline,
    currentCompany: c.current_company,
    currentDesignation: c.current_designation,
    location: c.location,
    totalExperienceYears:
      c.total_experience_years != null ? String(c.total_experience_years) : "",
    phone: c.phone ?? "",
    email: c.email ?? "",
  });
  const [screening, setScreening] = useState<Screening>(
    (rc.screening as Screening) ?? {},
  );
  const [internalNotes, setInternalNotes] = useState(rc.internal_notes);
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingScreening, setSavingScreening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function saveDetails() {
    setSavingDetails(true);
    setError("");
    try {
      await act("candidateDetails", {
        id: c.id,
        fullName: details.fullName,
        headline: details.headline,
        currentCompany: details.currentCompany,
        currentDesignation: details.currentDesignation,
        location: details.location,
        totalExperienceYears: details.totalExperienceYears.trim()
          ? Number(details.totalExperienceYears)
          : null,
        phone: details.phone.trim() || null,
        email: details.email.trim() || null,
      });
      setMessage("Candidate details saved.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingDetails(false);
    }
  }
  async function saveScreening() {
    setSavingScreening(true);
    setError("");
    try {
      await act("screening", {
        clientId,
        id: rc.id,
        screening,
        internalNotes,
      });
      setMessage("Screening saved.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingScreening(false);
    }
  }
  async function uploadResume() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("candidateId", c.id);
      form.set("file", file);
      const response = await fetch("/api/resume", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not upload the resume.");
      setMessage("Resume uploaded.");
      if (fileRef.current) fileRef.current.value = "";
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function viewResume() {
    setError("");
    try {
      const response = await fetch(`/api/resume?candidateId=${c.id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not open the resume.");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function markSuitable() {
    if (!advanceTo) return;
    setAdvancing(true);
    setError("");
    try {
      await act("moveStage", {
        clientId,
        ids: [rc.id],
        toStage: advanceTo,
        reason: "Suitable after recruiter screening.",
      });
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <dialog open className="modal">
      <div className="modal-heading">
        <h2>{c.full_name}</h2>
        <button aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="muted">
          {message}
        </p>
      )}

      <h3>Candidate details</h3>
      <p className="muted">
        Shared across every role this candidate is part of.
      </p>
      <label>
        Full name
        <input
          maxLength={200}
          disabled={savingDetails}
          value={details.fullName}
          onChange={(e) => setDetails({ ...details, fullName: e.target.value })}
        />
      </label>
      <label>
        Headline <span className="optional">optional</span>
        <input
          maxLength={300}
          disabled={savingDetails}
          value={details.headline}
          onChange={(e) => setDetails({ ...details, headline: e.target.value })}
        />
      </label>
      <label>
        Current company <span className="optional">optional</span>
        <input
          maxLength={200}
          disabled={savingDetails}
          value={details.currentCompany}
          onChange={(e) => setDetails({ ...details, currentCompany: e.target.value })}
        />
      </label>
      <label>
        Current designation <span className="optional">optional</span>
        <input
          maxLength={200}
          disabled={savingDetails}
          value={details.currentDesignation}
          onChange={(e) =>
            setDetails({ ...details, currentDesignation: e.target.value })
          }
        />
      </label>
      <label>
        Location <span className="optional">optional</span>
        <input
          maxLength={200}
          disabled={savingDetails}
          value={details.location}
          onChange={(e) => setDetails({ ...details, location: e.target.value })}
        />
      </label>
      <label>
        Experience (years) <span className="optional">optional</span>
        <input
          type="number"
          min={0}
          max={70}
          step={0.5}
          disabled={savingDetails}
          value={details.totalExperienceYears}
          onChange={(e) =>
            setDetails({ ...details, totalExperienceYears: e.target.value })
          }
        />
      </label>
      <label>
        Phone <span className="optional">optional</span>
        <input
          disabled={savingDetails}
          value={details.phone}
          onChange={(e) => setDetails({ ...details, phone: e.target.value })}
        />
      </label>
      <label>
        Email <span className="optional">optional</span>
        <input
          disabled={savingDetails}
          value={details.email}
          onChange={(e) => setDetails({ ...details, email: e.target.value })}
        />
      </label>
      <button disabled={savingDetails} onClick={() => void saveDetails()}>
        {savingDetails ? "Saving…" : "Save details"}
      </button>

      <h3>Resume</h3>
      {c.resume_path ? (
        <button type="button" onClick={() => void viewResume()}>
          View current resume
        </button>
      ) : (
        <p className="muted">No resume on file.</p>
      )}
      <label>
        {c.resume_path ? "Replace resume" : "Upload resume"}{" "}
        <span className="optional">PDF or Word, up to 10 MB</span>
        <input
          type="file"
          ref={fileRef}
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={uploading}
        />
      </label>
      <button
        type="button"
        disabled={uploading}
        onClick={() => void uploadResume()}
      >
        {uploading ? "Uploading…" : "Upload"}
      </button>

      <h3>Recruiter screening</h3>
      <p className="muted">For this role only. Never shown to the client.</p>
      <label>
        Interest
        <select
          disabled={savingScreening}
          value={screening.interest ?? ""}
          onChange={(e) =>
            setScreening({ ...screening, interest: e.target.value as Screening["interest"] })
          }
        >
          <option value="">Not yet asked</option>
          <option value="yes">Interested</option>
          <option value="maybe">Maybe</option>
          <option value="no">Not interested</option>
        </select>
      </label>
      {(
        [
          "currentCtc",
          "expectedCtc",
          "noticePeriod",
          "availability",
        ] as const
      ).map((key) => (
        <label key={key}>
          {screeningLabels[key]} <span className="optional">optional</span>
          <input
            disabled={savingScreening}
            value={screening[key] ?? ""}
            onChange={(e) => setScreening({ ...screening, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Follow-up date <span className="optional">optional</span>
        <input
          type="date"
          disabled={savingScreening}
          value={screening.followUpAt ?? ""}
          onChange={(e) => setScreening({ ...screening, followUpAt: e.target.value })}
        />
      </label>
      <label>
        Experience notes <span className="optional">optional</span>
        <textarea
          rows={2}
          maxLength={2000}
          disabled={savingScreening}
          value={screening.experienceNote ?? ""}
          onChange={(e) =>
            setScreening({ ...screening, experienceNote: e.target.value })
          }
        />
      </label>
      <label>
        Recruiter assessment <span className="optional">optional</span>
        <textarea
          rows={2}
          maxLength={2000}
          disabled={savingScreening}
          value={screening.recruiterAssessment ?? ""}
          onChange={(e) =>
            setScreening({ ...screening, recruiterAssessment: e.target.value })
          }
        />
      </label>
      <label>
        Internal notes <span className="optional">optional, never shared</span>
        <textarea
          rows={3}
          maxLength={4000}
          disabled={savingScreening}
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
        />
      </label>
      <button disabled={savingScreening} onClick={() => void saveScreening()}>
        {savingScreening ? "Saving…" : "Save screening"}
      </button>

      <div className="row">
        {advanceTo && (
          <button
            className="primary"
            disabled={advancing}
            onClick={() => void markSuitable()}
          >
            {advancing ? "Advancing…" : `Suitable → ${stageLabels[advanceTo]}`}
          </button>
        )}
        <button type="button" onClick={() => setRejecting(true)}>
          Not suitable → Reject
        </button>
      </div>

      {rejecting && (
        <RejectDialog
          clientId={clientId}
          ids={[rc.id]}
          title={`Reject ${c.full_name}`}
          onClose={() => setRejecting(false)}
          onRejected={() => {
            setRejecting(false);
            onChanged();
            onClose();
          }}
        />
      )}
    </dialog>
  );
}
