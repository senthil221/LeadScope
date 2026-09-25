"use client";
import { useMemo, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import readXlsxFile from "read-excel-file/browser";
import {
  buildImportRow,
  isRowError,
  nameFromProfileUrl,
  csvImportPreview,
  skippedRowsCsv,
  spreadsheetRowsToCsv,
  type DraftRow,
  type ImportRow,
} from "@/lib/recruiting/import";
import {
  templateColumns,
  templateCsv,
  templateFileName,
  importStages,
} from "@/lib/recruiting/template";
import { normalizeIdentity } from "@/lib/recruiting/identity";
import {
  mobileDigits,
  normalizeCandidateEmail,
  normalizeCandidatePhone,
} from "@/lib/recruiting/contact";
import { MobileField } from "./mobile-field";
import {
  candidateSourceLabels,
  candidateSources,
  defaultCandidateSource,
  stageLabels,
  type CandidateSource,
  type PipelineStage,
} from "@/lib/recruiting/stages";
import { act as sharedAct } from "@/lib/client/act";

function act<T>(action: string, payload: unknown): Promise<T> {
  return sharedAct<T>(action, payload, "The import failed. Try again.");
}

export type ImportSummary = {
  created: number;
  matchedExisting: number;
  alreadyInRole: number;
  updated: number;
  skipped: number;
  invalid: number;
  rated: number;
  // Rows that matched somebody already on file on an email or a Naukri id
  // rather than a profile URL. Nothing was written for them: only the URL is
  // taken as proof of a person, so these come back to be looked at.
  flagged: number;
  flaggedRows: { name: string; matchedOn: string }[];
};

type Mode = "paste" | "manual" | "csv" | "sourcing";
const modeLabels: Record<Mode, string> = {
  paste: "Paste URLs",
  manual: "Manual entry",
  csv: "CSV / Excel",
  sourcing: "From sourcing",
};
const emptyManual: DraftRow = { name: "" };
// Enough of the skipped rows to recognize the pattern without turning the
// dialog into a second spreadsheet. The file carries all of them.
const skippedRowsShown = 8;
// Whatever the row does have to identify it: the name it gave, or the cell
// that was supposed to be its profile. A row with neither is pointed at by
// its line number alone.
function skippedRowLabel(row: DraftRow) {
  return (
    row.name.trim() ||
    row.linkedin?.trim() ||
    row.email?.trim() ||
    row.naukri?.trim() ||
    "—"
  );
}
// A CSV or Excel file is usually an export of a search, so the tab it is
// uploaded on is the only place the source is not LinkedIn Recruiter by
// default. Either way it is one dropdown away.
const modeSource: Partial<Record<Mode, CandidateSource>> = { csv: "csv" };
const maximumImportRows = 1_000;
const importBatchSize = 200;

export function AddCandidatesDialog({
  clientId,
  roleId,
  roleName,
  stage,
  onClose,
  onImported,
}: {
  clientId: string;
  roleId: string;
  roleName: string;
  /** The tab the recruiter opened this from; where the rows land by default. */
  stage: PipelineStage;
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
  const [source, setSource] = useState<CandidateSource | null>(null);
  const [progress, setProgress] = useState("");
  const [excelSheets, setExcelSheets] = useState<{ name: string; text: string }[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [sourcingProspects, setSourcingProspects] = useState<
    { id: string; canonical_url: string; title: string }[] | null
  >(null);
  const [targetStage, setTargetStage] = useState<PipelineStage>(stage);
  const [showSkipped, setShowSkipped] = useState(false);
  const csvFileInput = useRef<HTMLInputElement>(null);
  // An import fills the fixed columns of a stage and nothing else: no custom
  // role columns, no new columns invented from the file's own headings. Extra
  // columns in the file are reported as ignored rather than rejected, so an
  // export from somewhere else still imports its recognized part.
  const csvPreview = useMemo(
    () => csvImportPreview(csvText, [], {}, { requireLinkedin: true }),
    [csvText],
  );
  const template = templateColumns();

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    if (next === "sourcing" && sourcingProspects === null) void loadSourcingProspects();
  }

  // Until somebody chooses, the tab decides.
  const batchSource = source ?? modeSource[mode] ?? defaultCandidateSource;

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

  function downloadCsv(content: string, fileName: string) {
    // A BOM so Excel opens the file as UTF-8 instead of guessing at it.
    const blob = new Blob(["﻿", content], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadTemplate() {
    downloadCsv(templateCsv(), templateFileName(roleName));
  }

  // The rows that will not import, as their own file: same columns, same
  // cells, with the reason on the end. Correct them there and upload that
  // file — the ones already imported are matched, not duplicated.
  function downloadSkipped() {
    const base = (csvFileName || templateFileName(roleName)).replace(/\.(csv|xlsx?)$/i, "");
    downloadCsv(
      skippedRowsCsv(csvText, csvPreview.invalidRows),
      `${base} - rows to fix.csv`,
    );
  }

  async function submit(rows: ImportRow[]) {
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
      const summary: ImportSummary = { created: 0, matchedExisting: 0, alreadyInRole: 0, updated: 0, skipped: 0, invalid: 0, rated: 0, flagged: 0, flaggedRows: [] };
      const batches = Array.from({ length: Math.ceil(rows.length / importBatchSize) }, (_, index) =>
        rows.slice(index * importBatchSize, (index + 1) * importBatchSize),
      );
      for (const [index, batch] of batches.entries()) {
        setProgress(batches.length > 1 ? `Importing batch ${index + 1} of ${batches.length}…` : "Importing candidates…");
        const result = await act<ImportSummary>("importCandidates", {
          clientId,
          roleId,
          source: batchSource,
          stage: targetStage,
          // A row that named its own source keeps it; the rest take the batch.
          rows: batch,
        });
        summary.created += result.created;
        summary.matchedExisting += result.matchedExisting;
        summary.alreadyInRole += result.alreadyInRole;
        summary.updated += result.updated;
        summary.skipped += result.skipped;
        summary.invalid += result.invalid;
        summary.rated += result.rated ?? 0;
        summary.flagged += result.flagged ?? 0;
        summary.flaggedRows.push(...(result.flaggedRows ?? []));
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
        normalizeIdentity("linkedin", line);
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
        ? `${invalid} line${invalid === 1 ? "" : "s"} were not a valid LinkedIn profile URL and were skipped.`
        : "",
    );
    void submit(rows);
  }
  function submitManual() {
    const emailInput = manual.email?.trim() ?? "";
    const email = normalizeCandidateEmail(emailInput);
    if (emailInput && !email) {
      setError("Enter a valid email address, such as name@company.com.");
      return;
    }
    const phone = normalizeCandidatePhone(manual.phone ?? "");
    const alternate = normalizeCandidatePhone(manual.alternatePhone ?? "");
    if (phone.error || alternate.error) {
      setError(phone.error ?? alternate.error ?? "");
      return;
    }
    if (alternate.value && alternate.value === phone.value) {
      setError("The alternate mobile is the same as the primary one.");
      return;
    }
    const built = buildImportRow(
      {
        ...manual,
        email: email ?? undefined,
        phone: phone.value ?? undefined,
        alternatePhone: alternate.value ?? undefined,
      },
      { requireLinkedin: true },
    );
    if (isRowError(built)) {
      setError(built.reason);
      return;
    }
    setError("");
    void submit([built]);
  }
  function submitCsv() {
    if (csvPreview.totalRows > maximumImportRows) {
      setError(`This file has more than ${maximumImportRows.toLocaleString()} candidate rows. Split it into smaller files before importing.`);
      return;
    }
    setError("");
    void submit(csvPreview.validRows);
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
    void submit(rows);
  }

  return (
    <dialog open className="modal import-modal">
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
        Add to stage
        <select
          disabled={busy}
          value={targetStage}
          onChange={(event) => setTargetStage(event.target.value as PipelineStage)}
        >
          {importStages.map((option) => (
            <option key={option} value={option}>{stageLabels[option]}</option>
          ))}
        </select>
      </label>
      <p className="muted">
        {targetStage === "all_profiles"
          ? "New people are created here and land in All profiles. Anyone already on this role keeps the stage they are in, and their details are updated."
          : `This updates the details of people already in ${stageLabels[targetStage]}. Nobody new is created: add new profiles through All profiles first. Updated details show everywhere that person appears.`}
      </p>
      <label>
        Source
        <select
          disabled={busy}
          value={batchSource}
          onChange={(event) => setSource(event.target.value as CandidateSource)}
        >
          {candidateSources.map((option) => (
            <option key={option} value={option}>{candidateSourceLabels[option]}</option>
          ))}
        </select>
      </label>
      <p className="muted">
        A Source column in the file wins for its own row.{" "}
        {batchSource === "naukri"
          ? "Naukri profiles are not rated here, so these land in Profile shortlisted."
          : "Naukri profiles skip the rating queue and land in Profile shortlisted."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {progress && <p className="muted" role="status">{progress}</p>}
      {mode === "paste" && (
        <>
          <label>
            LinkedIn profile URLs, one per line
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
            LinkedIn is required for every candidate. We&rsquo;ll guess a name from each profile URL. Edit it later once
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
            Full name <span className="optional">optional</span>
            <input
              maxLength={200}
              disabled={busy}
              placeholder="Taken from the profile URL if left blank"
              value={manual.name}
              onChange={(e) => setManual({ ...manual, name: e.target.value })}
            />
          </label>
          <label>
            LinkedIn URL
            <input
              required
              autoFocus
              disabled={busy}
              value={manual.linkedin ?? ""}
              onChange={(e) => setManual({ ...manual, linkedin: e.target.value })}
            />
          </label>
          <label>
            Email <span className="optional">optional</span>
            <input
              aria-invalid={Boolean(
                manual.email?.trim() && !normalizeCandidateEmail(manual.email),
              )}
              autoComplete="email"
              disabled={busy}
              inputMode="email"
              maxLength={254}
              placeholder="name@company.com"
              type="email"
              value={manual.email ?? ""}
              onChange={(e) => setManual({ ...manual, email: e.target.value })}
            />
            {manual.email?.trim() && !normalizeCandidateEmail(manual.email) && (
              <small className="candidate-field-help field-error-text">
                Enter a complete email address, such as name@company.com.
              </small>
            )}
          </label>
          {/* Ten digits each, no country to choose. The second number is where
              an alternate used to end up in a note or on top of the first. */}
          <div className="mobile-field-pair">
            <MobileField
              label="Mobile"
              value={manual.phone ?? ""}
              disabled={busy}
              onChange={(phone) => setManual({ ...manual, phone })}
            />
            <MobileField
              label="Alternate mobile"
              value={manual.alternatePhone ?? ""}
              disabled={busy}
              duplicate={Boolean(
                manual.alternatePhone &&
                  mobileDigits(manual.alternatePhone) ===
                    mobileDigits(manual.phone ?? ""),
              )}
              onChange={(alternatePhone) => setManual({ ...manual, alternatePhone })}
            />
          </div>
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
            A valid LinkedIn profile URL is required. Email and phone are optional.
          </p>
          <button
            className="primary wide"
            disabled={busy || !manual.linkedin?.trim()}
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
          <div className="import-template">
            <div>
              <strong>Import template</strong>
              <p className="muted">
                Every column an import can fill, at any stage — a stage limits
                what is shown, not what a record holds. Only LinkedIn URL is
                required; leave the rest blank and fill them in later. The file
                is headers only, so type your rows underneath.
              </p>
              <ul className="import-template-columns">
                {template.map((column) => (
                  <li key={column.header}>
                    <strong>
                      {column.header}
                      {column.required && <span> required</span>}
                    </strong>
                    <em>{column.example}</em>
                  </li>
                ))}
              </ul>
            </div>
            <button type="button" disabled={busy} onClick={downloadTemplate}>
              <Download size={15} aria-hidden="true" />
              Download template
            </button>
          </div>
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

                setCsvText(e.target.value);
              }}
              placeholder={template.map((column) => column.header).join(",")}
            />
          </label>
          <p className="muted">
            Column order does not matter, and any column outside the template
            above is ignored rather than refused.
          </p>
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
                <div className="csv-skipped">
                  <div className="csv-skipped-head">
                    <p className="csv-preview-warning">
                      {csvPreview.invalidRows.length} row
                      {csvPreview.invalidRows.length === 1 ? "" : "s"} cannot be
                      imported. Import the rest now, or fix these and upload
                      again — nothing is duplicated either way.
                    </p>
                    <button
                      type="button"
                      className="small"
                      aria-expanded={showSkipped}
                      onClick={() => setShowSkipped(!showSkipped)}
                    >
                      {showSkipped ? "Hide" : "Show"}
                    </button>
                  </div>
                  {showSkipped && (
                    <ul
                      className="csv-skipped-rows"
                      aria-label="Rows that cannot be imported"
                    >
                      {csvPreview.invalidRows.slice(0, skippedRowsShown).map((error, index) => (
                        <li key={`${error.line ?? index}`}>
                          <span className="csv-skipped-line">
                            {error.line ? `Line ${error.line}` : "Row"}
                          </span>
                          <span className="csv-skipped-name">
                            {skippedRowLabel(error.row)}
                          </span>
                          <span className="csv-skipped-reason">{error.reason}</span>
                        </li>
                      ))}
                      {csvPreview.invalidRows.length > skippedRowsShown && (
                        <li className="muted">
                          +{csvPreview.invalidRows.length - skippedRowsShown} more in the
                          downloaded file
                        </li>
                      )}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="small csv-skipped-download"
                    onClick={downloadSkipped}
                  >
                    <Download size={14} aria-hidden />
                    Download these {csvPreview.invalidRows.length} row
                    {csvPreview.invalidRows.length === 1 ? "" : "s"} to fix
                  </button>
                </div>
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
              : csvPreview.invalidRows.length
                ? `Skip ${csvPreview.invalidRows.length} and import ${csvPreview.validRows.length}`
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
