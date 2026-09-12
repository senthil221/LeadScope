"use client";
import { useState } from "react";
import { outcomes, type Outcome } from "@/lib/recruiting/stages";

async function act(payload: unknown): Promise<void> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "recordOutcome", payload }),
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? "Could not save. Try again.");
  }
}

// Keyed by the current outcome ("none" for null): what this candidate can
// move to next. offer_declined and joined are terminal.
const nextOutcomes: Record<string, Outcome[]> = {
  none: ["offer_sent"],
  offer_sent: ["offer_accepted", "offer_declined"],
  offer_accepted: ["joined"],
  offer_declined: [],
  joined: [],
};
const actionLabels: Record<Outcome, string> = {
  offer_sent: "Mark offer sent",
  offer_accepted: "Accepted",
  offer_declined: "Declined",
  joined: "Mark joined",
};

// One step at a time, same shape as RatingCell/CustomFieldCell's own optimistic
// save, but the "value" here is a forward-only sequence rather than a free
// edit, so this renders the next valid action(s) instead of an input.
export function OutcomeCell({
  clientId,
  roleCandidateId,
  outcome,
  onChanged,
}: {
  clientId: string;
  roleCandidateId: string;
  outcome: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = nextOutcomes[outcome ?? "none"] ?? [];

  async function record(next: Outcome) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await act({ clientId, ids: [roleCandidateId], outcome: next });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {outcome && <span className="badge">{outcomes[outcome as Outcome] ?? outcome}</span>}
      {options.length > 0 && (
        <div className="row">
          {options.map((next) => (
            <button
              key={next}
              type="button"
              className="small"
              disabled={busy}
              onClick={() => void record(next)}
            >
              {actionLabels[next]}
            </button>
          ))}
        </div>
      )}
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
