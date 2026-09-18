"use client";
import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import readXlsxFile from "read-excel-file/browser";
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
const providerOptions = [
  "LinkedIn Recruiter",
  "LinkedIn",
  "Upwork",
  "Naukri / Resdex",
  "Google Search",
  "Job post",
  "Referral",
];
const maximumImportRows = 1_000;
const importBatchSize = 200;

export function AddCandidatesDialog({
  clientId,
  roleId,
  roleFields,
  onClose,
  onImported,
}: {
  clientId: string;
  roleId: string;
  roleFields: RoleField[];
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
  const [provider, setProvider] = useState("");
  const [customProvider, setCustomProvider] = useState("");
  const [progress, setProgress] = useState("");
  const [excelSheets, setExcelSheets] = useState<{ name: string; text: string }[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [sourcingProspects, setSourcingProspects] = useState<
    { id: string; canonical_url: string; title: string }[] | null
  >(null);
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
    if (next === "sourcing" && sourcingProspects === null) void loadSourcingProspects();
  }

  const selectedProvider = provider === "custom" ? customProvider.trim() : provider;

  async function loadSourcingProspects() {
    try {
      const rows = await act<{ id: string; canonical_url: string; title: string }[]>(
        "sourcingProspects",
        { clientId, roleId },
      );
      setSourcingProspects(rows);
    } catch (e) {
      setError((e as Error).message);
      setSourcingProspects([]);
    }
  }

  async function chooseImportFile(file: File | undefined) {
    if (!file) return;
    const isExcel = /\.xlsx$/i.test(file.name);
    const maxBytes = isExcel ? 10_000_000 : 500_000;
    if (file.size > maxBytes) {
      setError(
        isExcel
          ? "Choose an Excel file smaller than 10 MB."
          : "Choose a CSV file smaller than 500 KB.",
      );
      return;
    }
    try {
      const text = isExcel ? "" : await file.text();
      if (!isExcel && text.length > 500_000) {
        setError("Choose a CSV file smaller than 500 KB.");
        return;
      }
      setCsvFileName(file.name);
      setCustomColumnOverrides({});
      if (isExcel) {
        const sheets = (await readXlsxFile(file)).map((sheet) => ({
          name: sheet.sheet,
          text: spreadsheetRowsToCsv(sheet.data),
        }));
        const first = sheets[0];
        setExcelSheets(sheets);
        setSelectedSheet(first?.name ?? "");
        setCsvText(first?.text ?? "");
      } else {
        setExcelSheets([]);
        setSelectedSheet("");
        setCsvText(text);
      }
      setError("");
    } catch {
      setError("Could not read that file. Check that it is a valid CSV or Excel workbook and try again.");
    }
  }

  async function submit(rows: ImportRow[], source: CandidateSource) {
    if (!rows.length) {
      setError("Add at least one candidate before importing.");
      return;
    }
    if (rows.length > maximumImportRows) {
      setError(`Import up to ${maximumImportRows.toLocaleString()} candidates at a time.`);
      return;
    }
    setBusy(true);
    setProgress("");
    try {
      const summary: ImportSummary = { created: 0, matchedExisting: 0, alreadyInRole: 0, invalid: 0 };
      const batches = Array.from({ length: Math.ceil(rows.length / importBatchSize) }, (_, index) =>
        rows.slice(index * importBatchSize, (index + 1) * importBatchSize),
      );
      for (const [index, batch] of batches.entries()) {
        setProgress(batches.length > 1 ? `Importing batch ${index + 1} of ${batches.length}…` : "Importing candidates…");
        const result = await act<ImportSummary>("importCandidates", {
          clientId,
          roleId,
          source,
          rows: batch.map((row) => ({
            ...row,
            // A source supplied in the file is more specific than the batch setting.
            ...(row.sourceDetail?.trim() || !selectedProvider ? {} : { sourceDetail: selectedProvider }),
          })),
        });
        summary.created += result.created;
        summary.matchedExisting += result.matchedExisting;
        summary.alreadyInRole += result.alreadyInRole;
        summary.invalid += result.invalid;
      }
      onImported(summary);
    } catch (e) {
      setError(`${(e as Error).message} Any completed batch was saved. Retry the same file safely; matching candidates will not be duplicated.`);
    } finally {
      setBusy(false);
      setProgress("");
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
    if (csvPreview.totalRows > maximumImportRows) {
      setError(`This file has more than ${maximumImportRows.toLocaleString()} candidate rows. Split it into smaller files before importing.`);
      return;
    }
    setError("");
    void submit(csvPreview.validRows, "csv");
  }
  function submitSourcing() {
    const prospects = sourcingProspects ?? [];
    const rows: ImportRow[] = selected.flatMap((id) => {
      const p = prospects.find((x) => x.id === id);
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
        Source provider <span className="optional">optional</span>
        <select disabled={busy} value={provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="">No provider selected</option>
          {providerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          <option value="custom">Other provider</option>
        </select>
      </label>
      {provider === "custom" && (
        <label>
          Other provider
          <input
            maxLength={500}
            disabled={busy}
            value={customProvider}
            onChange={(event) => setCustomProvider(event.target.value)}
            placeholder="e.g. specialist job board or partner"
          />
        </label>
      )}
      <p className="muted">A value in a CSV Source column takes priority over this batch setting.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {progress && <p className="muted" role="status">{progress}</p>}
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
              <p className="muted">CSV or Excel; up to {maximumImportRows.toLocaleString()} candidate rows, imported safely in batches.</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => csvFileInput.current?.click()}
            >
              Browse files
            </button>
          </div>
          {excelSheets.length > 1 && (
            <label>
              Workbook sheet
              <select
                disabled={busy}
                value={selectedSheet}
                onChange={(event) => {
                  const next = excelSheets.find((sheet) => sheet.name === event.target.value);
                  if (!next) return;
                  setSelectedSheet(next.name);
                  setCustomColumnOverrides({});
                  setCsvText(next.text);
                }}
              >
                {excelSheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}
              </select>
            </label>
          )}
          <label>
            Or paste CSV rows, including a header row
            <textarea
              rows={8}
              maxLength={500000}
              disabled={busy}
              value={csvText}
              onChange={(e) => {
                setCsvFileName("");
                setExcelSheets([]);
                setSelectedSheet("");
                setCustomColumnOverrides({});
                setCsvText(e.target.value);
              }}
              placeholder={csvTemplateColumns.join(",")}
            />
          </label>
          <p className="muted">
            Recognized columns: Full Name (or First Name), {csvTemplateColumns.slice(1).join(", ")}. Extra columns
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
            disabled={busy || !csvText.trim() || !csvPreview.validRows.length || csvPreview.totalRows > maximumImportRows}
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
          {sourcingProspects === null ? (
            <p className="muted">Loading accepted sourcing prospects…</p>
          ) : !sourcingProspects.length ? (
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
