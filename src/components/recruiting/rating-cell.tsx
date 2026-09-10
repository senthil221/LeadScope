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
  onRated,
}: {
  clientId: string;
  roleCandidateId: string;
  rating: number | null;
  name: string;
  onRated: () => void;
}) {
  const [value, setValue] = useState(rating);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function update(next: number | null) {
    if (saving || next === value) return;
    setSaving(true);
    setError("");
    const previous = value;
    setValue(next);
    try {
      await act("rate", { clientId, id: roleCandidateId, rating: next });
      onRated();
    } catch (e) {
      setValue(previous);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <select
        aria-label={`Rating for ${name}`}
        value={value ?? ""}
        disabled={saving}
        onChange={(e) =>
          void update(e.target.value === "" ? null : Number(e.target.value))
        }
      >
        <option value="">Not rated</option>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n} / 5
          </option>
        ))}
      </select>
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
