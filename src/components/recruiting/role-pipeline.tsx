"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  ExternalLink,
  Link as LinkIcon,
  Maximize2,
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
  SourcePerformanceRow,
} from "@/lib/types";
import {
  stages,
  stageLabels,
  isStage,
  nextStage,
  rejectionTypes,
  candidateSourceLabel,
  candidateSources,
  candidateSourceLabels,
  ratingFilters,
  ratingFilterLabels,
  outcomes,
  type PipelineStage,
  type RejectionType,
  type Stage,
} from "@/lib/recruiting/stages";
import { RoleFormDialog } from "./role-form";
import { AddCandidatesDialog, type ImportSummary } from "./add-candidates";
import { RejectDialog } from "./reject-dialog";
import { CandidatePanel } from "./candidate-panel";
import { RoleFieldsDialog } from "./role-fields-dialog";
import { ShareDialog } from "./share-dialog";
import { RoleAnalytics } from "./role-analytics";
import { SheetCell } from "./sheet-cell";
import { candidateColumns, type CandidateColumn } from "@/lib/recruiting/columns";
import { act as sharedAct } from "@/lib/client/act";

function act<T = { id: string }>(action: string, payload: unknown = {}): Promise<T> {
  return sharedAct<T>(action, payload);
}

type Tab = Stage | "follow_ups" | "master_db" | "analytics";
type ColumnId = CandidateColumn["id"];
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

