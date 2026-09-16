"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Archive,
  CircleHelp,
  Link as LinkIcon,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import type {
  Client,
  MasterCandidate,
  Role,
  RoleCandidate,
  RoleField,
  ShareLink,
  StageDurationRow,
  StageFunnelRow,
} from "@/lib/types";
import {
  stages,
  stageLabels,
  isStage,
  nextStage,
  rejectionTypes,
  candidateSourceLabel,
  type PipelineStage,
  type Stage,
} from "@/lib/recruiting/stages";
import { RoleFormDialog } from "./role-form";
import { AddCandidatesDialog, type ImportSummary } from "./add-candidates";
import { RejectDialog } from "./reject-dialog";
import { RatingCell } from "./rating-cell";
import { CandidatePanel } from "./candidate-panel";
import { CustomFieldCell } from "./custom-field-cell";
import { OutcomeCell } from "./outcome-cell";
import { RoleFieldsDialog } from "./role-fields-dialog";
import { ShareDialog } from "./share-dialog";
import { RoleAnalytics } from "./role-analytics";

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

type Tab = Stage | "follow_ups" | "master_db" | "analytics";
const pipelineTabs: { key: Tab; label: string }[] = [
  ...stages
    .filter((s) => s !== "rejected")
    .map((s) => ({ key: s as Tab, label: stageLabels[s] })),
  { key: "rejected", label: "Rejects" },
];

const date = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

