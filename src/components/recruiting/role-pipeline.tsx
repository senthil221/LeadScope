"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Archive, CircleHelp, Plus, SlidersHorizontal } from "lucide-react";
import type {
  Client,
  MasterCandidate,
  Role,
  RoleCandidate,
  RoleField,
} from "@/lib/types";
import {
  stages,
  stageLabels,
  isStage,
  nextStage,
  rejectionTypes,
  type PipelineStage,
  type Stage,
} from "@/lib/recruiting/stages";
import { RoleFormDialog } from "./role-form";
import { AddCandidatesDialog, type ImportSummary } from "./add-candidates";
import { RejectDialog } from "./reject-dialog";
import { RatingCell } from "./rating-cell";
import { CandidatePanel } from "./candidate-panel";
import { CustomFieldCell } from "./custom-field-cell";
import { RoleFieldsDialog } from "./role-fields-dialog";

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

type Tab = Stage | "master_db";
const tabs: { key: Tab; label: string }[] = [
  ...stages
    .filter((s) => s !== "rejected")
    .map((s) => ({ key: s as Tab, label: stageLabels[s] })),
  { key: "rejected", label: "Rejects" },
  { key: "master_db", label: "Master DB" },
];

const date = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

function candidateEmptyMessage(tab: Tab) {
  if (tab === "master_db") return "No candidates in the master database yet.";
  if (tab === "rejected") return "No candidates rejected yet.";
  if (tab === "all_profiles")
    return "No candidates yet. Add candidates from LinkedIn, Naukri, manual entry, or a CSV import.";
  return `No candidates in ${stageLabels[tab as Stage].toLowerCase()} yet.`;
}