function linkedInUrl(candidate: RoleCandidate["candidates"]) {
  return candidate.candidate_identities?.find(
    (identity) => identity.kind === "linkedin",
  )?.normalized_value;
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
  roleFields,
  shareLinks,
  stageFunnel,
  stageDurations,
  sourcePerformance,
}: {
  client: Client;
  role: Role;
  roleCandidates: RoleCandidate[];
  counts: Record<string, number>;
  masterCandidates: MasterCandidate[];
  masterRoleCandidateIds: string[];
  total: number;
  page: number;
  roleFields: RoleField[];
  shareLinks: ShareLink[];
  stageFunnel: StageFunnelRow[];
  stageDurations: StageDurationRow[];
  sourcePerformance: SourcePerformanceRow[];
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
  const [rejectingIds, setRejectingIds] = useState<string[]>([]);
  const [movingCandidateId, setMovingCandidateId] = useState<string | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [managingFields, setManagingFields] = useState(false);
  const [sharing, setSharing] = useState<"client" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingFollowUpId, setSavingFollowUpId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [columnPreference, setColumnPreference] = useState<string | null>(null);
  const [navigatingTo, setNavigatingTo] = useState<Tab | null>(null);
  const path = `/roles/${role.id}`;
  // v2: the stage-aware column set replaced the old fixed ids. A preference
  // saved under the old key names columns that no longer exist, which would
  // otherwise filter the table down to whichever id happened to survive.
  const columnStorageKey = `leadscope:role-columns:v2:${role.id}:${tab}`;
  // Rating is the only way out of All profiles. Later stages support both
  // direct row actions and batch actions.
  const isPipelineTab = isStage(tab) && tab !== "rejected";
  const isFollowUpsTab = tab === "follow_ups";
  const canRejectFromTab = [
    "recruiter_shortlisted",
    "client_shortlisted",
    "offer_sent",
  ].includes(tab);
  const tabColumns = useMemo(
    () => (isStage(tab) ? candidateColumns(tab, roleFields) : []),
    [roleFields, tab],
  );

  const advanceTo =
    isPipelineTab && tab !== "all_profiles"
      ? nextStage(tab as PipelineStage)
      : null;
  const canSelectCandidates = Boolean(advanceTo || canRejectFromTab);
  const activeCandidateFilterCount = [
    params.get("source"),
    params.get("source_detail"),
    params.get("rating"),
    params.get("entered_from"),
    params.get("entered_to"),
    params.get("sort") && params.get("sort") !== "newest"
      ? params.get("sort")
      : "",
  ].filter(Boolean).length;
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

  const savedColumnPreference = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("storage", onStoreChange);
      return () => window.removeEventListener("storage", onStoreChange);
    },
    () => localStorage.getItem(columnStorageKey) ?? "",
    () => "",
  );
  const visibleColumns = (() => {
    const availableIds = tabColumns.map((column) => column.id);
    try {
      const saved = JSON.parse(columnPreference ?? savedColumnPreference);
      if (saved && !Array.isArray(saved) && Array.isArray(saved.visible)) {
        const stored = saved.visible.filter(
          (column: unknown): column is ColumnId =>
            typeof column === "string" && availableIds.includes(column as ColumnId),
        );
        // An empty result means the stored choice no longer describes this
        // tab. Showing the tab's real columns beats showing none.
        if (stored.length) return stored;
      }
    } catch {
      // A malformed local preference should never prevent recruiter work.
    }
    return availableIds;
  })();
  const orderedColumns = (() => {
    const availableIds = tabColumns.map((column) => column.id);
    try {
      const saved = JSON.parse(columnPreference ?? savedColumnPreference);
      if (saved && !Array.isArray(saved) && Array.isArray(saved.order)) {
        const validOrder = saved.order.filter((column: unknown): column is ColumnId =>
          typeof column === "string" && availableIds.includes(column as ColumnId),
        );
        return [...new Set([...validOrder, ...availableIds])];
      }
    } catch {
      // Fall through to the useful default order.
    }
    return availableIds;
  })();
  const visibleCandidateColumns = orderedColumns
    .filter((id: ColumnId) => visibleColumns.includes(id))
    .map((id) => tabColumns.find((column) => column.id === id))
    .filter((column): column is CandidateColumn => Boolean(column));

  function toggleColumn(column: ColumnId) {
    const next = visibleColumns.includes(column)
      ? visibleColumns.filter((item: ColumnId) => item !== column)
      : [...visibleColumns, column];
    const serialized = JSON.stringify({ visible: next, order: orderedColumns });
    localStorage.setItem(columnStorageKey, serialized);
    setColumnPreference(serialized);
  }
  function moveColumn(column: ColumnId, direction: -1 | 1) {
    const index = orderedColumns.indexOf(column);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= orderedColumns.length) return;
    const next = [...orderedColumns];
    [next[index], next[target]] = [next[target], next[index]];
    const serialized = JSON.stringify({ visible: visibleColumns, order: next });
    localStorage.setItem(columnStorageKey, serialized);
    setColumnPreference(serialized);
  }
  function resetColumns() {
    localStorage.removeItem(columnStorageKey);
    setColumnPreference("");
  }

  const tabUrl = (key: Tab) => {
    const p = new URLSearchParams(params);
    p.set("stage", key);
    p.delete("page");
    return `${path}?${p}`;
  };
  const prefetchTab = (key: Tab) => router.prefetch(tabUrl(key));
  function startTabNavigation(key: Tab) {
    if (key !== tab) {
      // The role workspace remains mounted between stages. Clear UI state that
      // belongs to the old table before the new server data arrives.
      setSelected([]);
      setPanelId(null);
      setRejecting(false);
      setColumnMenuOpen(false);
    }
    setNavigatingTo(key);
  }
  // One cell renderer for the whole grid. Every editable column resolves to a
  // single-field save so one recruiter typing in a cell never overwrites a
  // column another recruiter changed a moment earlier.
  function renderCandidateCell(
    rc: RoleCandidate,
    column: CandidateColumn,
    rowIndex: number,
    colIndex: number,
  ) {
    const locked = role.archived;
    const cell = (
      props: Partial<Parameters<typeof SheetCell>[0]> & {
        value: string;
        save: (value: string) => Promise<void>;
      },
    ) => (
      <td className="sheet-td" key={column.id}>
        <SheetCell
          col={colIndex}
          kind={column.kind}
          label={`${column.label}, row ${rowIndex + 1}`}
          placeholder={column.placeholder}
          readOnly={locked || !column.editable}
          row={rowIndex}
          {...props}
        />
      </td>
    );
    const candidateField = (field: string, value: string) =>
      cell({
        value,
        save: (next) =>
          act("candidateField", { id: rc.candidate_id, field, value: next }),
      });

    if (column.id.startsWith("custom:")) {
      const field = column.field!;
      const raw = rc.custom[field.key];
      return cell({
        options: field.options,
        value:
          raw == null ? "" : typeof raw === "boolean" ? String(raw) : String(raw),
        save: (next) =>
          act("customField", {
            clientId: client.id,
            id: rc.id,
            key: field.key,
            value:
              next === ""
                ? null
                : field.kind === "number"
                  ? Number(next)
                  : field.kind === "boolean"
                    ? next === "true"
                    : next,
          }),
      });
    }

    switch (column.id) {
      case "date_added":
        return cell({
          value: rc.stage_entered_at,
          display: (value) => date(value),
          save: async () => {},
        });
      case "source":
        return cell({
          value: candidateSourceLabel(rc.source, rc.source_detail),
          save: async () => {},
        });
      case "linkedin": {
        const url = linkedInUrl(rc.candidates);
        return (
          <td className="sheet-td candidate-linkedin-cell" key={column.id}>
            {url ? (
              <a className="candidate-link" href={url} rel="noreferrer" target="_blank">
                Open profile <ExternalLink size={11} />
              </a>
            ) : (
              <span className="sheet-placeholder">—</span>
            )}
          </td>
        );
      }
      case "resume":
        return (
          <td className="sheet-td" key={column.id}>
            <button
              className="sheet-link-button"
              onClick={() => setPanelId(rc.id)}
              type="button"
            >
              {rc.candidates.resume_path ? "View resume" : "Upload"}
            </button>
          </td>
        );
      case "rating":
        return cell({
          value: rc.rating == null ? "" : String(rc.rating),
          save: async (next) => {
            const rating = next === "" ? null : Number(next);
            if (
              rating !== null &&
              (!Number.isFinite(rating) ||
                rating < 0 ||
                rating > 5 ||
                Math.round(rating * 10) !== rating * 10)
            )
              throw new Error("Enter a rating from 0.0 to 5.0.");
            await act("rate", { clientId: client.id, id: rc.id, rating });
            if (tab === "all_profiles" && rating !== null && rating >= role.rating_threshold)
              setMessage(
                `${rc.candidates.full_name} moved to Profile shortlisted after meeting the ${role.rating_threshold} / 5 threshold.`,
              );
            router.refresh();
          },
        });
      case "notes":
        return cell({
          value: rc.client_notes,
          save: (next) =>
            act("clientNote", { clientId: client.id, id: rc.id, note: next }),
        });
      case "outcome":
        return cell({
          options: Object.values(outcomes),
          value: rc.outcome ? outcomes[rc.outcome as keyof typeof outcomes] : "",
          save: async (next) => {
            const outcome = (Object.keys(outcomes) as (keyof typeof outcomes)[]).find(
              (key) => outcomes[key] === next,
            );
            if (!outcome) return;
            await act("recordOutcome", {
              clientId: client.id,
              ids: [rc.id],
              outcome,
            });
            router.refresh();
          },
        });
      case "offer_details":
        return (
          <td className="sheet-td offer-details-cell" key={column.id}>
            <button
              className="offer-details-trigger"
              onClick={() => setPanelId(rc.id)}
              type="button"
            >
              {rc.offer_amount != null ? (
                <strong>
                  {[rc.offer_currency, rc.offer_amount].filter(Boolean).join(" ")}
                </strong>
              ) : (
                <span>Add offer details</span>
              )}
              {rc.offer_response_due_at && (
                <small>Response due {date(rc.offer_response_due_at)}</small>
              )}
            </button>
          </td>
        );
      case "reject_type":
        return cell({
          value: rc.rejection_type
            ? rejectionTypes[rc.rejection_type as RejectionType]
            : "",
          save: async () => {},
        });
      case "reject_reason":
        return cell({ value: rc.rejection_reason, save: async () => {} });
      case "phone":
        return candidateField("phone", rc.candidates.phone ?? "");
      case "email":
        return candidateField("email", rc.candidates.email ?? "");
      case "location":
        return candidateField("location", rc.candidates.location);
      case "current_company":
        return candidateField("current_company", rc.candidates.current_company);
      case "current_designation":
        return candidateField(
          "current_designation",
          rc.candidates.current_designation,
        );
      case "total_experience_years":
        return candidateField(
          "total_experience_years",
          rc.candidates.total_experience_years == null
            ? ""
            : String(rc.candidates.total_experience_years),
        );
      case "current_ctc":
        return candidateField("current_ctc", rc.candidates.current_ctc ?? "");
      case "highest_qualification":
        return candidateField(
          "highest_qualification",
          rc.candidates.highest_qualification ?? "",
        );
      default:
        return null;
    }
  }

  const stagePageUrl = (nextPage: number) => {
    const p = new URLSearchParams(params);
    p.set("stage", tab);
    p.set("page", String(nextPage));
    return `${path}?${p}`;
  };
  const stageFilterUrl = (changes: Record<string, string>) => {
    const p = new URLSearchParams(params);
    p.set("stage", tab);
    p.delete("page");
    Object.entries(changes).forEach(([key, value]) => {
      if (value) p.set(key, value);
      else p.delete(key);
    });
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
    if (busy || movingCandidateId || !advanceTo || !selected.length) return;
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
  async function moveCandidateToNextStage(roleCandidate: RoleCandidate) {
    if (busy || movingCandidateId || !advanceTo || role.archived) return;
    setMovingCandidateId(roleCandidate.id);
    setError("");
    try {
      await act("moveStage", {
        clientId: client.id,
        ids: [roleCandidate.id],
        toStage: advanceTo,
        reason: "",
      });
      setSelected((current) => current.filter((id) => id !== roleCandidate.id));
      setMessage(`Moved ${roleCandidate.candidates.full_name} to ${stageLabels[advanceTo]}.`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMovingCandidateId(null);
    }
  }
  function startReject(ids: string[]) {
    setRejectingIds(ids);
    setRejecting(true);
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
          ? `${result.added} candidate${result.added === 1 ? "" : "s"} added to All profiles.`
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
  async function saveFollowUp(roleCandidate: RoleCandidate, followUpAt: string) {
    if (savingFollowUpId) return;
    setSavingFollowUpId(roleCandidate.id);
    setError("");
    try {
      await act("screening", {
        clientId: client.id,
        id: roleCandidate.id,
        screening: { ...roleCandidate.screening, followUpAt },
        internalNotes: roleCandidate.internal_notes,
      });
      setMessage(followUpAt ? "Follow-up date saved." : "Follow-up cleared.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingFollowUpId(null);
    }
  }
  async function exportCandidates() {
    if (exporting || !isStage(tab)) return;
    setExporting(true);
    setError("");
    try {
      const exportParams = new URLSearchParams(params);
      exportParams.set("client", client.id);
      exportParams.set("role", role.id);
      exportParams.set("stage", tab);
      exportParams.set("format", "csv");
      const response = await fetch(`/api/export?${exportParams}`);
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = URL.createObjectURL(
        new Blob([await response.text()], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = blob;
      link.download = `${role.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "role"}-candidates.csv`;
      link.click();
      URL.revokeObjectURL(blob);
      setMessage("Exported all matching candidates.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <header className="page-header role-workspace-header">
        <div>
          <div className="eyebrow"><Link href={`/clients/${client.id}/roles`}>{client.name}</Link></div>
          <div className="role-title-row">
            <h1>{role.name}</h1>
            <span className={`badge ${role.status}`}>{role.status.replace("_", " ")}</span>
          </div>
          <p className="muted">
            {role.description || "Track this role's candidate pipeline."}
          </p>
        </div>
        <div className="header-actions">
          {!role.archived && (
            <button className="primary" onClick={() => setImporting(true)}>
              <Plus size={16} />
              Add candidates
            </button>
          )}
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
      <div className="role-summary" aria-label="Role summary">
        <span><strong>{pipelineTotal}</strong> active candidates</span>
        <span><strong>{counts.all_profiles ?? 0}</strong> awaiting rating</span>
        <span>Rating floor <strong>{role.rating_threshold} / 5</strong></span>
        <span><strong>{counts.rejected ?? 0}</strong> rejected</span>
      </div>
      <div className="tabs role-stage-tabs" aria-label="Candidate stages">
        {pipelineTabs.map(({ key, label }) => (
          <Link
            key={key}
            className={`stage-tab stage-${key}${tab === key ? " selected" : ""}${navigatingTo === key && tab !== key ? " is-loading" : ""}`}
            href={tabUrl(key)}
            prefetch={false}
            onMouseEnter={() => prefetchTab(key)}
            onFocus={() => prefetchTab(key)}
            onClick={() => startTabNavigation(key)}
            aria-busy={navigatingTo === key && tab !== key}
          >
            {label}
            <span>{counts[key] ?? 0}</span>
          </Link>
        ))}
      </div>
      <nav className="role-secondary-nav" aria-label="Role tools">
        <span>Views</span>
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
        <div className="section-heading role-table-heading">
          <div>
            <h2>{tab === "rejected" ? "Rejects" : stageLabels[tab as Stage]}</h2>
            <p className="muted">{total} candidate{total === 1 ? "" : "s"}</p>
          </div>
          <div className="row">
            <button
              disabled={!total || exporting}
              onClick={() => void exportCandidates()}
            >
              {exporting ? "Preparing…" : "Export CSV"}
            </button>
            {tab === "recruiter_shortlisted" && (
              <button onClick={() => setManagingFields(true)}>Manage columns</button>
            )}
            {tab === "recruiter_shortlisted" ? (
              <>
                <button onClick={() => setSharing("client")}>Manage links</button>
                <button
                  className="primary small"
                  disabled={!total || role.archived}
                  onClick={() => setSharing("client")}
                >
                  <LinkIcon size={15} />
                  Share with client
                </button>
              </>
            ) : null}
            {tab === "all_profiles" && !role.archived && (
              <>
                <button onClick={() => setApplying(true)}>
                  <SlidersHorizontal size={15} />
                  Apply threshold
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {canSelectCandidates && selected.length > 0 && (
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
            <button disabled={busy || Boolean(movingCandidateId) || role.archived} onClick={() => void moveSelectedToNextStage()}>
              Move to {stageLabels[advanceTo]}
            </button>
          )}
          {canRejectFromTab && (
            <button disabled={busy || Boolean(movingCandidateId) || role.archived} onClick={() => startReject(selected)}>
              Reject
            </button>
          )}
        </div>
      )}
      {isStage(tab) && (
        <form
          className="sheet-toolbar candidate-search candidate-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            router.push(
              stageFilterUrl({
                q: String(form.get("q") ?? ""),
                source: String(form.get("source") ?? ""),
                source_detail: String(form.get("source_detail") ?? ""),
                rating: String(form.get("rating") ?? ""),
                entered_from: String(form.get("entered_from") ?? ""),
                entered_to: String(form.get("entered_to") ?? ""),
                sort: String(form.get("sort") ?? ""),
              }),
            );
          }}
        >
          <div className="candidate-toolbar-main">
            <input
              className="candidate-search-input"
              name="q"
              aria-label="Search candidates in this stage"
              placeholder="Search candidates…"
              defaultValue={query}
              maxLength={200}
            />
            <button className="primary" type="submit">Search</button>
            <details
              className="candidate-filter-menu"
              open={filterMenuOpen}
              onToggle={(event) => setFilterMenuOpen(event.currentTarget.open)}
            >
              <summary>
                <SlidersHorizontal size={14} aria-hidden="true" />
                Filters
                {activeCandidateFilterCount > 0 && (
                  <span>{activeCandidateFilterCount}</span>
                )}
              </summary>
              <div className="candidate-filter-grid">
                <label>
                  Source or vendor
                  <input
                    aria-label="Filter candidates by source or vendor"
                    defaultValue={params.get("source_detail") ?? ""}
                    maxLength={200}
                    name="source_detail"
                    placeholder="e.g. LinkedIn"
                  />
                </label>
                <label>
                  Import method
                  <select
                    aria-label="Filter candidates by import method"
                    name="source"
                    defaultValue={params.get("source") ?? ""}
                  >
                    <option value="">All methods</option>
                    {candidateSources.map((source) => (
                      <option key={source} value={source}>
                        {candidateSourceLabels[source]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Rating
                  <select
                    aria-label="Filter candidates by rating"
                    name="rating"
                    defaultValue={params.get("rating") ?? ""}
                  >
                    <option value="">All ratings</option>
                    {ratingFilters.map((filter) => (
                      <option key={filter} value={filter}>
                        {ratingFilterLabels[filter]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Added from
                  <input
                    aria-label="Candidates entered on or after"
                    defaultValue={params.get("entered_from") ?? ""}
                    name="entered_from"
                    type="date"
                  />
                </label>
                <label>
                  Added to
                  <input
                    aria-label="Candidates entered on or before"
                    defaultValue={params.get("entered_to") ?? ""}
                    name="entered_to"
                    type="date"
                  />
                </label>
                <label>
                  Sort by
                  <select
                    aria-label="Sort candidates"
                    name="sort"
                    defaultValue={params.get("sort") ?? "newest"}
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="rating_high">Highest rating</option>
                    <option value="rating_low">Lowest rating</option>
                  </select>
                </label>
              </div>
            </details>
            <div className="candidate-column-menu">
              <button
                type="button"
                aria-expanded={columnMenuOpen}
                onClick={() => setColumnMenuOpen((open) => !open)}
              >
                Columns
              </button>
              {columnMenuOpen && (
                <div className="candidate-column-popover">
                  <div className="candidate-column-popover-heading">
                    <strong>Show and arrange columns</strong>
                    <button type="button" onClick={resetColumns}>Reset</button>
                  </div>
                  {orderedColumns.map((column, index) => {
                    const definition = tabColumns.find((item) => item.id === column);
                    if (!definition) return null;
                    return (
                      <div className="candidate-column-option" key={column}>
                        <label>
                          <input
                            type="checkbox"
                            checked={visibleColumns.includes(column)}
                            onChange={() => toggleColumn(column)}
                          />
                          {definition.label}
                        </label>
                        <span className="candidate-column-order" aria-label={`Move ${definition.label}`}>
                          <button
                            type="button"
                            aria-label={`Move ${definition.label} earlier`}
                            disabled={index === 0}
                            onClick={() => moveColumn(column, -1)}
                          ><ChevronUp size={14} /></button>
                          <button
                            type="button"
                            aria-label={`Move ${definition.label} later`}
                            disabled={index === orderedColumns.length - 1}
                            onClick={() => moveColumn(column, 1)}
                          ><ChevronDown size={14} /></button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {(query || activeCandidateFilterCount > 0 || params.get("sort")) && (
              <Link className="candidate-clear-filters" href={stageFilterUrl({ q: "", source: "", source_detail: "", rating: "", entered_from: "", entered_to: "", sort: "" })}>Clear</Link>
            )}
          </div>
        </form>
      )}
      {tab === "analytics" ? (
        <>
          <div className="section-heading">
            <h2>Analytics</h2>
          </div>
          <RoleAnalytics
            funnel={stageFunnel}
            durations={stageDurations}
            sourcePerformance={sourcePerformance}
          />
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
            <table className="candidate-table">
              <thead>
                <tr>
                  <th>Follow-up</th>
                  <th>Candidate</th>
                  <th className="candidate-linkedin-heading">LinkedIn</th>
                  <th>Current stage</th>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Schedule</th>
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
                    <td className="candidate-linkedin-cell">
                      {linkedInUrl(rc.candidates) ? (
                        <a
                          className="candidate-link"
                          href={linkedInUrl(rc.candidates)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open profile <ExternalLink size={11} />
                        </a>
                      ) : "—"}
                    </td>
                    <td>
                      {isStage(rc.stage) ? stageLabels[rc.stage] : rc.stage}
                    </td>
                    <td>{rc.candidates.current_company || "—"}</td>
                    <td>{rc.candidates.phone || rc.candidates.email || "—"}</td>
                    <td>
                      <form
                        className="follow-up-schedule"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const values = new FormData(event.currentTarget);
                          void saveFollowUp(rc, String(values.get("followUpAt") ?? ""));
                        }}
                      >
                        <input
                          aria-label={`Follow-up date for ${rc.candidates.full_name}`}
                          defaultValue={rc.follow_up_at ?? ""}
                          disabled={savingFollowUpId === rc.id}
                          name="followUpAt"
                          type="date"
                        />
                        <button
                          className="small"
                          disabled={savingFollowUpId === rc.id}
                          type="submit"
                        >
                          {savingFollowUpId === rc.id ? "Saving…" : "Save"}
                        </button>
                        <button
                          aria-label={`Clear follow-up for ${rc.candidates.full_name}`}
                          className="small"
                          disabled={savingFollowUpId === rc.id}
                          onClick={() => void saveFollowUp(rc, "")}
                          type="button"
                        >
                          Clear
                        </button>
                      </form>
                    </td>
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
                  <th className="candidate-linkedin-heading">LinkedIn</th>
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
                    <td className="candidate-linkedin-cell">
                      {linkedInUrl(c) ? (
                        <a
                          className="candidate-link"
                          href={linkedInUrl(c)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open profile <ExternalLink size={11} />
                        </a>
                      ) : "—"}
                    </td>
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
            <table
              className={`candidate-table sheet-table${canSelectCandidates ? " has-select" : ""}`}
              data-sheet-grid=""
              role="grid"
            >
              <thead>
                <tr>
                {canSelectCandidates && (
                  <th className="select-cell" scope="col">
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
                <th className="candidate-open-heading" scope="col">
                  <span className="sr-only">Open candidate</span>
                </th>
                <th className="sheet-th sheet-th-pinned" scope="col">Full name</th>
                {visibleCandidateColumns.map((column) => (
                  <th className="sheet-th" key={column.id} scope="col">
                    {column.label}
                  </th>
                ))}
                {canSelectCandidates && <th className="candidate-action-heading" scope="col">Action</th>}
                </tr>
              </thead>
              <tbody>
              {roleCandidates.map((rc, rowIndex) => {
                return (
                <tr
                  key={rc.id}
                  className={selected.includes(rc.id) ? "selected-row" : ""}
                >
                  {canSelectCandidates && (
                    <td className="select-cell">
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
                  <td className="candidate-open-cell">
                    <button
                      aria-label={`Open ${rc.candidates.full_name}`}
                      className="candidate-open-button"
                      onClick={() => setPanelId(rc.id)}
                      title="Open candidate details"
                      type="button"
                    >
                      <Maximize2 size={13} />
                    </button>
                  </td>
                  <td className="sheet-td sheet-td-pinned">
                    <SheetCell
                      col={0}
                      label={`Full name, row ${rowIndex + 1}`}
                      readOnly={role.archived}
                      row={rowIndex}
                      save={(value) =>
                        act("candidateField", {
                          id: rc.candidate_id,
                          field: "full_name",
                          value,
                        })
                      }
                      value={rc.candidates.full_name}
                    />
                  </td>
                  {visibleCandidateColumns.map((column, columnIndex) =>
                    renderCandidateCell(rc, column, rowIndex, columnIndex + 1),
                  )}
                  {canSelectCandidates && (
                    <td className="candidate-action-cell">
                      <div className="candidate-row-actions">
                        {advanceTo && (
                          <button
                            className="small primary"
                            disabled={busy || Boolean(movingCandidateId) || role.archived}
                            onClick={() => void moveCandidateToNextStage(rc)}
                          >
                            {movingCandidateId === rc.id
                              ? "Moving…"
                              : `Move to ${stageLabels[advanceTo]}`}
                          </button>
                        )}
                        {canRejectFromTab && (
                          <button
                            className="small"
                            disabled={busy || Boolean(movingCandidateId) || role.archived}
                            onClick={() => startReject([rc.id])}
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                );
              })}
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
          onClose={() => setImporting(false)}
          onImported={summarize}
        />
      )}
      {rejecting && (
        <RejectDialog
          clientId={client.id}
          ids={rejectingIds}
          title={
            rejectingIds.length === 1
              ? `Reject ${roleCandidates.find((rc) => rc.id === rejectingIds[0])?.candidates.full_name ?? "candidate"}`
              : `Reject ${rejectingIds.length} candidates`
          }
          onClose={() => {
            setRejecting(false);
            setRejectingIds([]);
          }}
          onRejected={() => {
            setRejecting(false);
            setSelected((current) =>
              current.filter((id) => !rejectingIds.includes(id)),
            );
            setMessage(
              `Rejected ${rejectingIds.length} candidate${rejectingIds.length > 1 ? "s" : ""}.`,
            );
            setRejectingIds([]);
            router.refresh();
          }}
        />
      )}
      {panelId && (
        (() => {
          const panelIndex = roleCandidates.findIndex((rc) => rc.id === panelId);
          const panelCandidate = roleCandidates[panelIndex];
          if (!panelCandidate) return null;
          const previous = roleCandidates[panelIndex - 1];
          const next = roleCandidates[panelIndex + 1];
          return (
            <CandidatePanel
              key={panelCandidate.id}
              clientId={client.id}
              roleCandidate={panelCandidate}
              previousCandidate={
                previous
                  ? { id: previous.id, name: previous.candidates.full_name }
                  : null
              }
              nextCandidate={
                next ? { id: next.id, name: next.candidates.full_name } : null
              }
              position={panelIndex + 1}
              totalInView={roleCandidates.length}
              onNavigate={setPanelId}
              onClose={() => setPanelId(null)}
              onChanged={() => router.refresh()}
            />
          );
        })()
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
      {sharing && tab === "recruiter_shortlisted" && (
        <ShareDialog
          clientId={client.id}
          roleId={role.id}
          links={shareLinks}
          fields={roleFields}
          onClose={() => setSharing(null)}
          onChanged={() => router.refresh()}
        />
      )}
      {applying && (
        <dialog open className="modal">
          <div className="modal-heading">
            <h2>Apply rating threshold</h2>
          </div>
          <p className="muted">
            Moves every candidate still in All profiles whose manually entered rating already
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
