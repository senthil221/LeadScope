"use client";
import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Role } from "@/lib/types";

async function act<T = { id: string }>(
  action: string,
  payload: unknown = {},
): Promise<T> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "The action failed. Try again.");
  return result;
}

// Shared create/edit dialog for both the Roles list and a single role's
// pipeline header, mirroring the client-form modal shape in workspace.tsx.
export function RoleFormDialog({
  clientId,
  role,
  onClose,
  onSaved,
}: {
  clientId: string;
  role: Role | "new";
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const result = await act("role", {
        id: role === "new" ? undefined : role.id,
        clientId,
        name: data.get("name"),
        description: data.get("description"),
        ratingThreshold: Number(data.get("ratingThreshold")),
        expectedRevision: role === "new" ? undefined : role.revision,
      });
      onSaved(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog open className="modal">
      <div className="modal-heading">
        <h2>{role === "new" ? "Create role" : "Edit role"}</h2>
        <button aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <form onSubmit={save}>
        <label>
          Role name
          <input
            name="name"
            required
            maxLength={120}
            autoFocus
            defaultValue={role === "new" ? "" : role.name}
            placeholder="e.g. Senior backend engineer"
          />
        </label>
        <label>
          Description <span className="optional">optional</span>
          <textarea
            name="description"
            rows={3}
            maxLength={4000}
            defaultValue={role === "new" ? "" : role.description}
          />
        </label>
        <label>
          Rating threshold
          <select
            name="ratingThreshold"
            defaultValue={role === "new" ? 3 : role.rating_threshold}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} / 5
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Candidates rated at or above this threshold move to Profile
          shortlisted. Changing this later never moves existing candidates.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy} className="primary wide">
          {busy ? "Saving…" : "Save role"}
        </button>
      </form>
    </dialog>
  );
}
