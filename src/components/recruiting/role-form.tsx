"use client";
import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Role } from "@/lib/types";
import { act as sharedAct } from "@/lib/client/act";
import { TableDialog } from "./table-dialog";

function act<T = { id: string }>(action: string, payload: unknown = {}): Promise<T> {
  return sharedAct<T>(action, payload);
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
        recruiterNames: String(data.get("recruiters") ?? "").split(",").map((name) => name.trim()).filter(Boolean),
        ctc: data.get("ctc"),
        roleBrief: role === "new" ? "" : role.role_brief,
        ratingThreshold: Number(data.get("ratingThreshold")),
        status: String(data.get("status")),
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
    <TableDialog titleId="role-form-title" className="role-form-modal" busy={busy} onClose={onClose}>
      <div className="modal-heading">
        <h2 id="role-form-title">{role === "new" ? "Create role" : "Edit role"}</h2>
        <button aria-label="Close" disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <form onSubmit={save} aria-busy={busy}>
        <label>
          Role name
          <input
            name="name"
            required
            maxLength={120}
            data-dialog-autofocus
            defaultValue={role === "new" ? "" : role.name}
            placeholder="e.g. Senior backend engineer"
          />
        </label>
        <label>
          <span>Description <span className="optional">optional</span></span>
          <textarea
            name="description"
            rows={3}
            maxLength={4000}
            defaultValue={role === "new" ? "" : role.description}
          />
        </label>
        <label>
          <span>Recruiter tags <span className="optional">comma separated names</span></span>
          <input name="recruiters" maxLength={2400} defaultValue={role === "new" ? "" : (role.recruiter_names ?? []).join(", ")} placeholder="e.g. Priya, Rahul" />
        </label>
        <label>
          <span>Role CTC <span className="optional">budget or range</span></span>
          <input name="ctc" maxLength={200} defaultValue={role === "new" ? "" : role.ctc ?? ""} placeholder="e.g. ₹18–24 LPA, fixed + variable" />
        </label>
        <div className="form-grid role-form-pair"><label>
          Rating floor
          <input
            type="number"
            min={0}
            max={5}
            step="0.1"
            name="ratingThreshold"
            defaultValue={role === "new" ? 3 : role.rating_threshold}
          />
        </label>
        <label>
          Role status
          <select name="status" defaultValue={role === "new" ? "open" : role.status}>
            <option value="open">Open</option>
            <option value="on_hold">On hold</option>
            <option value="closed">Closed</option>
          </select>
        </label></div>
        <p className="muted">
          Candidates with a manually entered rating at or above this threshold
          move to Profile shortlisted. Changing this later never moves existing
          candidates automatically.
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
    </TableDialog>
  );
}
