"use client";
import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { readSheet } from "read-excel-file/browser";
import {
  buildImportRow,
  isRowError,
  nameFromProfileUrl,
  csvImportPreview,
  csvHeaders,
  spreadsheetRowsToCsv,
  automaticCustomColumnMappings,
  csvTemplateColumns,
  type DraftRow,
  type ImportRow,
} from "@/lib/recruiting/import";
import { normalizeIdentity } from "@/lib/recruiting/identity";
import type { CandidateSource } from "@/lib/recruiting/stages";
import type { RoleField } from "@/lib/types";

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
  csv: "CSV / Excel",
  sourcing: "From sourcing",
};
const emptyManual: DraftRow = { name: "" };

export function AddCandidatesDialog({
  clientId,
  roleId,
  roleFields,
  sourcingProspects,
  onClose,
  onImported,
}: {
  clientId: string;
  roleId: string;
  roleFields: RoleField[];
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
  const [csvFileName, setCsvFileName] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [showColumnMapping, setShowColumnMapping] = useState(false);
  const [customColumnOverrides, setCustomColumnOverrides] = useState<
    Record<string, number | undefined>
  >({});
  const csvFileInput = useRef<HTMLInputElement>(null);
  const headers = useMemo(() => csvHeaders(csvText), [csvText]);
  const automaticMappings = useMemo(
    () => automaticCustomColumnMappings(headers, roleFields),
    [headers, roleFields],
  );
  const customMappings = useMemo(
    () =>
      Object.fromEntries(
        roleFields.map((field) => [
          field.key,
          Object.hasOwn(customColumnOverrides, field.key)
            ? customColumnOverrides[field.key]
            : automaticMappings[field.key],
        ]),
      ),
    [automaticMappings, customColumnOverrides, roleFields],
  );
  const csvPreview = useMemo(
    () => csvImportPreview(csvText, roleFields, customMappings),
    [csvText, customMappings, roleFields],
  );

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
  }

  async function chooseImportFile(file: File | undefined) {
    if (!file) return;
    const isExcel = /\.xlsx$/i.test(file.name);
    const maxBytes = isExcel ? 5_000_000 : 60_000;
    if (file.size > maxBytes) {
      setError(
        isExcel
          ? "Choose an Excel file smaller than 5 MB. Split larger files into batches of 200 candidates."
          : "Choose a CSV file smaller than 60 KB. Split larger files into batches of 200 candidates.",
      );
      return;
    }
    try {
      const text = isExcel
        ? spreadsheetRowsToCsv(await readSheet(file))
        : await file.text();
      if (!isExcel && text.length > 60_000) {
        setError("Choose a CSV file smaller than 60 KB. Split larger files into batches of 200 candidates.");
        return;
      }
      setCsvFileName(file.name);
      setCustomColumnOverrides({});
      setCsvText(text);
      setError("");
    } catch {
      setError("Could not read that Excel file. Export the first sheet as CSV and try again.");
    }
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
        rows: rows.map((row) => ({
          ...row,
          ...(sourceDetail.trim() ? { sourceDetail: sourceDetail.trim() } : {}),
        })),
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
    if (csvPreview.totalRows > 200) {
      setError("This file has more than 200 candidate rows. Split it into smaller files before importing.");
      return;
    }
    setError("");
    void submit(csvPreview.validRows, "csv");
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
      <label>
        Source or vendor <span className="optional">optional</span>
        <input
          maxLength={500}
          disabled={busy}
          value={sourceDetail}
          onChange={(event) => setSourceDetail(event.target.value)}
          placeholder="e.g. Upwork, LinkedIn Recruiter, referral"
        />
      </label>
      <p className="muted">Saved with every candidate in this import.</p>
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
          <input
            ref={csvFileInput}
            className="visually-hidden"
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(event) => {
              void chooseImportFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="csv-file-action">
            <div>
              <strong>{csvFileName || "Choose a CSV or Excel file"}</strong>
              <p className="muted">CSV or first Excel sheet; up to 200 candidate rows.</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => csvFileInput.current?.click()}
            >
              Browse files
            </button>
          </div>
          <label>
            Or paste CSV rows, including a header row
            <textarea
              rows={8}
              maxLength={60000}
              disabled={busy}
              value={csvText}
              onChange={(e) => {
                setCsvFileName("");
                setCustomColumnOverrides({});
                setCsvText(e.target.value);
              }}
              placeholder={csvTemplateColumns.join(",")}
            />
          </label>
          <p className="muted">
            Recognized columns: {csvTemplateColumns.join(", ")}. Extra columns
            are ignored unless you map them to a role column below. Column order
            does not matter.
          </p>
          {roleFields.length > 0 && headers.length > 0 && (
            <div className="csv-column-mapping">
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowColumnMapping((current) => !current)}
              >
                {showColumnMapping ? "Hide role column mapping" : "Map role columns"}
              </button>
              {!showColumnMapping &&
                Object.values(customMappings).filter((value) => value != null).length > 0 && (
                  <small>
                    {Object.values(customMappings).filter((value) => value != null).length} matched automatically
                  </small>
                )}
              {showColumnMapping && (
                <div className="csv-column-mapping-fields">
                  <p className="muted">
                    Matching headers are selected automatically. Change a mapping only when needed.
                  </p>
                  {roleFields.map((field) => (
                    <label key={field.id}>
                      {field.label}
                      <select
                        disabled={busy}
                        value={customMappings[field.key] ?? ""}
                        onChange={(event) =>
                          setCustomColumnOverrides((current) => ({
                            ...current,
                            [field.key]: event.target.value
                              ? Number(event.target.value)
                              : undefined,
                          }))
                        }
                      >
                        <option value="">Don&rsquo;t import</option>
                        {headers.map((header, index) => (
                          <option key={`${header}-${index}`} value={index}>
                            {header || `Column ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {!!csvText.trim() && (
            <div className="csv-preview" aria-live="polite">
              <div className="csv-preview-summary">
                <strong>
                  {csvPreview.validRows.length} ready to import
                </strong>
                <span>
                  {csvPreview.invalidRows.length
                    ? `${csvPreview.invalidRows.length} need attention`
                    : csvPreview.validRows.length
                      ? "All rows are valid"
                      : "No valid candidate rows found"}
                </span>
              </div>
              {csvPreview.recognizedColumns.length > 0 && (
                <p className="muted">
                  Found: {csvPreview.recognizedColumns.join(", ")}
                </p>
              )}
              {csvPreview.ignoredColumns.length > 0 && (
                <p className="muted">
                  Ignored: {csvPreview.ignoredColumns.join(", ")}
                </p>
              )}
              {csvPreview.invalidRows.length > 0 && (
                <p className="csv-preview-warning">
                  {csvPreview.invalidRows[0].reason} Check each row&rsquo;s identity and mapped role-column value; invalid rows will not be imported.
                </p>
              )}
              {csvPreview.validRows.length > 0 && (
                <ul className="csv-preview-rows" aria-label="Candidates ready to import">
                  {csvPreview.validRows.slice(0, 5).map((row, index) => (
                    <li key={`${row.name}-${index}`}>
                      {row.name}
                    </li>
                  ))}
                  {csvPreview.validRows.length > 5 && (
                    <li className="muted">
                      +{csvPreview.validRows.length - 5} more candidates
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
          <button
            className="primary wide"
            disabled={busy || !csvText.trim() || !csvPreview.validRows.length || csvPreview.totalRows > 200}
            onClick={submitCsv}
          >
            {busy
              ? "Adding…"
              : `Import ${csvPreview.validRows.length || "CSV"} candidate${csvPreview.validRows.length === 1 ? "" : "s"}`}
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
