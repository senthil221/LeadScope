"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { rejectionTypes, type RejectionType } from "@/lib/recruiting/stages";
import { act as sharedAct } from "@/lib/client/act";

function act(action: string, payload: unknown): Promise<void> {
  return sharedAct<void>(action, payload, "Could not reject. Try again.");
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
    <dialog open className="modal reject-modal">
      <div className="modal-heading">
        <h2>{title}</h2>
        <button aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="muted reject-note">
        Moves {ids.length === 1 ? "this candidate" : `these ${ids.length} candidates`}{" "}
        to Rejects. The record stays in the Master DB.
      </p>
      {/* Whose call it was is one of two answers, so it is a segmented choice
          rather than a stack of radios: one line, always both options in view,
          and the reason below it gets the height instead. */}
      <fieldset className="reject-type" disabled={busy}>
        <legend>Rejected by</legend>
        <div className="reject-type-options">
          {(Object.keys(rejectionTypes) as RejectionType[]).map((key) => (
            <label key={key} className={type === key ? "selected" : undefined}>
              <input
                type="radio"
                name="rejectType"
                checked={type === key}
                onChange={() => setType(key)}
              />
              {rejectionTypes[key].replace(" reject", "")}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="reject-reason">
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
      {((touched && !reason.trim()) || error) && (
        <p className="error" role="alert">
          {error || "Enter a reason to continue"}
        </p>
      )}
      <div className="row reject-actions">
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
