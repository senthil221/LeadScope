"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { rejectionTypes, type RejectionType } from "@/lib/recruiting/stages";

async function act(action: string, payload: unknown): Promise<void> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? "Could not reject. Try again.");
  }
}

// Mirrors reject_candidate_form.html: a mandatory reason, a choice between a
// recruiter and a client rejection, and cancel/confirm. Shared by every
// pipeline tab that offers a Reject action.
export function RejectDialog({
  clientId,
  ids,
  title,
  onClose,
  onRejected,
}: {
  clientId: string;
  ids: string[];
  title: string;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [reason, setReason] = useState("");
  const [type, setType] = useState<RejectionType>("recruiter");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!reason.trim()) {
      setTouched(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await act("rejectCandidates", {
        clientId,
        ids,
        type,
        reason: reason.trim(),
      });
      onRejected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog open className="modal">
      <div className="modal-heading">
        <h2>{title}</h2>
        <button aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        Moves {ids.length === 1 ? "this candidate" : `these ${ids.length} candidates`}{" "}
        to the Rejects tab. Their record stays in the Master DB.
      </p>
      <label>
        Reason *
        <textarea
          rows={3}
          maxLength={4000}
          disabled={busy}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="Why is this candidate being rejected"
        />
      </label>
      {touched && !reason.trim() && (
        <p className="error" role="alert">
          Enter a reason to continue
        </p>
      )}
      <label>Reject type</label>
      <div className="row">
        {(Object.keys(rejectionTypes) as RejectionType[]).map((key) => (
          <label key={key} className="check-label">
            <input
              type="radio"
              name="rejectType"
              checked={type === key}
              disabled={busy}
              onChange={() => setType(key)}
            />
            {rejectionTypes[key]}
          </label>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="primary" disabled={busy} onClick={submit}>
          {busy ? "Rejecting…" : `Reject candidate${ids.length > 1 ? "s" : ""}`}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