export function RolePipeline({
  client,
  role,
  roleCandidates,
  counts,
  masterCandidates,
  total,
  page,
  sourcingProspects,
  roleFields,
}: {
  client: Client;
  role: Role;
  roleCandidates: RoleCandidate[];
  counts: Record<string, number>;
  masterCandidates: MasterCandidate[];
  total: number;
  page: number;
  sourcingProspects: { id: string; canonical_url: string; title: string }[];
  roleFields: RoleField[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = isStage(params.get("stage") ?? "")
    ? (params.get("stage") as Tab)
    : params.get("stage") === "master_db"
      ? "master_db"
      : "all_profiles";
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [managingFields, setManagingFields] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const path = `/roles/${role.id}`;
  // The bulk bar and rating cells only apply to the five pipeline stages;
  // Rejects and Master DB stay read-only and unaffected by selection.
  const isPipelineTab = tab !== "rejected" && tab !== "master_db";
  const advanceTo = isPipelineTab ? nextStage(tab as PipelineStage) : null;
  const pipelineTotal = Object.entries(counts)
    .filter(([stage]) => stage !== "rejected")
    .reduce((sum, [, n]) => sum + n, 0);

  const tabUrl = (key: Tab) => {
    const p = new URLSearchParams();
    p.set("stage", key);
    return `${path}?${p}`;
  };
  const masterDbUrl = (changes: Record<string, string>) => {
    const p = new URLSearchParams(params);
    p.set("stage", "master_db");
    Object.entries(changes).forEach(([k, v]) =>
      v ? p.set(k, v) : p.delete(k),
    );
    return `${path}?${p}`;
  };

  function summarize(summary: ImportSummary) {
    setImporting(false);
    const parts = [
      summary.created && `${summary.created} added`,
      summary.matchedExisting &&
        `${summary.matchedExisting} matched an existing candidate`,
      summary.alreadyInRole && `${summary.alreadyInRole} already in this role`,
      summary.invalid && `${summary.invalid} skipped as invalid`,
    ].filter(Boolean);
    setMessage(parts.length ? parts.join(", ") + "." : "Nothing to import.");
    router.refresh();
  }
  async function toggleArchive() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await act("archiveRole", { id: role.id, archived: !role.archived });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function moveSelectedToNextStage() {
    if (busy || !advanceTo || !selected.length) return;
    setBusy(true);
    setError("");
    try {
      await act("moveStage", {
        clientId: client.id,
        ids: selected,
        toStage: advanceTo,
        reason: note,
      });
      setSelected([]);
      setNote("");
      setMessage(
        `Moved ${selected.length} candidate${selected.length > 1 ? "s" : ""} to ${stageLabels[advanceTo]}.`,
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function applyThreshold() {
    if (applyBusy) return;
    setApplyBusy(true);
    setError("");
    try {
      const result = await act<{ moved: number }>("applyThreshold", {
        clientId: client.id,
        roleId: role.id,
      });
      setApplying(false);
      setMessage(
        result.moved
          ? `${result.moved} candidate${result.moved > 1 ? "s" : ""} moved to Profile shortlisted.`
          : "No candidates in All profiles currently meet the threshold.",
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">{client.name}</div>
          <h1>{role.name}</h1>
          <p className="muted">
            {role.description || "Track this role's candidate pipeline."}
          </p>
        </div>
        <div className="header-actions">
          <button onClick={() => setEditing(true)}>Edit role</button>
          <button disabled={busy} onClick={() => void toggleArchive()}>
            <Archive size={16} />
            {role.archived ? "Restore" : "Archive"}
          </button>
        </div>
      </header>
      {error && (
        <p className="toast error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="toast success" role="status">
          {message}
        </p>
      )}
      {role.archived && (
        <div className="notice">
          <CircleHelp size={18} />
          <div>
            This role is archived. Restore it to continue moving candidates
            through the pipeline.
          </div>
        </div>
      )}
      <div className="metrics">
        {[
          ["In pipeline", pipelineTotal, "Not yet rejected"],
          [
            "All profiles",
            counts.all_profiles ?? 0,
            "Awaiting a rating",
          ],
          ["Rejected", counts.rejected ?? 0, "Kept for history"],
          ["Rating threshold", `${role.rating_threshold} / 5`, "To advance"],
        ].map(([label, value, hint]) => (
          <div className="metric" key={label as string}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="tabs">
        {tabs.map(({ key, label }) => (
          <Link
            key={key}
            className={tab === key ? "selected" : ""}
            href={tabUrl(key)}
          >
            {label}
            <span>
              {key === "master_db" ? total : (counts[key] ?? 0)}
            </span>
          </Link>
        ))}
      </div>
      {tab !== "master_db" && (
        <div className="section-heading">
          <h2>{tab === "rejected" ? "Rejects" : stageLabels[tab as Stage]}</h2>
          <div className="row">
            <button onClick={() => setManagingFields(true)}>Manage columns</button>
            {tab === "all_profiles" && !role.archived && (
              <>
                <button onClick={() => setApplying(true)}>
                  <SlidersHorizontal size={15} />
                  Apply threshold
                </button>
                <button
                  className="primary small"
                  onClick={() => setImporting(true)}
                >
                  <Plus size={15} />
                  Add candidates
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {isPipelineTab && selected.length > 0 && (
        <div className="bulk-bar">
          <strong>{selected.length} selected</strong>
          <input
            aria-label="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            maxLength={4000}
          />
          {advanceTo && (
            <button disabled={busy} onClick={() => void moveSelectedToNextStage()}>
              Move to {stageLabels[advanceTo]}
            </button>
          )}
          <button disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </button>
        </div>
      )}
      {tab === "master_db" ? (
        <>
          <form
            className="sheet-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              router.push(masterDbUrl({ q: String(f.get("q") ?? "") }));
            }}
          >
            <input
              name="q"
              aria-label="Search the master candidate database"
              placeholder="Search name, headline, company or email…"
              defaultValue={params.get("q") ?? ""}
            />
            <button>Search</button>
            <Link href={masterDbUrl({ q: "" })}>Clear</Link>
          </form>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Full name</th>
                  <th>Headline</th>
                  <th>Company</th>
                  <th>Location</th>
                  <th>Experience</th>
                  <th>Contact</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {masterCandidates.map((c) => (
                  <tr key={c.id}>
                    <td className="strong">{c.full_name}</td>
                    <td>{c.headline || "—"}</td>
                    <td>{c.current_company || "—"}</td>
                    <td>{c.location || "—"}</td>
                    <td>
                      {c.total_experience_years != null
                        ? `${c.total_experience_years} yrs`
                        : "—"}
                    </td>
                    <td>
                      {c.phone || c.email ? (
                        <span className="badge accepted">Available</span>
                      ) : (
                        <span className="badge">None yet</span>
                      )}
                    </td>
                    <td>{date(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!masterCandidates.length && (
              <div className="empty">
                <h3>{candidateEmptyMessage(tab)}</h3>
              </div>
            )}
          </div>
          <div className="sheet-footer">
            <span>
              {total
                ? `${(page - 1) * 50 + 1}–${Math.min(page * 50, total)} of ${total}`
                : "0 candidates"}
            </span>
            <div className="row">
              {page > 1 && (
                <Link
                  className="button small"
                  href={masterDbUrl({ page: String(page - 1) })}
                >
                  Previous
                </Link>
              )}
              {page * 50 < total && (
                <Link
                  className="button small"
                  href={masterDbUrl({ page: String(page + 1) })}
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                {isPipelineTab && (
                  <th className="select-cell">
                    <input
                      aria-label="Select all visible candidates"
                      type="checkbox"
                      checked={
                        roleCandidates.length > 0 &&
                        selected.length === roleCandidates.length
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? roleCandidates.map((rc) => rc.id) : [],
                        )
                      }
                    />
                  </th>
                )}
                <th>Date added</th>
                <th>Full name</th>
                <th>Designation</th>
                <th>Company</th>
                <th>Experience</th>
                {tab === "rejected" ? (
                  <>
                    <th>Reject type</th>
                    <th>Reason</th>
                  </>
                ) : (
                  <th>Rating</th>
                )}
                {roleFields.map((f) => (
                  <th key={f.id}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roleCandidates.map((rc) => (
                <tr
                  key={rc.id}
                  className={selected.includes(rc.id) ? "selected-row" : ""}
                >
                  {isPipelineTab && (
                    <td>
                      <input
                        aria-label={`Select ${rc.candidates.full_name}`}
                        type="checkbox"
                        checked={selected.includes(rc.id)}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, rc.id]
                              : old.filter((id) => id !== rc.id),
                          )
                        }
                      />
                    </td>
                  )}
                  <td>{date(rc.stage_entered_at)}</td>
                  <td>
                    {tab === "rejected" ? (
                      <span className="strong">{rc.candidates.full_name}</span>
                    ) : (
                      <button
                        type="button"
                        className="text-button strong"
                        onClick={() => setPanelId(rc.id)}
                      >
                        {rc.candidates.full_name}
                      </button>
                    )}
                  </td>
                  <td>{rc.candidates.current_designation || "—"}</td>
                  <td>{rc.candidates.current_company || "—"}</td>
                  <td>
                    {rc.candidates.total_experience_years != null
                      ? `${rc.candidates.total_experience_years} yrs`
                      : "—"}
                  </td>
                  {tab === "rejected" ? (
                    <>
                      <td>
                        {rc.rejection_type
                          ? rejectionTypes[rc.rejection_type as "recruiter" | "client"]
                          : "—"}
                      </td>
                      <td>{rc.rejection_reason || "—"}</td>
                    </>
                  ) : (
                    <td>
                      <RatingCell
                        key={`${rc.id}:${rc.rating}`}
                        clientId={client.id}
                        roleCandidateId={rc.id}
                        rating={rc.rating}
                        name={rc.candidates.full_name}
                        onRated={() => router.refresh()}
                      />
                    </td>
                  )}
                  {roleFields.map((f) => (
                    <td key={f.id}>
                      <CustomFieldCell
                        key={`${f.id}:${rc.id}:${JSON.stringify(rc.custom[f.key])}`}
                        clientId={client.id}
                        roleCandidateId={rc.id}
                        field={f}
                        value={rc.custom[f.key]}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!roleCandidates.length && (
            <div className="empty">
              <h3>{candidateEmptyMessage(tab)}</h3>
            </div>
          )}
        </div>
      )}
      {editing && (
        <RoleFormDialog
          clientId={client.id}
          role={role}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}
      {importing && (
        <AddCandidatesDialog
          clientId={client.id}
          roleId={role.id}
          sourcingProspects={sourcingProspects}
          onClose={() => setImporting(false)}
          onImported={summarize}
        />
      )}
      {rejecting && (
        <RejectDialog
          clientId={client.id}
          ids={selected}
          title={
            selected.length === 1
              ? `Reject ${roleCandidates.find((rc) => rc.id === selected[0])?.candidates.full_name ?? "candidate"}`
              : `Reject ${selected.length} candidates`
          }
          onClose={() => setRejecting(false)}
          onRejected={() => {
            setRejecting(false);
            setSelected([]);
            setMessage(
              `Rejected ${selected.length} candidate${selected.length > 1 ? "s" : ""}.`,
            );
            router.refresh();
          }}
        />
      )}
      {panelId && (
        <CandidatePanel
          clientId={client.id}
          roleCandidate={roleCandidates.find((rc) => rc.id === panelId)!}
          onClose={() => setPanelId(null)}
          onChanged={() => router.refresh()}
        />
      )}
      {managingFields && (
        <RoleFieldsDialog
          clientId={client.id}
          roleId={role.id}
          fields={roleFields}
          onClose={() => setManagingFields(false)}
          onChanged={() => router.refresh()}
        />
      )}
      {applying && (
        <dialog open className="modal">
          <div className="modal-heading">
            <h2>Apply rating threshold</h2>
          </div>
          <p className="muted">
            Moves every candidate still in All profiles whose rating already
            meets the current threshold ({role.rating_threshold} / 5) to
            Profile shortlisted. Candidates rated below the threshold, or not
            yet rated, are left where they are.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button
              className="primary"
              disabled={applyBusy}
              onClick={() => void applyThreshold()}
            >
              {applyBusy ? "Applying…" : "Apply threshold"}
            </button>
            <button
              type="button"
              disabled={applyBusy}
              onClick={() => setApplying(false)}
            >
              Cancel
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
