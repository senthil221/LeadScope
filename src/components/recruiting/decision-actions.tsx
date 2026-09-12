"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

async function act(token: string, payload: unknown): Promise<void> {
  const response = await fetch(`/api/share/${token}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? "Could not save. Try again.");
  }
}

const decisionLabels: Record<string, string> = {
  shortlisted: "Shortlisted",
  rejected: "Rejected",
  hold: "On hold",
};

// A client's guided decision, distinct from SharedFieldCell: Reject here is
// not a column edit, it moves the candidate to the Rejects stage the same
// way the recruiter's own reject action does, so it needs its own mandatory
// reason step instead of an optimistic inline save.
export function DecisionActions({
  token,
  roleCandidateId,
  currentDecision,
}: {
  token: string;
  roleCandidateId: string;
  currentDecision?: string | null;
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision: "shortlisted" | "rejected" | "hold", withReason = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await act(token, { roleCandidateId, decision, reason: withReason });
      setRejecting(false);
      setReason("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (rejecting)
    return (
      <div>
        <textarea
          rows={2}
          maxLength={4000}
          disabled={busy}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="Why is this candidate being rejected"
        />
        {touched && !reason.trim() && (
          <small className="error" role="alert">
            Enter a reason to continue
          </small>
        )}
        <div className="row">
          <button
            type="button"
            className="small"
            disabled={busy}
            onClick={() =>
              reason.trim() ? void decide("rejected", reason.trim()) : setTouched(true)
            }
          >
            {busy ? "Rejecting…" : "Confirm reject"}
          </button>
          <button
            type="button"
            className="small"
            disabled={busy}
            onClick={() => {
              setRejecting(false);
              setReason("");
              setTouched(false);
              setError("");
            }}
          >
            Cancel
          </button>
        </div>
        {error && (
          <small className="error" role="alert">
            {error}
          </small>
        )}
      </div>
    );

  return (
    <div>
      {currentDecision && (
        <span className="badge">{decisionLabels[currentDecision] ?? currentDecision}</span>
      )}
      <div className="row">
        <button type="button" className="small" disabled={busy} onClick={() => void decide("shortlisted")}>
          Shortlist
        </button>
        <button type="button" className="small" disabled={busy} onClick={() => void decide("hold")}>
          Hold
        </button>
        <button type="button" className="small" disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </button>
      </div>
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
