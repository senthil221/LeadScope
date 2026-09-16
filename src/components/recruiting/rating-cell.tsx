"use client";
import { useState } from "react";

async function act(action: string, payload: unknown): Promise<void> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? "Could not save the rating.");
  }
}

// Same optimistic-save shape as the prospect sheet's contact-status select:
// instant local update, saved on change, rolled back on failure. A rating can
// move the candidate to a different tab (auto-advance), so a save always
// triggers a real refetch rather than only updating this cell.
export function RatingCell({
  clientId,
  roleCandidateId,
  rating,
  name,
  threshold,
  autoAdvance,
  onRated,
}: {
  clientId: string;
  roleCandidateId: string;
  rating: number | null;
  name: string;
  threshold: number;
  autoAdvance: boolean;
  onRated: (autoAdvanced: boolean) => void;
}) {
  const [value, setValue] = useState(rating == null ? "" : String(rating));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function update() {
    const next = value.trim() === "" ? null : Number(value);
    if (
      saving ||
      (next !== null &&
        (!Number.isFinite(next) || next < 0 || next > 5 || Math.round(next * 10) !== next * 10))
    ) {
      if (next !== null) setError("Enter a rating from 0.0 to 5.0.");
      return;
    }
    if (next === rating) return;
    setSaving(true);
    setError("");
    const previous = rating == null ? "" : String(rating);
    try {
      await act("rate", { clientId, id: roleCandidateId, rating: next });
      onRated(autoAdvance && next !== null && next >= threshold);
    } catch (e) {
      setValue(previous);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <input
        type="number"
        min={0}
        max={5}
        step="0.1"
        aria-label={`Rating for ${name}`}
        value={value}
        disabled={saving}
        placeholder="0.0–5.0"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void update()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
