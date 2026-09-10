"use client";
import { useState } from "react";
import type { RoleField } from "@/lib/types";

async function act(action: string, payload: unknown): Promise<void> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? "Could not save this column.");
  }
}

type Value = string | number | boolean | undefined;

// One cell per custom column, saved independently. Select and boolean save
// immediately on change, since picking one option is already a complete
// edit; text, number and date save on blur, and only when the value
// actually changed — the same shape as the prospect sheet's notes column.
export function CustomFieldCell({
  clientId,
  roleCandidateId,
  field,
  value,
}: {
  clientId: string;
  roleCandidateId: string;
  field: RoleField;
  value: Value;
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
      await act("customField", {
        clientId,
        id: roleCandidateId,
        key: field.key,
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

  if (field.kind === "boolean")
    return (
      <div>
        <select
          aria-label={field.label}
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
  if (field.kind === "select")
    return (
      <div>
        <select
          aria-label={field.label}
          value={(current as string) ?? ""}
          disabled={saving}
          onChange={(e) => {
            const next = e.target.value || undefined;
            setCurrent(next);
            void commit(next);
          }}
        >
          <option value="">—</option>
          {field.options.map((o) => (
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
        aria-label={field.label}
        type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}
        value={(current as string | number) ?? ""}
        disabled={saving}
        onChange={(e) =>
          setCurrent(
            field.kind === "number"
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
