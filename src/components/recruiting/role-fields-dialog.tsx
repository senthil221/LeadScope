"use client";
import { useState } from "react";
import { X } from "lucide-react";
import type { RoleField } from "@/lib/types";

async function act(action: string, payload: unknown): Promise<{ id: string }> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not save. Try again.");
  return result;
}

const kindLabels: Record<RoleField["kind"], string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Dropdown",
  boolean: "Yes / No",
};

// "Add column" from the mockup, plus the archive capability it implies:
// there is no rename or retype action, so a wrongly-configured column is
// fixed by archiving it and adding a new one rather than editing it in
// place. Archiving never touches values already stored on role_candidates.
export function RoleFieldsDialog({
  clientId,
  roleId,
  fields,
  onClose,
  onChanged,
}: {
  clientId: string;
  roleId: string;
  fields: RoleField[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<RoleField["kind"]>("text");
  const [optionsText, setOptionsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    if (busy || !label.trim()) return;
    setBusy(true);
    setError("");
    try {
      const options = optionsText
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      if (kind === "select" && !options.length) {
        setError("Add at least one option for a dropdown column.");
        return;
      }
      await act("addRoleField", { clientId, roleId, label, kind, options });
      setLabel("");
      setOptionsText("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await act("archiveRoleField", { id, archived: true });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog open className="modal">
      <div className="modal-heading">
        <h2>Custom columns</h2>
        <button aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {fields.length > 0 && (
        <>
          <h3>Existing columns</h3>
          <p className="muted">
            Archiving keeps every value already saved; it only stops the
            column accepting new ones.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id}>
                    <td>{f.label}</td>
                    <td>{kindLabels[f.kind]}</td>
                    <td>
                      <button
                        className="small"
                        disabled={busy}
                        onClick={() => void archive(f.id)}
                      >
                        Archive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h3>Add a column</h3>
      <label>
        Column name
        <input
          maxLength={80}
          autoFocus
          disabled={busy}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Visa status"
        />
      </label>
      <label>
        Type
        <select
          disabled={busy}
          value={kind}
          onChange={(e) => setKind(e.target.value as RoleField["kind"])}
        >
          {(Object.keys(kindLabels) as RoleField["kind"][]).map((k) => (
            <option key={k} value={k}>
              {kindLabels[k]}
            </option>
          ))}
        </select>
      </label>
      {kind === "select" && (
        <label>
          Options, comma separated
          <input
            disabled={busy}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder="Option A, Option B, Option C"
          />
        </label>
      )}
      <button
        className="primary wide"
        disabled={busy || !label.trim()}
        onClick={() => void add()}
      >
        {busy ? "Adding…" : "Add column"}
      </button>
    </dialog>
  );
}
