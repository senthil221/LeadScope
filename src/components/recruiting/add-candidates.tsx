"use client";
import { useState } from "react";
import { X } from "lucide-react";
import {
  buildImportRow,
  isRowError,
  nameFromProfileUrl,
  csvToDraftRows,
  csvTemplateColumns,
  type DraftRow,
  type ImportRow,
} from "@/lib/recruiting/import";
import { normalizeIdentity } from "@/lib/recruiting/identity";
import type { CandidateSource } from "@/lib/recruiting/stages";

async function act<T>(action: string, payload: unknown): Promise<T> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "The import failed. Try again.");
  return result;
}

export type ImportSummary = {
  created: number;
  matchedExisting: number;
  alreadyInRole: number;
  invalid: number;
};

type Mode = "paste" | "manual" | "csv" | "sourcing";
const modeLabels: Record<Mode, string> = {
  paste: "Paste URLs",
  manual: "Manual entry",
  csv: "CSV",
  sourcing: "From sourcing",
};
const emptyManual: DraftRow = { name: "" };

export function AddCandidatesDialog({
  clientId,
  roleId,
  sourcingProspects,
  onClose,
  onImported,
}: {
  clientId: string;
  roleId: string;
  sourcingProspects: { id: string; canonical_url: string; title: string }[];
  onClose: () => void;
  onImported: (summary: ImportSummary) => void;
}) {
  const [mode, setMode] = useState<Mode>("paste");
  const [pasteText, setPasteText] = useState("");
  const [manual, setManual] = useState<DraftRow>(emptyManual);
  const [csvText, setCsvText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
  }

  async function submit(rows: ImportRow[], source: CandidateSource) {
    if (!rows.length) {
      setError("Add at least one candidate before importing.");
      return;
    }
    if (rows.length > 200) {
      setError("Import at most 200 candidates at a time.");
      return;
    }
    setBusy(true);
    try {
      const summary = await act<ImportSummary>("importCandidates", {
        clientId,
        roleId,
        source,
        rows,
      });
      onImported(summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submitPaste() {
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const rows: ImportRow[] = [];
    let invalid = 0;
    for (const line of lines) {
      const identity =
        normalizeIdentity("linkedin", line) ?? normalizeIdentity("naukri", line);
      if (!identity) {
        invalid++;
        continue;
      }
      rows.push({
        name: nameFromProfileUrl(identity.value),
        identities: [identity],
        fields: {},
      });
    }
    setError(
      invalid
        ? `${invalid} line${invalid === 1 ? "" : "s"} were not a valid LinkedIn or Naukri profile URL and were skipped.`
        : "",
    );
    void submit(rows, "url_paste");
  }
  function submitManual() {
    const built = buildImportRow(manual);
    if (isRowError(built)) {
      setError(built.reason);
      return;
    }
    setError("");
    void submit([built], "manual");
  }
  function submitCsv() {
    const drafts = csvToDraftRows(csvText);
    const rows: ImportRow[] = [];
    let invalid = 0;
    for (const draft of drafts) {
      const built = buildImportRow(draft);
      if (isRowError(built)) invalid++;
      else rows.push(built);
    }
    setError(
      invalid
        ? `${invalid} row${invalid === 1 ? "" : "s"} were missing a name or a valid identity and were skipped.`
        : "",
    );
    void submit(rows, "csv");
  }
  function submitSourcing() {
    const rows: ImportRow[] = selected.flatMap((id) => {
      const p = sourcingProspects.find((x) => x.id === id);
      const identity = p ? normalizeIdentity("linkedin", p.canonical_url) : null;
      if (!p || !identity) return [];
      return [
        {
          name: p.title.trim() || nameFromProfileUrl(identity.value),
          identities: [identity],
          fields: {},
        },
      ];
    });
    void submit(rows, "sourcing_import");
  }

  return (
    <dialog open className="modal">
      <div className="modal-heading">
        <h2>Add candidates</h2>
        <button aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="tabs" role="tablist">
        {(Object.keys(modeLabels) as Mode[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            className={mode === key ? "selected" : ""}
            onClick={() => switchMode(key)}
          >
            {modeLabels[key]}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {mode === "paste" && (
        <>
          <label>
            LinkedIn or Naukri profile URLs, one per line
            <textarea
              rows={8}
              maxLength={20000}
              disabled={busy}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="https://www.linkedin.com/in/priya-nair"
            />
          </label>
          <p className="muted">
            We&rsquo;ll guess a name from each profile URL. Edit it later once
            you have real details.
          </p>
          <button
            className="primary wide"
            disabled={busy || !pasteText.trim()}
            onClick={submitPaste}
          >
            {busy ? "Adding…" : "Add candidates"}
          </button>
        </>
      )}
      {mode === "manual" && (
        <>
          <label>
            Full name
            <input
              maxLength={200}
              autoFocus
              disabled={busy}
              value={manual.name}
              onChange={(e) => setManual({ ...manual, name: e.target.value })}
            />
          </label>
          <label>
            LinkedIn URL <span className="optional">optional</span>
            <input
              disabled={busy}
              value={manual.linkedin ?? ""}
              onChange={(e) => setManual({ ...manual, linkedin: e.target.value })}
            />
          </label>
          <label>
            Naukri URL <span className="optional">optional</span>
            <input
              disabled={busy}
              value={manual.naukri ?? ""}
              onChange={(e) => setManual({ ...manual, naukri: e.target.value })}
            />
          </label>
          <label>
            Email <span className="optional">optional</span>
            <input
              disabled={busy}
              value={manual.email ?? ""}
              onChange={(e) => setManual({ ...manual, email: e.target.value })}
            />
          </label>
          <label>
            Phone <span className="optional">optional</span>
            <input
              disabled={busy}
              value={manual.phone ?? ""}
              onChange={(e) => setManual({ ...manual, phone: e.target.value })}
            />
          </label>
          <label>
            Current company <span className="optional">optional</span>
            <input
              disabled={busy}
              value={manual.currentCompany ?? ""}
              onChange={(e) =>
                setManual({ ...manual, currentCompany: e.target.value })
              }
            />
          </label>
          <label>
            Current designation <span className="optional">optional</span>
            <input
              disabled={busy}
              value={manual.currentDesignation ?? ""}
              onChange={(e) =>
                setManual({ ...manual, currentDesignation: e.target.value })
              }
            />
          </label>
          <label>
            Location <span className="optional">optional</span>
            <input
              disabled={busy}
              value={manual.location ?? ""}
              onChange={(e) => setManual({ ...manual, location: e.target.value })}
            />
          </label>
          <label>
            Experience (years) <span className="optional">optional</span>
            <input
              type="number"
              min={0}
              max={70}
              step={0.5}
              disabled={busy}
              value={manual.totalExperienceYears ?? ""}
              onChange={(e) =>
                setManual({ ...manual, totalExperienceYears: e.target.value })
              }
            />
          </label>
          <p className="muted">
            Add at least one of LinkedIn, Naukri, or email.
          </p>
          <button
            className="primary wide"
            disabled={busy || !manual.name.trim()}
            onClick={submitManual}
          >
            {busy ? "Adding…" : "Add candidate"}
          </button>
        </>
      )}
      {mode === "csv" && (
        <>
          <label>
            Paste CSV rows, including a header row
            <textarea
              rows={8}
              maxLength={60000}
              disabled={busy}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={csvTemplateColumns.join(",")}
            />
          </label>
          <p className="muted">
            Recognized columns: {csvTemplateColumns.join(", ")}. Extra columns
            are ignored; column order does not matter.
          </p>
          <button
            className="primary wide"
            disabled={busy || !csvText.trim()}
            onClick={submitCsv}
          >
            {busy ? "Adding…" : "Import CSV"}
          </button>
        </>
      )}
      {mode === "sourcing" && (
        <>
          {!sourcingProspects.length ? (
            <p className="muted">
              No accepted sourcing prospects for this client yet.
            </p>
          ) : (
            <div className="table-wrap sheet-wrap">
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Title</th>
                    <th>LinkedIn URL</th>
                  </tr>
                </thead>
                <tbody>
                  {sourcingProspects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${p.title || p.canonical_url}`}
                          disabled={busy}
                          checked={selected.includes(p.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, p.id]
                                : selected.filter((x) => x !== p.id),
                            )
                          }
                        />
                      </td>
                      <td>{p.title || "Untitled profile"}</td>
                      <td className="sheet-url">{p.canonical_url}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            className="primary wide"
            disabled={busy || !selected.length}
            onClick={submitSourcing}
          >
            {busy ? "Adding…" : `Add ${selected.length} selected`}
          </button>
        </>
      )}
    </dialog>
  );
}