function candidateEmptyMessage(tab: Tab, query = "") {
  if (query) return "No candidates match this search.";
  if (tab === "follow_ups") return "No recruiter follow-ups are scheduled for this role.";
  if (tab === "master_db") return "No candidates in the master database yet.";
  if (tab === "rejected") return "No candidates rejected yet.";
  if (tab === "all_profiles")
    return "No candidates yet. Add candidates from LinkedIn, Naukri, manual entry, or a CSV import.";
  return `No candidates in ${stageLabels[tab as Stage].toLowerCase()} yet.`;
}
const clientDecisionLabels = {
  shortlisted: "Shortlisted",
  hold: "On hold",
  rejected: "Rejected",
} as const;
const clientDecisionBadge = {
  shortlisted: "accepted",
  hold: "review",
  rejected: "rejected",
} as const;
function formatInterview(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function followUpStatus(value: string) {
  const today = new Date();
  const localToday = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  if (value < localToday) return "Overdue";
  if (value === localToday) return "Due today";
  return "Upcoming";
}

function followUpDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function RolePipeline({
  client,
  role,
  roleCandidates,
  counts,
  masterCandidates,
  masterRoleCandidateIds,
  total,
  page,
  sourcingProspects,
  roleFields,
  shareLinks,
  stageFunnel,
  stageDurations,
}: {
  client: Client;
  role: Role;
  roleCandidates: RoleCandidate[];
  counts: Record<string, number>;
  masterCandidates: MasterCandidate[];
  masterRoleCandidateIds: string[];
  total: number;
  page: number;
  sourcingProspects: { id: string; canonical_url: string; title: string }[];
  roleFields: RoleField[];
  shareLinks: ShareLink[];
  stageFunnel: StageFunnelRow[];
  stageDurations: StageDurationRow[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const rawStage = params.get("stage") ?? "";
  const query = params.get("q")?.trim() ?? "";
  const tab: Tab = isStage(rawStage)
    ? (rawStage as Tab)
    : rawStage === "follow_ups" ||
        rawStage === "master_db" ||
        rawStage === "analytics"
      ? rawStage
      : "all_profiles";
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [masterSelection, setMasterSelection] = useState({
    scope: "",
    ids: [] as string[],
  });
  const [rejecting, setRejecting] = useState(false);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [managingFields, setManagingFields] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const path = `/roles/${role.id}`;
  // The bulk bar and rating cells only apply to the five pipeline stages.
  const isPipelineTab = isStage(tab) && tab !== "rejected";
  const isFollowUpsTab = tab === "follow_ups";
  const showsClientResponse =
    tab === "client_shortlisted" || tab === "offer_sent" || tab === "rejected";
  const advanceTo = isPipelineTab ? nextStage(tab as PipelineStage) : null;
  const pipelineTotal = Object.entries(counts)
    .filter(([stage]) => stage !== "rejected")
    .reduce((sum, [, n]) => sum + n, 0);
  // A selection belongs to the visible Master DB page. A stale selection is
  // ignored as soon as the recruiter changes search, page, or tab.
  const masterSelectionScope = `${tab}:${page}:${query}`;
  const masterSelected =
    masterSelection.scope === masterSelectionScope ? masterSelection.ids : [];
  function setMasterSelected(
    next: string[] | ((current: string[]) => string[]),
  ) {
    setMasterSelection((current) => {
      const visibleIds =
        current.scope === masterSelectionScope ? current.ids : [];
      return {
        scope: masterSelectionScope,
        ids: typeof next === "function" ? next(visibleIds) : next,
      };
    });
  }

  const tabUrl = (key: Tab) => {
    const p = new URLSearchParams(params);
    p.set("stage", key);
    p.delete("page");
    return `${path}?${p}`;
  };
  const stagePageUrl = (nextPage: number) => {
    const p = new URLSearchParams(params);
    p.set("stage", tab);
    p.set("page", String(nextPage));
    return `${path}?${p}`;
  };
  const stageSearchUrl = (nextQuery: string) => {
    const p = new URLSearchParams(params);
    p.set("stage", tab);
    p.delete("page");
    if (nextQuery.trim()) p.set("q", nextQuery.trim());
    else p.delete("q");
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
  async function addSelectedFromMasterDb() {
    if (busy || !masterSelected.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await act<{ added: number; alreadyInRole: number }>(
        "addExistingCandidates",
        { clientId: client.id, roleId: role.id, candidateIds: masterSelected },
      );
      setMasterSelected([]);
      setMessage(
        result.added
          ? `${result.added} candidate${result.added === 1 ? "" : "s"} added to New profiles.`
          : "Those candidates are already in this role.",
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
          ? `${result.moved} candidate${result.moved > 1 ? "s" : ""} moved to AI shortlisted.`
          : "No candidates in New profiles currently meet the threshold.",
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
            "New profiles",
            counts.all_profiles ?? 0,
            "Awaiting a manual rating",
          ],
          ["Rejected", counts.rejected ?? 0, "Kept for history"],
          ["Shortlist threshold", `${role.rating_threshold} / 5`, "Manual rating"],
        ].map(([label, value, hint]) => (
          <div className="metric" key={label as string}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="tabs">
        {pipelineTabs.map(({ key, label }) => (
          <Link
            key={key}
            className={tab === key ? "selected" : ""}
            href={tabUrl(key)}
          >
            {label}
            <span>{counts[key] ?? 0}</span>
          </Link>
        ))}
      </div>
      <nav className="role-secondary-nav" aria-label="Role tools">
        <span>Role tools</span>
        <Link className={isFollowUpsTab ? "selected" : ""} href={tabUrl("follow_ups")}>
          Follow-ups
        </Link>
        <Link className={tab === "master_db" ? "selected" : ""} href={tabUrl("master_db")}>
          Master DB
        </Link>
        <Link className={tab === "analytics" ? "selected" : ""} href={tabUrl("analytics")}>
          Analytics
        </Link>
      </nav>
      {isStage(tab) && (
        <div className="section-heading">
          <h2>{tab === "rejected" ? "Rejects" : stageLabels[tab as Stage]}</h2>
          <div className="row">
            <button onClick={() => setManagingFields(true)}>Manage columns</button>
            <button onClick={() => setSharing(true)}>
              <LinkIcon size={15} />
              Share with client
            </button>
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
      {isStage(tab) && (
        <form
          className="sheet-toolbar candidate-search"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            router.push(stageSearchUrl(String(form.get("q") ?? "")));
          }}
        >
          <input
            name="q"
            aria-label="Search candidates in this stage"
            placeholder="Search name, title, or company…"
            defaultValue={query}
            maxLength={200}
          />
          <button>Search</button>
          {query && <Link href={stageSearchUrl("")}>Clear</Link>}
        </form>
      )}
      {tab === "analytics" ? (
        <>
          <div className="section-heading">
            <h2>Analytics</h2>
          </div>
          <RoleAnalytics funnel={stageFunnel} durations={stageDurations} />
        </>
      ) : isFollowUpsTab ? (
        <>
          <div className="section-heading">
            <div>
              <h2>Follow-ups</h2>
              <p className="muted">
                Candidates with a recruiter follow-up date, ordered by urgency.
              </p>
            </div>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Follow-up</th>
                  <th>Candidate</th>
                  <th>Current stage</th>
                  <th>Company</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {roleCandidates.map((rc) => (
                  <tr key={rc.id}>
                    <td>
                      <strong>{followUpDate(rc.follow_up_at)}</strong>
                      {rc.follow_up_at && (
                        <small
                          className={`follow-up-status ${followUpStatus(rc.follow_up_at).replaceAll(" ", "-").toLowerCase()}`}
                        >
                          {followUpStatus(rc.follow_up_at)}
                        </small>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-button strong"
                        onClick={() => setPanelId(rc.id)}
                      >
                        {rc.candidates.full_name}
                      </button>
                      <small className="candidate-source">
                        {candidateSourceLabel(rc.source, rc.source_detail)}
                      </small>
                    </td>
                    <td>
                      {isStage(rc.stage) ? stageLabels[rc.stage] : rc.stage}
                    </td>
                    <td>{rc.candidates.current_company || "—"}</td>
                    <td>{rc.candidates.phone || rc.candidates.email || "—"}</td>
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
          <div className="sheet-footer">
            <span>
              {total
                ? `${(page - 1) * 50 + 1}–${Math.min(page * 50, total)} of ${total}`
                : "0 candidates"}
            </span>
            <div className="row">
              {page > 1 && (
                <Link className="button small" href={stagePageUrl(page - 1)}>
                  Previous
                </Link>
              )}
              {page * 50 < total && (
                <Link className="button small" href={stagePageUrl(page + 1)}>
                  Next
                </Link>
              )}
            </div>
          </div>
        </>
      ) : tab === "master_db" ? (
        <>
          <div className="section-heading">
            <div>
              <h2>Master database</h2>
              <p className="muted">Reuse an existing candidate for this role.</p>
            </div>
            {masterSelected.length > 0 && !role.archived && (
              <button
                className="primary small"
                disabled={busy}
                onClick={() => void addSelectedFromMasterDb()}
              >
                Add {masterSelected.length} to role
              </button>
            )}
          </div>
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
                  <th className="select-cell">
                    <input
                      aria-label="Select all candidates not yet in this role"
                      type="checkbox"
                      disabled={busy || role.archived}
                      checked={
                        masterCandidates.some((candidate) => !masterRoleCandidateIds.includes(candidate.id)) &&
                        masterCandidates
                          .filter((candidate) => !masterRoleCandidateIds.includes(candidate.id))
                          .every((candidate) => masterSelected.includes(candidate.id))
                      }
                      onChange={(event) =>
                        setMasterSelected(
                          event.target.checked
                            ? masterCandidates
                                .filter((candidate) => !masterRoleCandidateIds.includes(candidate.id))
                                .map((candidate) => candidate.id)
                            : [],
                        )
                      }
                    />
                  </th>
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
                    <td>
                      {masterRoleCandidateIds.includes(c.id) ? (
                        <span className="badge accepted">In this role</span>
                      ) : (
                        <input
                          aria-label={`Add ${c.full_name} to this role`}
                          type="checkbox"
                          disabled={busy || role.archived}
                          checked={masterSelected.includes(c.id)}
                          onChange={(event) =>
                            setMasterSelected((current) =>
                              event.target.checked
                                ? [...current, c.id]
                                : current.filter((id) => id !== c.id),
                            )
                          }
                        />
                      )}
                    </td>
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
                <h3>{candidateEmptyMessage(tab, query)}</h3>
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
        <>
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
                {tab === "offer_sent" && <th>Outcome</th>}
                {showsClientResponse && <th>Client response</th>}
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
                    <button
                      type="button"
                      className="text-button strong"
                      onClick={() => setPanelId(rc.id)}
                    >
                      {rc.candidates.full_name}
                    </button>
                    <small className="candidate-source">
                      {candidateSourceLabel(rc.source, rc.source_detail)}
                    </small>
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
                        threshold={role.rating_threshold}
                        autoAdvance={tab === "all_profiles"}
                        onRated={(autoAdvanced) => {
                          if (autoAdvanced)
                            setMessage(
                              `${rc.candidates.full_name} moved to AI shortlisted after meeting the ${role.rating_threshold} / 5 threshold.`,
                            );
                          router.refresh();
                        }}
                      />
                    </td>
                  )}
                  {tab === "offer_sent" && (
                    <td>
                      <OutcomeCell
                        key={`${rc.id}:${rc.outcome}`}
                        clientId={client.id}
                        roleCandidateId={rc.id}
                        outcome={rc.outcome}
                        onChanged={() => router.refresh()}
                      />
                    </td>
                  )}
                  {showsClientResponse && (
                    <td className="candidate-client-response-cell">
                      {rc.client_decision ? (
                        <span className={`badge ${clientDecisionBadge[rc.client_decision]}`}>
                          {clientDecisionLabels[rc.client_decision]}
                        </span>
                      ) : (
                        <span className="muted">Awaiting response</span>
                      )}
                      {rc.interview_at && (
                        <small>Interview {formatInterview(rc.interview_at)}</small>
                      )}
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
                <h3>{candidateEmptyMessage(tab, query)}</h3>
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
                <Link className="button small" href={stagePageUrl(page - 1)}>
                  Previous
                </Link>
              )}
              {page * 50 < total && (
                <Link className="button small" href={stagePageUrl(page + 1)}>
                  Next
                </Link>
              )}
            </div>
          </div>
        </>
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
          roleFields={roleFields}
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
      {sharing && isStage(tab) && (
        <ShareDialog
          clientId={client.id}
          roleId={role.id}
          stage={tab}
          links={shareLinks}
          fields={roleFields}
          onClose={() => setSharing(false)}
          onChanged={() => router.refresh()}
        />
      )}
      {applying && (
        <dialog open className="modal">
          <div className="modal-heading">
            <h2>Apply rating threshold</h2>
          </div>
          <p className="muted">
            Moves every candidate still in New profiles whose manually entered rating already
            meets the current threshold ({role.rating_threshold} / 5) to
            AI shortlisted. Candidates rated below the threshold, or not
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
