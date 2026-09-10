"use client";
import { useState } from "react";

async function save(token: string, payload: unknown): Promise<void> {
  const response = await fetch(`/api/share/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? "Could not save. Try again.");
  }
}

type Value = string | number | boolean | undefined;
type Kind = "text" | "number" | "date" | "select" | "boolean";

// The client's own edit cell, structurally the same optimistic-save shape as
// the internal app's CustomFieldCell, but posting to /api/share/[token]
// (authorized by the token alone) instead of the authenticated action route.
// Kept as a separate component rather than shared with CustomFieldCell: the
// two operate in different trust domains, and the duplication is small.
export function SharedFieldCell({
  token,
  roleCandidateId,
  column,
  value,
  kind,
  options,
}: {
  token: string;
  roleCandidateId: string;
  column: string;
  value: Value;
  kind: Kind;
  options?: string[];
}) {
  const [current, setCurrent] = useState<Value>(value);
  const [saved, setSaved] = useState<Value>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function commit(next: Value) {
    if (saving) return;
    setSaving(true);
    setError("");
    const previous = saved;
    try {
      await save(token, {
        roleCandidateId,
        column,
        value: next === undefined ? null : next,
      });
      setSaved(next);
    } catch (e) {
      setCurrent(previous);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (kind === "boolean")
    return (
      <div>
        <select
          value={current === true ? "yes" : current === false ? "no" : ""}
          disabled={saving}
          onChange={(e) => {
            const next = e.target.value === "" ? undefined : e.target.value === "yes";
            setCurrent(next);
            void commit(next);
          }}
        >
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
        {error && (
          <small className="error" role="alert">
            {error}
          </small>
        )}
      </div>
    );
  if (kind === "select")
    return (
      <div>
        <select
          value={(current as string) ?? ""}
          disabled={saving}
          onChange={(e) => {
            const next = e.target.value || undefined;
            setCurrent(next);
            void commit(next);
          }}
        >
          <option value="">—</option>
          {(options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
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
  return (
    <div>
      <input
        type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
        value={(current as string | number) ?? ""}
        disabled={saving}
        onChange={(e) =>
          setCurrent(
            kind === "number"
              ? e.target.value === ""
                ? undefined
                : Number(e.target.value)
              : e.target.value || undefined,
          )
        }
        onBlur={() => {
          if (current !== saved) void commit(current);
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
