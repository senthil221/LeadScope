"use client";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  MessageSquareText,
  X,
} from "lucide-react";
import type { RoleCandidate } from "@/lib/types";
import {
  isStage,
  nextStage,
  stageLabels,
  candidateSourceLabel,
  type Stage,
} from "@/lib/recruiting/stages";
import { RejectDialog } from "./reject-dialog";
import { EditHistory } from "./edit-history";
import { normalizeIdentity } from "@/lib/recruiting/identity";
import {
  formatMobile,
  mobileDigits,
  normalizeCandidateEmail,
  normalizeCandidatePhone,
} from "@/lib/recruiting/contact";
import { MobileField } from "./mobile-field";
import { act as sharedAct } from "@/lib/client/act";

function act<T = { ok: true }>(action: string, payload: unknown): Promise<T> {
  return sharedAct<T>(action, payload, "Could not save. Try again.");
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
function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type CandidateActivity = {
  id: string;
  kind: string;
  from_stage: string | null;
  to_stage: string | null;
  reason: string;
  detail: Record<string, unknown>;
  created_at: string;
};

function detailValue(detail: Record<string, unknown>, key: string) {
  const value = detail[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function activityStageLabel(stage: string | null) {
  if (!stage) return "";
  return isStage(stage)
    ? stageLabels[stage]
    : stage.replaceAll("_", " ");
}

function activityCopy(event: CandidateActivity) {
  switch (event.kind) {
    case "import": {
      const source = detailValue(event.detail, "source");
      const sourceDetail = detailValue(event.detail, "sourceDetail");
      return {
        title: `Added from ${candidateSourceLabel(source, sourceDetail)}`,
        description: "",
      };
    }
    case "rating": {
      const rating = detailValue(event.detail, "rating");
      return {
        title: rating ? `Rated ${rating} out of 5` : "Rating cleared",
        description: "",
      };
    }
    case "stage":
      return {
        title: `Moved from ${activityStageLabel(event.from_stage)} to ${activityStageLabel(event.to_stage)}`,
        description: event.reason,
      };
    case "reject": {
      const type = detailValue(event.detail, "rejectionType");
      return {
        title: type === "client" ? "Client rejected candidate" : "Candidate rejected",
        description: event.reason,
      };
    }
    case "client_decision": {
      const decision = detailValue(event.detail, "decision");
      return {
        title:
          decision === "shortlisted"
            ? "Client shortlisted candidate"
            : decision === "hold"
              ? "Client put candidate on hold"
              : "Client response recorded",
        description: detailValue(event.detail, "reason"),
      };
    }
    case "screening":
      return { title: "Recruiter screening updated", description: "" };
    case "client_edit":
      return { title: "Client updated shared information", description: "" };
    case "outcome": {
      const outcome = detailValue(event.detail, "outcome");
      return {
        title: outcome ? `Outcome recorded: ${outcome.replaceAll("_", " ")}` : "Outcome recorded",
        description: "",
      };
    }
    case "offer": {
      const due = detailValue(event.detail, "responseDueAt");
      return {
        title: "Offer details updated",
        description: due ? `Response due ${due}` : "",
      };
    }
    default:
      return { title: "Candidate updated", description: event.reason };
  }
}

// Recruiter Screening is a panel on a candidate row, not a tab: this dialog
// is that panel. It edits reusable candidate details (folding in the manual
// phone/email entry originally scoped as its own enrichment phase),
// role-specific screening answers, internal notes, and a resume, then offers
// the same Suitable/Not-suitable outcome the flow diagram describes ,
// reusing the existing moveStage and reject actions rather than duplicating
// their logic here.
export function CandidatePanel({
  clientId,
  roleCandidate,
  previousCandidate,
  nextCandidate,
  position,
  totalInView,
  onNavigate,
  onClose,
  onChanged,
}: {
  clientId: string;
  roleCandidate: RoleCandidate;
  previousCandidate: { id: string; name: string } | null;
  nextCandidate: { id: string; name: string } | null;
  position: number;
  totalInView: number;
  onNavigate: (id: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const rc = roleCandidate;
  const c = rc.candidates;
  const currentStage: Stage = isStage(rc.stage) ? rc.stage : "all_profiles";
  const advanceTo = nextStage(currentStage);
  const canReject = [
    "recruiter_shortlisted",
    "client_shortlisted",
    "offer_sent",
  ].includes(currentStage);
  const fileRef = useRef<HTMLInputElement>(null);
  const existingLinkedin =
    c.candidate_identities?.find((identity) => identity.kind === "linkedin")
      ?.normalized_value ?? "";

  const [details, setDetails] = useState({
    fullName: c.full_name,
    headline: c.headline,
    currentCompany: c.current_company,
    currentDesignation: c.current_designation,
    location: c.location,
    totalExperienceYears:
      c.total_experience_years != null ? String(c.total_experience_years) : "",
    phone: c.phone ?? "",
    alternatePhone: c.alternate_phone ?? "",
    email: c.email ?? "",
    linkedin: existingLinkedin,
  });
  const [screening, setScreening] = useState<Screening>(
    (rc.screening as Screening) ?? {},
  );
  const [internalNotes, setInternalNotes] = useState(rc.internal_notes);
  const [offer, setOffer] = useState({
    amount: rc.offer_amount != null ? String(rc.offer_amount) : "",
    currency: rc.offer_currency,
    sentOn: rc.offer_sent_on ?? "",
    responseDueAt: rc.offer_response_due_at ?? "",
    expectedStartAt: rc.expected_start_at ?? "",
    notes: rc.offer_notes,
  });
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingScreening, setSavingScreening] = useState(false);
  const [clientNotes, setClientNotes] = useState(rc.client_notes);
  const [savedClientNotes, setSavedClientNotes] = useState(rc.client_notes);
  const [savingClientNotes, setSavingClientNotes] = useState(false);
  const [savingOffer, setSavingOffer] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<CandidateActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");
  const [activeSection, setActiveSection] = useState<
    "overview" | "profile" | "screening" | "notes" | "offer" | "activity"
  >("overview");

  useEffect(() => {
    if (activeSection !== "activity" || activity.length || activityError) return;
    let cancelled = false;
    async function loadActivity() {
      try {
        const events = await act<CandidateActivity[]>("candidateActivity", {
          clientId,
          roleCandidateId: rc.id,
        });
        if (!cancelled) setActivity(events);
      } catch (e) {
        if (!cancelled) setActivityError((e as Error).message);
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    }
    void loadActivity();
    return () => {
      cancelled = true;
    };
  }, [activeSection, activity.length, activityError, clientId, rc.id]);

  async function saveDetails() {
    const linkedin = normalizeIdentity("linkedin", details.linkedin);
    if (!linkedin) {
      setError("A valid LinkedIn profile URL is required.");
      return;
    }
    const phone = normalizeCandidatePhone(details.phone);
    const alternate = normalizeCandidatePhone(details.alternatePhone);
    if (phone.error || alternate.error) {
      setError(phone.error ?? alternate.error ?? "");
      return;
    }
    if (alternate.value && alternate.value === phone.value) {
      setError("The alternate mobile is the same as the primary one.");
      return;
    }
    const emailInput = details.email.trim();
    const email = normalizeCandidateEmail(emailInput);
    if (emailInput && !email) {
      setError("Enter a valid email address, such as name@company.com.");
      return;
    }
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
        phone: phone.value,
        alternatePhone: alternate.value,
        email,
        linkedin: linkedin.value,
      });
      setDetails((current) => ({
        ...current,
        phone: phone.value ?? "",
        alternatePhone: alternate.value ?? "",
        email: email ?? "",
      }));
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
  async function saveClientNotes() {
    setSavingClientNotes(true);
    setError("");
    try {
      await act("clientNote", {
        clientId,
        id: rc.id,
        note: clientNotes,
      });
      const savedNote = clientNotes.trim();
      setClientNotes(savedNote);
      setSavedClientNotes(savedNote);
      setMessage(savedNote ? "Client note saved." : "Client note cleared.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingClientNotes(false);
    }
  }
  async function saveOffer() {
    setSavingOffer(true);
    setError("");
    try {
      await act("offerDetails", {
        clientId,
        id: rc.id,
        amount: offer.amount.trim() ? Number(offer.amount) : null,
        currency: offer.currency,
        sentOn: offer.sentOn || null,
        responseDueAt: offer.responseDueAt || null,
        expectedStartAt: offer.expectedStartAt || null,
        notes: offer.notes,
      });
      setMessage("Offer details saved.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingOffer(false);
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
  async function restoreCandidate() {
    setRestoring(true);
    setError("");
    try {
      await act("moveStage", {
        clientId,
        ids: [rc.id],
        toStage: "recruiter_shortlisted",
        reason: "Restored for recruiter review.",
      });
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRestoring(false);
    }
  }
  function navigate(id: string) {
    const detailsChanged =
      details.fullName !== c.full_name ||
      details.headline !== c.headline ||
      details.currentCompany !== c.current_company ||
      details.currentDesignation !== c.current_designation ||
      details.location !== c.location ||
      details.totalExperienceYears !==
        (c.total_experience_years != null ? String(c.total_experience_years) : "") ||
      details.phone !== (c.phone ?? "") ||
      details.alternatePhone !== (c.alternate_phone ?? "") ||
      details.email !== (c.email ?? "") ||
      details.linkedin !== existingLinkedin;
    const screeningChanged =
      JSON.stringify(screening) !== JSON.stringify((rc.screening as Screening) ?? {}) ||
      internalNotes !== rc.internal_notes;
    const offerChanged =
      offer.amount !== (rc.offer_amount != null ? String(rc.offer_amount) : "") ||
      offer.currency !== rc.offer_currency ||
      offer.sentOn !== (rc.offer_sent_on ?? "") ||
      offer.responseDueAt !== (rc.offer_response_due_at ?? "") ||
      offer.expectedStartAt !== (rc.expected_start_at ?? "") ||
      offer.notes !== rc.offer_notes;
    const clientNoteChanged = clientNotes !== savedClientNotes;
    if (
      !detailsChanged &&
      !screeningChanged &&
      !offerChanged &&
      !clientNoteChanged
    ) {
      onNavigate(id);
      return;
    }
    if (window.confirm("Discard unsaved changes and open another candidate?"))
      onNavigate(id);
  }

  return (
    <dialog
      open
      className="modal candidate-drawer"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading candidate-drawer-heading">
        <div>
          <span className="badge candidate-stage-badge">
            {stageLabels[currentStage]}
          </span>
          <h2>{c.full_name}</h2>
          {(c.headline || c.current_company) && (
            <p className="candidate-drawer-subtitle">
              {[c.headline, c.current_company].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
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
      <p className="candidate-source candidate-drawer-source">
        Added from {candidateSourceLabel(rc.source, rc.source_detail)}
      </p>
      <nav
        className="candidate-drawer-section-nav"
        aria-label="Candidate sections"
        role="tablist"
      >
        {([
          ["overview", "Overview"],
          ["profile", "Profile"],
          ["screening", "Screening"],
          ["notes", "Client notes"],
          ...(currentStage === "offer_sent" ? [["offer", "Offer"]] : []),
          ["activity", "Activity"],
        ] as const).map(([section, label]) => (
          <button
            aria-selected={activeSection === section}
            className={activeSection === section ? "selected" : ""}
            key={section}
            onClick={() => setActiveSection(section as typeof activeSection)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="candidate-drawer-body">
        <section
          className="candidate-overview"
          aria-labelledby="candidate-overview-heading"
          hidden={activeSection !== "overview"}
          role="tabpanel"
        >
          <div className="candidate-overview-heading">
            <div>
              <h3 id="candidate-overview-heading">Candidate overview</h3>
              <p>Everything needed for a quick hiring decision.</p>
            </div>
            <button type="button" onClick={() => setActiveSection("profile")}>Edit profile</button>
          </div>
          <div className="candidate-overview-metrics">
            <div><span>Stage</span><strong>{stageLabels[currentStage]}</strong></div>
            <div><span>Rating</span><strong>{rc.rating != null ? `${rc.rating}/5` : "Not rated"}</strong></div>
            <div><span>Experience</span><strong>{details.totalExperienceYears ? `${details.totalExperienceYears} years` : "Not added"}</strong></div>
            <div><span>Resume</span><strong>{c.resume_path ? "On file" : "Not added"}</strong></div>
          </div>
          <div className="candidate-overview-grid">
            <section>
              <div className="candidate-overview-card-heading">
                <h4>Profile and contact</h4>
                <button className="text-button" type="button" onClick={() => setActiveSection("profile")}>Edit</button>
              </div>
              <dl>
                <div><dt>Role</dt><dd>{details.currentDesignation || details.headline || "Not added"}</dd></div>
                <div><dt>Company</dt><dd>{details.currentCompany || "Not added"}</dd></div>
                <div><dt>Location</dt><dd>{details.location || "Not added"}</dd></div>
                <div><dt>Email</dt><dd>{details.email || "Not added"}</dd></div>
                <div><dt>Mobile</dt><dd>{details.phone ? formatMobile(details.phone) : "Not added"}</dd></div>
                <div><dt>Alternate</dt><dd>{details.alternatePhone ? formatMobile(details.alternatePhone) : "Not added"}</dd></div>
              </dl>
              {details.linkedin && normalizeIdentity("linkedin", details.linkedin) && (
                <a className="candidate-overview-link" href={normalizeIdentity("linkedin", details.linkedin)?.value} target="_blank" rel="noreferrer">
                  Open LinkedIn profile <ExternalLink size={13} />
                </a>
              )}
            </section>
            <section>
              <div className="candidate-overview-card-heading">
                <h4>Recruiter screening</h4>
                <button className="text-button" type="button" onClick={() => setActiveSection("screening")}>Edit</button>
              </div>
              <dl>
                <div><dt>Interest</dt><dd>{screening.interest === "yes" ? "Interested" : screening.interest === "maybe" ? "Maybe" : screening.interest === "no" ? "Not interested" : "Not asked"}</dd></div>
                <div><dt>Current CTC</dt><dd>{screening.currentCtc || "Not added"}</dd></div>
                <div><dt>Expected CTC</dt><dd>{screening.expectedCtc || "Not added"}</dd></div>
                <div><dt>Notice period</dt><dd>{screening.noticePeriod || "Not added"}</dd></div>
                <div><dt>Follow-up</dt><dd>{screening.followUpAt || "Not scheduled"}</dd></div>
              </dl>
            </section>
          </div>
          <section className="candidate-overview-note">
            <div className="candidate-overview-card-heading">
              <div>
                <h4>Client note</h4>
                <p>Visible through the client link.</p>
              </div>
              <button type="button" onClick={() => setActiveSection("notes")}>{clientNotes ? "Edit note" : "Add note"}</button>
            </div>
            <p>{clientNotes || "No client note has been added."}</p>
          </section>
          {(screening.recruiterAssessment || screening.experienceNote) && (
            <section className="candidate-overview-assessment">
              <h4>Recruiter summary</h4>
              {screening.recruiterAssessment && <p>{screening.recruiterAssessment}</p>}
              {screening.experienceNote && <p>{screening.experienceNote}</p>}
            </section>
          )}
          {currentStage === "offer_sent" && (
            <section className="candidate-overview-offer">
              <div className="candidate-overview-card-heading">
                <h4>Offer</h4>
                <button className="text-button" type="button" onClick={() => setActiveSection("offer")}>Edit</button>
              </div>
              <p>{offer.amount ? `${offer.currency || ""} ${offer.amount}`.trim() : "Amount not added"}{offer.responseDueAt ? ` · Response due ${offer.responseDueAt}` : ""}</p>
            </section>
          )}
        </section>

        {currentStage === "offer_sent" && (
        <section
          className="candidate-offer"
          aria-labelledby="offer-heading"
          hidden={activeSection !== "offer"}
          role="tabpanel"
        >
          <div className="candidate-panel-section-heading">
            <CalendarDays size={16} aria-hidden="true" />
            <h3 id="offer-heading">Offer details</h3>
          </div>
          <div className="candidate-offer-grid">
            <label>
              Offer amount <span className="optional">optional</span>
              <input
                type="number"
                min={0}
                step="0.01"
                disabled={savingOffer}
                value={offer.amount}
                onChange={(e) => setOffer({ ...offer, amount: e.target.value })}
              />
            </label>
            <label>
              Currency <span className="optional">optional</span>
              <input
                maxLength={10}
                placeholder="USD"
                disabled={savingOffer}
                value={offer.currency}
                onChange={(e) => setOffer({ ...offer, currency: e.target.value.toUpperCase() })}
              />
            </label>
            <label>
              Sent on <span className="optional">optional</span>
              <input
                type="date"
                disabled={savingOffer}
                value={offer.sentOn}
                onChange={(e) => setOffer({ ...offer, sentOn: e.target.value })}
              />
            </label>
            <label>
              Response due <span className="optional">optional</span>
              <input
                type="date"
                disabled={savingOffer}
                value={offer.responseDueAt}
                onChange={(e) => setOffer({ ...offer, responseDueAt: e.target.value })}
              />
            </label>
            <label>
              Expected start <span className="optional">optional</span>
              <input
                type="date"
                disabled={savingOffer}
                value={offer.expectedStartAt}
                onChange={(e) => setOffer({ ...offer, expectedStartAt: e.target.value })}
              />
            </label>
          </div>
          <label>
            Offer notes <span className="optional">optional, never shared</span>
            <textarea
              rows={2}
              maxLength={4000}
              disabled={savingOffer}
              value={offer.notes}
              onChange={(e) => setOffer({ ...offer, notes: e.target.value })}
            />
          </label>
          <button disabled={savingOffer} onClick={() => void saveOffer()}>
            {savingOffer ? "Saving…" : "Save offer details"}
          </button>
        </section>
      )}

      <section
        className="candidate-activity"
        aria-labelledby="candidate-activity-heading"
        hidden={activeSection !== "activity"}
        role="tabpanel"
      >
        <div className="candidate-panel-section-heading">
          <History size={16} aria-hidden="true" />
          <h3 id="candidate-activity-heading">Activity</h3>
        </div>
        {activityLoading ? (
          <p className="muted">Loading activity…</p>
        ) : activityError ? (
          <p className="muted">Could not load activity.</p>
        ) : activity.length ? (
          <ol className="candidate-activity-list">
            {activity.map((event) => {
              const copy = activityCopy(event);
              return (
                <li className="candidate-activity-row" key={event.id}>
                  <div>
                    <strong>{copy.title}</strong>
                    {copy.description && <p>{copy.description}</p>}
                  </div>
                  <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="muted">No pipeline events have been recorded yet.</p>
        )}
        <details className="candidate-field-history"><summary>Field edit history</summary>{activeSection === "activity" && <EditHistory clientId={clientId} roleId={rc.role_id} candidateId={c.id} />}</details>
      </section>

      <section
        className="candidate-client-notes candidate-client-notes-section"
        aria-labelledby="client-notes-heading"
        hidden={activeSection !== "notes"}
        role="tabpanel"
      >
        <div className="candidate-panel-section-heading">
          <MessageSquareText size={16} aria-hidden="true" />
          <h3 id="client-notes-heading">Client notes</h3>
        </div>
        <p className="muted">This note is visible to the client through their shared link.</p>
        <label>
          Note <span className="optional">optional</span>
          <textarea
            disabled={savingClientNotes}
            maxLength={4000}
            onChange={(event) => setClientNotes(event.target.value)}
            placeholder="Add the client-facing context they need for this candidate"
            rows={6}
            value={clientNotes}
          />
        </label>
        <div className="candidate-note-actions">
          <span>{clientNotes.length}/4000</span>
          <button disabled={savingClientNotes} onClick={() => void saveClientNotes()}>
            {savingClientNotes ? "Saving…" : "Save client note"}
          </button>
        </div>
      </section>

      <section
        className="candidate-drawer-section candidate-profile-section"
        aria-labelledby="candidate-details-heading"
        hidden={activeSection !== "profile"}
        role="tabpanel"
      >
        <h3 id="candidate-details-heading">Candidate details</h3>
        <p className="muted">Shared across every role this candidate is part of. LinkedIn is required.</p>
        <div className="candidate-drawer-grid">
          <label>
            Full name
            <input
              maxLength={200}
              disabled={savingDetails}
              value={details.fullName}
              onChange={(e) => setDetails({ ...details, fullName: e.target.value })}
            />
          </label>
          <div className="candidate-drawer-link-field">
            <label>
              LinkedIn profile
              <input
                type="url"
                required
                maxLength={500}
                placeholder="https://www.linkedin.com/in/name"
                disabled={savingDetails}
                value={details.linkedin}
                onChange={(e) => setDetails({ ...details, linkedin: e.target.value })}
              />
            </label>
            {details.linkedin && normalizeIdentity("linkedin", details.linkedin) && (
              <a
                className="candidate-link"
                href={normalizeIdentity("linkedin", details.linkedin)?.value}
                target="_blank"
                rel="noreferrer"
              >
                Open LinkedIn profile <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
        <details className="candidate-profile-more">
          <summary>Professional and contact details</summary>
          <div className="candidate-drawer-grid">
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
          {/* Ten digits each. The alternate is the number a candidate gives
              when the first one does not answer, which used to end up in a
              note or on top of the primary. */}
          <div className="mobile-field-pair">
            <MobileField
              label="Mobile"
              value={details.phone}
              disabled={savingDetails}
              onChange={(phone) => setDetails({ ...details, phone })}
            />
            <MobileField
              label="Alternate mobile"
              value={details.alternatePhone}
              disabled={savingDetails}
              duplicate={Boolean(
                details.alternatePhone &&
                  mobileDigits(details.alternatePhone) === mobileDigits(details.phone),
              )}
              onChange={(alternatePhone) =>
                setDetails({ ...details, alternatePhone })
              }
            />
          </div>
          <label>
            Email <span className="optional">optional</span>
            <input
              aria-invalid={Boolean(
                details.email.trim() && !normalizeCandidateEmail(details.email),
              )}
              autoComplete="email"
              disabled={savingDetails}
              inputMode="email"
              maxLength={254}
              placeholder="name@company.com"
              type="email"
              value={details.email}
              onChange={(e) => setDetails({ ...details, email: e.target.value })}
            />
            {details.email.trim() && !normalizeCandidateEmail(details.email) && (
              <small className="candidate-field-help field-error-text">
                Enter a complete email address, such as name@company.com.
              </small>
            )}
          </label>
          </div>
        </details>
        <button
          className="candidate-section-save"
          disabled={savingDetails}
          onClick={() => void saveDetails()}
        >
          {savingDetails ? "Saving…" : "Save details"}
        </button>
      </section>

      <section
        className="candidate-drawer-section candidate-resume-section"
        aria-labelledby="resume-heading"
        hidden={activeSection !== "profile"}
      >
        <div className="candidate-resume-heading">
          <div>
            <h3 id="resume-heading">Resume</h3>
            <p className="muted">
              {c.resume_path ? "A resume is on file." : "No resume on file."}
            </p>
          </div>
          {c.resume_path && (
            <button type="button" onClick={() => void viewResume()}>
              View resume
            </button>
          )}
        </div>
        <div className="candidate-resume-upload">
          <label>
            <span className="sr-only">
              {c.resume_path ? "Replace resume" : "Upload resume"}
            </span>
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
            {uploading ? "Uploading…" : c.resume_path ? "Replace" : "Upload"}
          </button>
        </div>
        <p className="candidate-file-help">PDF or Word, up to 10 MB</p>
      </section>

      <section
        className="candidate-drawer-section candidate-screening-section"
        aria-labelledby="screening-heading"
        hidden={activeSection !== "screening"}
        role="tabpanel"
      >
        <h3 id="screening-heading">Recruiter screening</h3>
      <p className="muted">For this role only. Never shown to the client.</p>
      <div className="candidate-screening-grid">
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
      </div>
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
      <button
        className="candidate-section-save"
        disabled={savingScreening}
        onClick={() => void saveScreening()}
      >
        {savingScreening ? "Saving…" : "Save screening"}
      </button>
      </section>

      </div>
      {totalInView > 1 && (
        <nav className="candidate-drawer-navigation" aria-label="Candidate navigation">
          <button
            type="button"
            disabled={!previousCandidate}
            aria-label={
              previousCandidate
                ? `Previous candidate: ${previousCandidate.name}`
                : "No previous candidate"
            }
            onClick={() => previousCandidate && navigate(previousCandidate.id)}
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <span>{position} of {totalInView} in this view</span>
          <button
            type="button"
            disabled={!nextCandidate}
            aria-label={
              nextCandidate
                ? `Next candidate: ${nextCandidate.name}`
                : "No next candidate"
            }
            onClick={() => nextCandidate && navigate(nextCandidate.id)}
          >
            Next
            <ChevronRight size={16} />
          </button>
        </nav>
      )}
      <footer className="candidate-drawer-actions">
        {currentStage === "rejected" ? (
          <button
            className="primary"
            disabled={restoring}
            onClick={() => void restoreCandidate()}
          >
            {restoring ? "Restoring…" : "Restore to recruiter review"}
          </button>
        ) : (
          <>
            {advanceTo && (
              <button
                className="primary"
                disabled={advancing}
                onClick={() => void markSuitable()}
              >
                {advancing ? "Advancing…" : `Suitable → ${stageLabels[advanceTo]}`}
              </button>
            )}
            {canReject && (
              <button type="button" onClick={() => setRejecting(true)}>
                Not suitable → Reject
              </button>
            )}
          </>
        )}
      </footer>

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
