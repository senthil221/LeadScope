"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  ExternalLink,
  Link as LinkIcon,
  Maximize2,
  Minimize2,
  Plus,
  Rows3,
  Trash2,
  SlidersHorizontal,
  X,
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
  defaultCandidateSource,
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
import { SheetCell, type SheetCellNode } from "./sheet-cell";
import {
  candidateColumns,
  defaultVisibleColumnIds,
  stageDefaultsToCompact,
  stageShowsName,
  type CandidateColumn,
} from "@/lib/recruiting/columns";
import { isSingleValue, parsePastedBlock } from "@/lib/recruiting/paste";
import {
  draftBlocker,
  draftImportRow,
  isDraftColumnEditable,
  isDraftEmpty,
  isDraftReady,
  type DraftRow,
} from "@/lib/recruiting/drafts";
import { act as sharedAct } from "@/lib/client/act";
import { ColumnResizeHandle, useTableLayout } from "./table-layout";
import styles from "./role-workspace.module.css";
import { DeletedCandidates } from "./deleted-candidates";
import { formatMobile } from "@/lib/recruiting/contact";
import { TableDialog } from "./table-dialog";
import { BulkEditDialog } from "./bulk-edit-dialog";
import { EditHistoryDialog } from "./edit-history";
import { DuplicateReview } from "./duplicate-review";
import { RoleToolsMenu } from "./role-tools-menu";

function act<T = { id: string }>(action: string, payload: unknown = {}): Promise<T> {
  return sharedAct<T>(action, payload);
}

type Tab = Stage | "follow_ups" | "master_db" | "analytics";
type ColumnId = CandidateColumn["id"];

// Keys only have to be unique and stable for React's benefit, and a draft
// never outlives the browser session that created it.
function newDraft(): DraftRow {
  return { key: crypto.randomUUID(), values: {} };
}
// Three groups, because they are three different things. All profiles is
// everyone on the role, the flow is the sequence a candidate is worked
// through, and Rejects is where people leave it. Only the middle group is a
// pipeline, so only the middle group is drawn as one.
const flowStages = stages.filter(
  (s) => s !== "all_profiles" && s !== "rejected",
);

const date = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not provided";

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
  if (!value) return "Not provided";
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

// Every stored profile URL is canonicalised to https://www.linkedin.com/in/…,
// so the first twenty-four characters of the column are the same on every row
// and carry nothing. They are hidden while reading and come back the moment
// the cell is opened, because what is saved is still the whole URL.
function shortProfileUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/i, "");
}

export function RolePipeline({
  client,
  role,
  roleCandidates,
  counts,
  masterCandidates,
  masterRoleMemberships,
  total,
  page,
  roleFields,
  shareLinks,
  stageFunnel,
  stageDurations,
  sourcePerformance,
  isOwner,
}: {
  client: Client;
  role: Role;
  roleCandidates: RoleCandidate[];
  counts: Record<string, number>;
  masterCandidates: MasterCandidate[];
  masterRoleMemberships: { id: string; candidate_id: string; stage: string }[];
  total: number;
  page: number;
  roleFields: RoleField[];
  shareLinks: ShareLink[];
  stageFunnel: StageFunnelRow[];
  stageDurations: StageDurationRow[];
  sourcePerformance: SourcePerformanceRow[];
  /** Deletion is offered only to the workspace owner. */
  isOwner: boolean;
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
  const selectionScope = `${role.id}:${params.toString()}`;
  const [selection, setSelection] = useState({ scope: selectionScope, ids: [] as string[] });
  const selected = selection.scope === selectionScope ? selection.ids : [];
  function setSelected(next: string[] | ((ids: string[]) => string[])) {
    setSelection((previous) => ({ scope: selectionScope, ids: typeof next === "function" ? next(previous.scope === selectionScope ? previous.ids : []) : next }));
  }
  // The grid is the job, so it gets the screen by default. Collapsing back to
  // the page layout stays available for anyone who wants the surrounding
  // navigation, and Escape is the way out for anyone who arrives here by
  // accident.
  const [expanded, setExpanded] = useState(true);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [resumeBusyId, setResumeBusyId] = useState<string | null>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const resumeForRef = useRef<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [bulkEditing, setBulkEditing] = useState<string[] | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [expanded]);
  // Escape leaves the role. It is also the grid's cancel key and the way out
  // of every dialog, so it only navigates once nothing nearer has claimed it:
  // a cell being edited calls preventDefault, an open dialog handles its own,
  // and anything typed into still belongs to whoever is typing.
  useEffect(() => {
    function leave(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))
      )
        return;
      router.push(`/clients/${client.id}/roles?list=1`);
    }
    document.addEventListener("keydown", leave);
    return () => document.removeEventListener("keydown", leave);
  }, [client.id, router]);
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
  const [drafts, setDrafts] = useState<DraftRow[]>(() => [newDraft()]);
  const creatingDrafts = useRef(new Set<string>());

  // Confirmations are not worth reading twice; clear them on their own.
  // Failures stay longer, and can be dismissed, because they need acting on.
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 9000);
    return () => clearTimeout(timer);
  }, [error]);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenu = useRef<HTMLDetailsElement>(null);
  const columnMenu = useRef<HTMLDivElement>(null);
  // Both toolbar menus float over the grid, so a click anywhere else is a
  // click on the table underneath and should put the menu away first. Escape
  // does the same, and is taken before the handler that leaves the role.
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (filterMenu.current && !filterMenu.current.contains(target))
        setFilterMenuOpen(false);
      if (columnMenu.current && !columnMenu.current.contains(target))
        setColumnMenuOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !(filterMenuOpen || columnMenuOpen)) return;
      event.preventDefault();
      event.stopPropagation();
      setFilterMenuOpen(false);
      setColumnMenuOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
    };
  }, [columnMenuOpen, filterMenuOpen]);
  const [columnPreference, setColumnPreference] = useState<{ scope: string; value: string } | null>(null);
  const [navigatingTo, setNavigatingTo] = useState<Tab | null>(null);
  const path = `/roles/${role.id}`;
  const layout = useTableLayout(`${role.id}:${tab}`, stageDefaultsToCompact(tab));
  const tableFrame = useRef<HTMLDivElement>(null);
  const [tableFrameWidth, setTableFrameWidth] = useState(0);
  useEffect(() => {
    const frame = tableFrame.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setTableFrameWidth(entry.contentRect.width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, [tab]);
  // v5 adds Status to the All profiles default. A saved v4 preference would
  // pin the older set and hide a column that was just asked for, so the key
  // moves and every tab starts from the current default again.
  const columnStorageKey = `leadscope:role-columns:v5:${role.id}:${tab}`;
  // Rating is the only way out of All profiles. Later stages support both
  // direct row actions and batch actions.
  const isPipelineTab = isStage(tab) && tab !== "rejected";
  const isFollowUpsTab = tab === "follow_ups";
  const canRejectFromTab = [
    "profile_shortlisted",
    "recruiter_shortlisted",
    "client_shortlisted",
    "offer_sent",
  ].includes(tab);
  // Cheap and pure; the compiler memoizes it without a manual dependency list.
  const tabColumns = isStage(tab) ? candidateColumns(tab, roleFields) : [];

  const advanceTo =
    isPipelineTab && tab !== "all_profiles"
      ? nextStage(tab as PipelineStage)
      : null;
  const canSelectCandidates = isStage(tab) || isFollowUpsTab;
  // Deletion is the owner's alone. The RPCs refuse anyone else, so this only
  // decides whether the control is offered rather than whether it works.
  const canDeleteRows = canSelectCandidates && !role.archived && isOwner;
  const showRowActions = Boolean(advanceTo || canRejectFromTab) || canDeleteRows;
  const activeCandidateFilterCount = [
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
  // All profiles lists the role's whole history, rejections included, so its
  // tab count is every stage rather than the one named after it.
  const roleTotal = pipelineTotal + (counts.rejected ?? 0);
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
  // One checkbox column, two meanings, decided per row by whether that person
  // is already on the role. The selection is split here so each button knows
  // exactly what it acts on.
  const masterMembershipByCandidate = new Map(
    masterRoleMemberships.map((membership) => [membership.candidate_id, membership]),
  );
  const masterToAdd = masterSelected.filter((id) => !masterMembershipByCandidate.has(id));
  const masterToRemove = masterSelected
    .map((id) => masterMembershipByCandidate.get(id))
    .filter((membership): membership is { id: string; candidate_id: string; stage: string } =>
      membership !== undefined,
    );

  const savedColumnPreference = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("storage", onStoreChange);
      return () => window.removeEventListener("storage", onStoreChange);
    },
    () => localStorage.getItem(columnStorageKey) ?? "",
    () => "",
  );
  const activeColumnPreference = columnPreference?.scope === columnStorageKey
    ? columnPreference.value
    : savedColumnPreference;
  const visibleColumns = (() => {
    const availableIds = tabColumns.map((column) => column.id);
    try {
      const saved = JSON.parse(activeColumnPreference);
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
    return isStage(tab) ? defaultVisibleColumnIds(tab, tabColumns) : availableIds;
  })();
  const orderedColumns = (() => {
    const availableIds = tabColumns.map((column) => column.id);
    try {
      const saved = JSON.parse(activeColumnPreference);
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
  const columnWidths = { xs: 96, sm: 128, md: 160, lg: 220 };
  const showNameColumn = stageShowsName(tab);
  // Something has to stay put while the grid scrolls sideways. Normally that is
  // the name; where the name is hidden, whichever column has been dragged into
  // first place stands in for it and is pinned instead.
  const pinnedColumnId = showNameColumn ? null : visibleCandidateColumns[0]?.id;
  const nameWidth = showNameColumn
    ? Math.max(180, layout.width("full_name", 280))
    : 0;
  // Keyboard addressing counts the editable cells, so the data columns start
  // one place earlier once the name is not one of them.
  const firstDataColumn = showNameColumn ? 1 : 0;
  const utilityWidth = (canSelectCandidates ? 36 : 0) + 36 + 28;
  // Advance, Reject and a delete icon, counting only what this tab shows, and
  // never narrower than the word "Action" in the heading.
  const actionWidth = showRowActions
    ? Math.max(
        78,
        (advanceTo ? 82 : 0) + (canRejectFromTab ? 66 : 0) + (canDeleteRows ? 34 : 0) + 16,
      )
    : 0;
  const fixedWidth = utilityWidth + nameWidth + actionWidth;
  const dataWidth = visibleCandidateColumns.reduce((sum, column) => sum + layout.width(column.id, columnWidths[column.width]), 0);
  const tableWidth = Math.max(tableFrameWidth, fixedWidth + dataWidth);
  const displayedWidth = (column: CandidateColumn) => layout.width(column.id, columnWidths[column.width]) * (tableWidth - fixedWidth) / dataWidth;

  function toggleColumn(column: ColumnId) {
    const next = visibleColumns.includes(column)
      ? visibleColumns.filter((item: ColumnId) => item !== column)
      : [...visibleColumns, column];
    const serialized = JSON.stringify({ visible: next, order: orderedColumns });
    localStorage.setItem(columnStorageKey, serialized);
    setColumnPreference({ scope: columnStorageKey, value: serialized });
  }
  function moveColumn(column: ColumnId, direction: -1 | 1) {
    const index = orderedColumns.indexOf(column);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= orderedColumns.length) return;
    const next = [...orderedColumns];
    [next[index], next[target]] = [next[target], next[index]];
    const serialized = JSON.stringify({ visible: visibleColumns, order: next });
    localStorage.setItem(columnStorageKey, serialized);
    setColumnPreference({ scope: columnStorageKey, value: serialized });
  }
  function resetColumns() {
    localStorage.removeItem(columnStorageKey);
    setColumnPreference({ scope: columnStorageKey, value: "" });
    layout.reset();
  }

  // Every tab's rows are fetched before they are asked for, which is what
  // makes moving between stages immediate. It also means a stage you have not
  // opened yet can be holding the role as it was before you rated or rejected
  // somebody. router.refresh() only clears the page you are standing on, so
  // each change bumps this instead: it rides along in the other tabs' links,
  // and a link nobody has fetched cannot answer from a cache.
  const [dataVersion, setDataVersion] = useState(0);
  function refresh() {
    setDataVersion((version) => version + 1);
    router.refresh();
  }
  const tabUrl = (key: Tab) => {
    const p = new URLSearchParams(params);
    p.set("stage", key);
    p.delete("page");
    if (dataVersion) p.set("v", String(dataVersion));
    return `${path}?${p}`;
  };
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
  // Resume straight from the grid. A hidden input is reused for every row
  // rather than one per row: the file dialog is modal, so only one can ever
  // be open, and the row it belongs to is remembered while it is.
  function chooseResume(candidateId: string) {
    resumeForRef.current = candidateId;
    resumeInput.current?.click();
  }
  async function uploadResume(file: File) {
    const candidateId = resumeForRef.current;
    if (!candidateId) return;
    setResumeBusyId(candidateId);
    setError("");
    try {
      const form = new FormData();
      form.set("candidateId", candidateId);
      form.set("file", file);
      const response = await fetch("/api/resume", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not upload the resume.");
      setMessage("Resume uploaded.");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResumeBusyId(null);
      resumeForRef.current = null;
    }
  }
  async function openResume(candidateId: string) {
    setResumeBusyId(candidateId);
    setError("");
    try {
      const response = await fetch(`/api/resume?candidateId=${candidateId}`);
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not open the resume.");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResumeBusyId(null);
    }
  }
  // One renderer for all three groups, so an entry, a flow step and the exit
  // cannot drift apart in behaviour just because they are drawn differently.
  function stageTab(key: Tab, label: string, extra = "") {
    const loading = navigatingTo === key && tab !== key;
    return (
      <Link
        key={key}
        className={`stage-tab stage-${key}${extra ? ` ${extra}` : ""}${tab === key ? " selected" : ""}${loading ? " is-loading" : ""}`}
        href={tabUrl(key)}
        // These six are the navigation of this screen and all of them are on
        // it at once, so each one's rows are fetched up front rather than on a
        // hover a keyboard or a touch never sends. Without `true` a stage is
        // prefetched only as far as its loading skeleton, which is the part
        // nobody is waiting for.
        prefetch
        onClick={() => startTabNavigation(key)}
        aria-busy={loading}
        aria-current={tab === key ? "page" : undefined}
      >
        {label}
        {/* All profiles spans every stage, so it counts the whole role. */}
        <span>{key === "all_profiles" ? roleTotal : counts[key] ?? 0}</span>
      </Link>
    );
  }
  // Blank rows wait at the bottom of the grid the way they do in a spreadsheet.
  // A row turns into a real candidate as soon as it has a name and a LinkedIn
  // profile; until then it is local and costs nothing.
  // The ref is the source of truth rather than the state: a pasted block
  // commits many cells at once, and each one has to see what the previous cell
  // just wrote instead of the state from the last render.
  const draftsRef = useRef(drafts);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setDraftValue(key: string, columnId: string, value: string) {
    const next = draftsRef.current.map((row) =>
      row.key === key
        ? { ...row, values: { ...row.values, [columnId]: value } }
        : row,
    );
    // Always leave one untouched row to type into.
    draftsRef.current = next.some(isDraftEmpty) ? next : [...next, newDraft()];
    setDrafts(draftsRef.current);
    // Coalesce, so filling a row cell by cell. or pasting twenty. becomes a
    // single import rather than one per keystroke.
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flushDrafts(), 400);
  }

  async function flushDrafts() {
    const ready = draftsRef.current.filter(
      (row) => isDraftReady(row) && !creatingDrafts.current.has(row.key),
    );
    if (!ready.length) return;
    ready.forEach((row) => creatingDrafts.current.add(row.key));
    try {
      const summary = await act<ImportSummary>("importCandidates", {
        clientId: client.id,
        roleId: role.id,
        source: defaultCandidateSource,
        stage: "all_profiles",
        rows: ready.map(draftImportRow),
      });
      const addedKeys = new Set(ready.map((row) => row.key));
      const remaining = draftsRef.current.filter((row) => !addedKeys.has(row.key));
      draftsRef.current = remaining.some(isDraftEmpty)
        ? remaining
        : [...remaining, newDraft()];
      setDrafts(draftsRef.current);
      const parts = [
        summary.created ? `${summary.created} added` : "",
        summary.matchedExisting
          ? `${summary.matchedExisting} matched an existing candidate`
          : "",
        summary.alreadyInRole ? `${summary.alreadyInRole} already in this role` : "",
        summary.invalid ? `${summary.invalid} could not be read` : "",
        // Matched on an email or a Naukri id rather than a profile URL, so
        // nothing was written: that match is not proof of the same person.
        summary.flagged
          ? `${summary.flagged} matched someone already on file by email or Naukri id, not by LinkedIn URL — left for you to check`
          : "",
      ].filter(Boolean);
      setMessage(parts.join(" · ") || "Nothing to add.");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      ready.forEach((row) => creatingDrafts.current.delete(row.key));
    }
  }

  // Paste a block copied out of Google Sheets or Excel. Both put tab-separated
  // rows on the clipboard, so the grid fills right and down from the selected
  // cell the way a spreadsheet does, skipping anything read-only.
  async function pasteIntoGrid(event: React.ClipboardEvent<HTMLTableElement>) {
    const target = event.target as HTMLElement;
    // While a cell is being edited its own editor handles the paste.
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    const active =
      target.closest<HTMLElement>("[data-sheet-cell]") ??
      (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>(
        "[data-sheet-cell]",
      ) ??
      null;
    if (!active) return;
    const block = parsePastedBlock(event.clipboardData.getData("text/plain"));
    if (!block.length || isSingleValue(block)) return;
    event.preventDefault();
    const grid = active.closest("[data-sheet-grid]");
    if (!grid) return;
    const startRow = Number(active.dataset.row);
    const rowCells = (row: number) =>
      [...grid.querySelectorAll<SheetCellNode>(`[data-sheet-cell][data-row="${row}"]`)]
        .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col));
    const startColumn = rowCells(startRow).indexOf(active as SheetCellNode);
    const writes: { node: SheetCellNode; value: string }[] = [];
    let skipped = 0;
    block.forEach((line, rowOffset) => {
      const cells = rowCells(startRow + rowOffset);
      if (!cells.length) {
        skipped += 1;
        return;
      }
      line.forEach((value, columnOffset) => {
        const node = cells[startColumn + columnOffset];
        if (node?.__sheetCommit) writes.push({ node, value });
      });
    });
    if (!writes.length) {
      setError("That paste did not line up with any editable column.");
      return;
    }
    setError("");
    setMessage(`Pasting ${writes.length} cells…`);
    // A wide paste is a lot of single-field saves; a small window keeps the
    // API responsive without dropping any of them.
    const failures: string[] = [];
    for (let index = 0; index < writes.length; index += 6) {
      await Promise.all(
        writes.slice(index, index + 6).map(async ({ node, value }) => {
          try {
            await node.__sheetCommit?.(value);
          } catch (e) {
            failures.push((e as Error).message);
          }
        }),
      );
    }
    const pastedRows = block.length - skipped;
    setMessage(
      [
        `Pasted ${writes.length} cells across ${pastedRows} row${pastedRows === 1 ? "" : "s"}.`,
        skipped ? `${skipped} row${skipped === 1 ? "" : "s"} had no matching row in this tab. Add those candidates first.` : "",
        failures.length ? `${failures.length} cells could not be saved.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    refresh();
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
    const pinnedClass = column.id === pinnedColumnId ? " sheet-td-pinned" : "";
    const cell = (
      props: Partial<Parameters<typeof SheetCell>[0]> & {
        value: string;
        save: (value: string) => Promise<void>;
      },
    ) => (
      <td
        className={`sheet-td w-${column.width}${pinnedClass}${column.numeric ? " is-numeric" : ""}`}
        key={column.id}
      >
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
          value: candidateSourceLabel(rc.source),
          save: async () => {},
        });
      case "status":
        // Where this person currently sits. All profiles spans every stage,
        // so without this the list gives no way to tell who has been moved on.
        return (
          <td className={`sheet-td w-${column.width}${pinnedClass}`} key={column.id}>
            <span
              className={`sheet-cell is-readonly candidate-stage-cell stage-${rc.stage}`}
            >
              {isStage(rc.stage) ? stageLabels[rc.stage] : rc.stage}
            </span>
          </td>
        );
      case "linkedin": {
        const url = linkedInUrl(rc.candidates);
        return (
          <td
            className={`sheet-td w-${column.width}${pinnedClass} candidate-linkedin-cell`}
            key={column.id}
          >
            <div className="candidate-profile-cell">
              <SheetCell row={rowIndex} col={colIndex} label={`LinkedIn, row ${rowIndex + 1}`} value={url ?? ""} display={shortProfileUrl} placeholder="Add LinkedIn URL" readOnly={locked}
                save={async (value) => { await act("candidateLinkedIn", { id: rc.candidate_id, value }); refresh(); }} />
              {url && <a className="candidate-link" href={url} rel="noreferrer" target="_blank" aria-label={`Open ${rc.candidates.full_name} on LinkedIn`}><ExternalLink size={14} /></a>}
            </div>
          </td>
        );
      }
      case "resume":
        return (
          <td className={`sheet-td w-${column.width}`} key={column.id}>
            <button
              className="sheet-link-button"
              disabled={locked || resumeBusyId === rc.candidate_id}
              onClick={() =>
                rc.candidates.resume_path
                  ? void openResume(rc.candidate_id)
                  : chooseResume(rc.candidate_id)
              }
              title={
                rc.candidates.resume_path
                  ? "Open the resume on file"
                  : "Choose a PDF or Word document to upload"
              }
              type="button"
            >
              {resumeBusyId === rc.candidate_id
                ? "Working…"
                : rc.candidates.resume_path
                  ? "View"
                  : "Upload"}
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
            refresh();
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
          // The column is shown everywhere, like every other one. The dropdown
          // is only live where recording an outcome can actually succeed:
          // record_outcome requires Offer sent, so anywhere else this would be
          // a control that fails every time it is used.
          readOnly: locked || rc.stage !== "offer_sent",
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
            refresh();
          },
        });
      case "offer_details":
        return (
          <td
            className={`sheet-td w-${column.width} offer-details-cell`}
            key={column.id}
          >
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
      // Grouped to read, stored bare. A cell opened for editing shows the ten
      // digits, which is what a save sends and what the column holds.
      case "phone":
        return cell({
          value: rc.candidates.phone ?? "",
          display: formatMobile,
          save: (next) =>
            act("candidateField", { id: rc.candidate_id, field: "phone", value: next }),
        });
      case "alternate_phone":
        return cell({
          value: rc.candidates.alternate_phone ?? "",
          display: formatMobile,
          save: (next) =>
            act("candidateField", {
              id: rc.candidate_id,
              field: "alternate_phone",
              value: next,
            }),
        });
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

  // Everything the current stage and filters match, up to what one bulk edit
  // can take. Fetched rather than guessed: the page only holds fifty ids.
  async function selectAllMatching() {
    if (!isStage(tab)) return;
    setSelectingAll(true);
    setError("");
    try {
      const filters: Record<string, string> = {};
      for (const key of ["q", "source", "rating", "entered_from", "entered_to", "sort"]) {
        const value = params.get(key);
        if (value) filters[key] = value;
      }
      const ids = await act<string[]>("roleCandidateIds", {
        clientId: client.id,
        roleId: role.id,
        stage: tab,
        filters,
      });
      setSelected(ids);
      if (ids.length < total)
        setMessage(`Selected the first ${ids.length} of ${total}. Edit these, then select again for the rest.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSelectingAll(false);
    }
  }
  function summarize(summary: ImportSummary) {
    setImporting(false);
    const parts = [
      summary.created && `${summary.created} added`,
      summary.matchedExisting &&
        `${summary.matchedExisting} matched an existing candidate`,
      summary.alreadyInRole && `${summary.alreadyInRole} already in this role`,
      // Worth its own clause: a rating is the one imported value that can move
      // somebody, so it should not arrive silently.
      summary.rated && `${summary.rated} rated`,
      summary.updated && `${summary.updated} updated`,
      summary.skipped &&
        `${summary.skipped} skipped, not on this role yet — add them from All profiles`,
      summary.invalid && `${summary.invalid} skipped as invalid`,
    ].filter(Boolean);
    // Only a profile URL is taken as proof that two rows are one person. A row
    // that matched on an email or a Naukri id instead was not written, and is
    // named here rather than merged quietly into somebody else's record.
    const flagged = summary.flaggedRows ?? [];
    const named = flagged.slice(0, 3).map((row) => row.name).join(", ");
    const rest = summary.flagged - Math.min(flagged.length, 3);
    const notice = summary.flagged
      ? ` ${summary.flagged} row${summary.flagged === 1 ? "" : "s"} matched someone already on file by email or Naukri id, not by LinkedIn URL, so ${summary.flagged === 1 ? "it was" : "they were"} left for you to check: ${named}${rest > 0 ? ` and ${rest} more` : ""}.`
      : "";
    setMessage((parts.length ? parts.join(", ") + "." : "Nothing to import.") + notice);
    refresh();
  }
  async function toggleArchive() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await act("archiveRole", { id: role.id, archived: !role.archived });
      refresh();
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
      refresh();
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
      refresh();
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
    // Only the people not already on the role; the rest of the selection is
    // there for the Remove button.
    if (busy || !masterToAdd.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await act<{ added: number; alreadyInRole: number }>(
        "addExistingCandidates",
        { clientId: client.id, roleId: role.id, candidateIds: masterToAdd },
      );
      setMasterSelected([]);
      setMessage(
        result.added
          ? `${result.added} candidate${result.added === 1 ? "" : "s"} added to All profiles.`
          : "Those candidates are already in this role.",
      );
      refresh();
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
      refresh();
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
      refresh();
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
    <div className={styles.workspace} data-density={layout.compact ? "compact" : "comfortable"} data-expanded={expanded}>
      <header className="page-header role-workspace-header">
        <div>
          <div className="role-title-row">
            {/* A client with one open role opens straight into it, so this is
                the only way back out. list=1 asks for the roles list itself
                rather than being forwarded back in here. */}
            <Link className="role-back" href={`/clients/${client.id}/roles?list=1`}>
              <ArrowLeft size={15} aria-hidden="true" />
              <span>{client.name}</span>
            </Link>
            <h1>{role.name}</h1>
            <span className={`badge ${role.status}`}>{role.status.replace("_", " ")}</span>
            {/* The whole-role picture belongs with the whole-role list. On a
                stage tab it describes something other than what is on screen,
                and the tab counts already say where everyone is.

                It sits on the title line rather than under it so that hiding
                it does not change the header's height: the grid would jump
                every time you moved between All profiles and a stage. */}
            {tab === "all_profiles" && (
              <div className="role-summary" aria-label="Role summary">
                <span><strong>{pipelineTotal}</strong> active</span>
                <span><strong>{counts.all_profiles ?? 0}</strong> awaiting rating</span>
                <span>Rating threshold <strong>{role.rating_threshold} / 5</strong></span>
                <span><strong>{counts.rejected ?? 0}</strong> rejected</span>
              </div>
            )}
          </div>
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
      <input
        ref={resumeInput}
        className="visually-hidden"
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared before awaiting, so picking the same file twice in a row
          // still fires a change event the second time.
          event.target.value = "";
          if (file) void uploadResume(file);
        }}
      />
      {(error || message) && (
        <div className="toast-stack">
          {error && (
            <p className="toast error" role="alert">
              {error}
              <button aria-label="Dismiss" onClick={() => setError("")} type="button">
                <X size={14} />
              </button>
            </p>
          )}
          {message && (
            <p className="toast success" role="status">
              {message}
            </p>
          )}
        </div>
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
      <section className={styles.tablePanel} aria-label="Candidate workspace">
      <div className="role-tab-bar">
      <div className="role-stage-tabs" aria-label="Candidate stages">
        {stageTab("all_profiles", "All profiles", "stage-entry")}
        <span className="stage-rail-divider" aria-hidden="true" />
        <div className="stage-flow" role="group" aria-label="Pipeline stages">
          {flowStages.map((key, index) => (
            <Fragment key={key}>
              {index > 0 && (
                <ChevronRight className="stage-flow-arrow" size={14} aria-hidden="true" />
              )}
              {stageTab(key, stageLabels[key])}
            </Fragment>
          ))}
        </div>
        <span className="stage-rail-divider" aria-hidden="true" />
        {stageTab("rejected", "Rejects", "stage-exit")}
      </div>
      <nav className="role-secondary-nav" aria-label="Role tools">
        <RoleToolsMenu label={isFollowUpsTab ? "Views · Follow-ups" : tab === "master_db" ? "Views · Master DB" : tab === "analytics" ? "Views · Analytics" : "Views"} active={!isStage(tab)}>
        <Link className={isFollowUpsTab ? "selected" : ""} aria-current={isFollowUpsTab ? "page" : undefined} href={tabUrl("follow_ups")}>
          Follow-ups
        </Link>
        <Link className={tab === "master_db" ? "selected" : ""} aria-current={tab === "master_db" ? "page" : undefined} href={tabUrl("master_db")}>
          Master DB
        </Link>
        <Link className={tab === "analytics" ? "selected" : ""} aria-current={tab === "analytics" ? "page" : undefined} href={tabUrl("analytics")}>
          Analytics
        </Link>
        </RoleToolsMenu>
        <RoleToolsMenu label="Actions">
        <button type="button" onClick={() => setShowHistory(true)}>Edit history</button>
        <button type="button" onClick={() => setShowDuplicates(true)}>Duplicate review</button>
        {isOwner && <button type="button" onClick={() => setShowDeleted(true)}><Trash2 size={14} /> Recently deleted</button>}
        <button type="button" aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{expanded ? "Show page navigation" : "Full screen"}
        </button>
        </RoleToolsMenu>
      </nav>
      </div>
      {canSelectCandidates && selected.length > 0 && (
        <div className="bulk-bar">
          <strong>{selected.length} selected</strong>
          {/* The page is fifty rows; the mistake worth fixing is usually a
              whole import. This selects everything the current filter shows,
              not just what is on screen. */}
          {total > selected.length && (
            <button type="button" disabled={selectingAll} onClick={() => void selectAllMatching()}>
              {selectingAll ? "Selecting…" : `Select all ${total}`}
            </button>
          )}
          <button type="button" disabled={busy || role.archived} onClick={() => setBulkEditing([...selected])}>Bulk edit</button>
          {canDeleteRows && <button type="button" disabled={busy || role.archived} onClick={() => setDeleting([...selected])}><Trash2 size={15} /> Delete from role</button>}
          <button type="button" onClick={() => setSelected([])}>Clear selection</button>
          {showRowActions && <>
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
          </>}
        </div>
      )}
      {isStage(tab) && (
        <div className="sheet-bar">
        <form
          className="sheet-toolbar candidate-search candidate-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            router.push(
              stageFilterUrl({
                q: String(form.get("q") ?? ""),
                source: String(form.get("source") ?? ""),
                // Cleared alongside: one source, so nothing to narrow within it.
                source_detail: "",
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
            <select
              className="candidate-source-filter"
              aria-label="Filter candidates by source"
              name="source"
              defaultValue={params.get("source") ?? ""}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="">All sources</option>
              {candidateSources.map((source) => (
                <option key={source} value={source}>
                  {candidateSourceLabels[source]}
                </option>
              ))}
            </select>
            <details
              className="candidate-filter-menu"
              ref={filterMenu}
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
            <div className="candidate-column-menu" ref={columnMenu}>
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
            <button type="button" aria-label="Compact rows" aria-pressed={layout.compact} onClick={layout.toggleDensity}>
              <Rows3 size={15} aria-hidden="true" />
              {layout.compact ? "Compact" : "Comfortable"}
            </button>
          </div>
        </form>
        <div className="sheet-bar-actions">
          <span className="role-table-count">
            {total} candidate{total === 1 ? "" : "s"}
          </span>
          <button
            disabled={!total || exporting}
            onClick={() => void exportCandidates()}
          >
            {exporting ? "Preparing…" : "Export CSV"}
          </button>
          {tab === "recruiter_shortlisted" && (
            <button onClick={() => setManagingFields(true)}>Manage columns</button>
          )}
          {tab === "recruiter_shortlisted" && (
            <>
              <button onClick={() => setSharing("client")}>Manage links</button>
              <button
                className="primary"
                disabled={!total || role.archived}
                onClick={() => setSharing("client")}
              >
                <LinkIcon size={15} />
                Share with client
              </button>
            </>
          )}
          {tab === "all_profiles" && !role.archived && (
            <button onClick={() => setApplying(true)}>
              <SlidersHorizontal size={15} />
              Apply threshold
            </button>
          )}
        </div>
        </div>
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
                  <th><input type="checkbox" aria-label="Select all visible candidates" checked={roleCandidates.length > 0 && selected.length === roleCandidates.length} onChange={(e) => setSelected(e.target.checked ? roleCandidates.map((rc) => rc.id) : [])} /></th>
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
                  <tr key={rc.id} className={selected.includes(rc.id) ? "selected-row" : ""}>
                    <td><input type="checkbox" aria-label={`Select ${rc.candidates.full_name}`} checked={selected.includes(rc.id)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, rc.id] : old.filter((id) => id !== rc.id))} /></td>
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
                        {candidateSourceLabel(rc.source)}
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
                      ) : "Not provided"}
                    </td>
                    <td>
                      {isStage(rc.stage) ? stageLabels[rc.stage] : rc.stage}
                    </td>
                    <td>{rc.candidates.current_company || "Not provided"}</td>
                    <td>{rc.candidates.phone || rc.candidates.email || "Not provided"}</td>
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
              <p className="muted">
                Everyone this agency has ever sourced. Add them to this role, or take
                them off it.
              </p>
            </div>
            {!role.archived && (masterToAdd.length > 0 || masterToRemove.length > 0) && (
              <div className="row">
                {masterToAdd.length > 0 && (
                  <button
                    className="primary small"
                    disabled={busy}
                    onClick={() => void addSelectedFromMasterDb()}
                  >
                    Add {masterToAdd.length} to role
                  </button>
                )}
                {isOwner && masterToRemove.length > 0 && (
                  <button
                    className="small"
                    disabled={busy}
                    onClick={() => setDeleting(masterToRemove.map((m) => m.id))}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Remove {masterToRemove.length} from role
                  </button>
                )}
                <button className="small" disabled={busy} onClick={() => setMasterSelected([])}>
                  Clear
                </button>
              </div>
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
          <div className="card table-wrap sheet-table-frame master-frame">
            <table className="sheet-table master-table">
              <colgroup>
                <col style={{ width: 36 }} />
                <col style={{ width: 240 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 170 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 110 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="select-cell" scope="col">
                    <input
                      aria-label="Select every candidate on this page"
                      type="checkbox"
                      disabled={busy || role.archived || !masterCandidates.length}
                      checked={
                        masterCandidates.length > 0 &&
                        masterSelected.length === masterCandidates.length
                      }
                      onChange={(event) =>
                        setMasterSelected(
                          event.target.checked
                            ? masterCandidates.map((candidate) => candidate.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th scope="col">Full name</th>
                  <th scope="col">On this role</th>
                  <th className="candidate-linkedin-heading" scope="col">LinkedIn</th>
                  <th scope="col">Headline</th>
                  <th scope="col">Company</th>
                  <th scope="col">Location</th>
                  <th scope="col">Exp</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Added</th>
                </tr>
              </thead>
              <tbody>
                {masterCandidates.map((c) => (
                  <tr key={c.id}>
                    <td className="select-cell">
                      <input
                        aria-label={
                          masterMembershipByCandidate.has(c.id)
                            ? `Select ${c.full_name}, already on this role`
                            : `Select ${c.full_name} to add to this role`
                        }
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
                    </td>
                    <td className="strong" title={c.full_name}>{c.full_name}</td>
                    <td>
                      {masterMembershipByCandidate.has(c.id) ? (
                        <span className="badge accepted">
                          {stageLabels[masterMembershipByCandidate.get(c.id)!.stage as Stage] ??
                            "On this role"}
                        </span>
                      ) : (
                        <span className="muted">Not yet</span>
                      )}
                    </td>
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
                      ) : "Not provided"}
                    </td>
                    <td title={c.headline ?? ""}>{c.headline || "—"}</td>
                    <td title={c.current_company ?? ""}>{c.current_company || "—"}</td>
                    <td title={c.location ?? ""}>{c.location || "—"}</td>
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
          <div className="table-edit-hint">Click a cell to edit · Enter, Tab or click away to save · Esc to cancel. Added date and source are system managed.</div>
          <div className="card table-wrap sheet-table-frame" ref={tableFrame}>
            <table
              className={`candidate-table sheet-table${canSelectCandidates ? " has-select" : ""}`}
              data-sheet-grid=""
              style={{ width: tableWidth, minWidth: fixedWidth + dataWidth }}
              onPaste={(event) => void pasteIntoGrid(event)}
              role="grid"
            >
              <colgroup>
                {canSelectCandidates && <col style={{ width: 36 }} />}
                <col style={{ width: 36 }} />
                <col style={{ width: 28 }} />
                {showNameColumn && <col style={{ width: nameWidth }} />}
                {visibleCandidateColumns.map((column) => (
                  <col key={column.id} style={{ width: displayedWidth(column) }} />
                ))}
                {showRowActions && <col style={{ width: actionWidth }} />}
              </colgroup>
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
                <th className="sheet-serial-heading" scope="col">
                  <span className="sr-only">Row</span>
                </th>
                <th className="candidate-open-heading" scope="col">
                  <span className="sr-only">Open candidate</span>
                </th>
                {showNameColumn && (
                  <th className="sheet-th sheet-th-pinned" scope="col">
                    Full name
                    <ColumnResizeHandle label="Full name" width={nameWidth} onResize={(width) => layout.resize("full_name", Math.max(180, width))} />
                  </th>
                )}
                {visibleCandidateColumns.map((column) => (
                  <th
                    className={`sheet-th w-${column.width}${column.id === pinnedColumnId ? " sheet-th-pinned" : ""}${column.numeric ? " is-numeric" : ""}`}
                    key={column.id}
                    scope="col"
                  >
                    {column.label}
                    <ColumnResizeHandle label={column.label} width={layout.width(column.id, columnWidths[column.width])} onResize={(width) => layout.resize(column.id, width)} />
                  </th>
                ))}
                {showRowActions && <th className="candidate-action-heading" scope="col">Action</th>}
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
                  <td className="sheet-serial">{(page - 1) * 50 + rowIndex + 1}</td>
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
                  {showNameColumn && (
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
                  )}
                  {visibleCandidateColumns.map((column, columnIndex) =>
                    renderCandidateCell(rc, column, rowIndex, columnIndex + firstDataColumn),
                  )}
                  {showRowActions && (
                    <td className="candidate-action-cell">
                      <div className="candidate-row-actions">
                        {advanceTo && (
                          <button
                            className="small primary"
                            disabled={busy || Boolean(movingCandidateId) || role.archived}
                            onClick={() => void moveCandidateToNextStage(rc)}
                            title={`Move to ${stageLabels[advanceTo]}`}
                          >
                            {movingCandidateId === rc.id ? "Moving…" : "Advance"}
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
                        {canDeleteRows && (
                          <button
                            className="small candidate-delete-button"
                            aria-label={`Delete ${rc.candidates.full_name} from this role`}
                            title="Delete from this role"
                            disabled={busy || Boolean(movingCandidateId)}
                            onClick={() => setDeleting([rc.id])}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                );
              })}
              {/* All profiles is the only stage that admits somebody new, so
                  the blank row to type into only belongs there. Later stages
                  are edited in place. */}
              {!role.archived &&
                tab === "all_profiles" &&
                drafts.map((draft, draftIndex) => {
                  const rowIndex = roleCandidates.length + draftIndex;
                  const blocker = draftBlocker(draft);
                  return (
                    <tr className="sheet-draft-row" key={draft.key}>
                      {canSelectCandidates && <td className="select-cell" />}
                      <td className="sheet-serial sheet-serial-draft">
                        {(page - 1) * 50 + rowIndex + 1}
                      </td>
                      <td className="candidate-open-cell">
                        <span className="sheet-draft-marker" aria-hidden="true">
                          +
                        </span>
                      </td>
                      {showNameColumn && (
                        <td className="sheet-td sheet-td-pinned">
                          <SheetCell
                            col={0}
                            label={`New candidate name, row ${rowIndex + 1}`}
                            placeholder="Add a candidate…"
                            row={rowIndex}
                            save={async (value) =>
                              setDraftValue(draft.key, "full_name", value)
                            }
                            value={draft.values.full_name ?? ""}
                          />
                        </td>
                      )}
                      {visibleCandidateColumns.map((column, columnIndex) => {
                        const editable = isDraftColumnEditable(column.id);
                        return (
                          <td
                            className={`sheet-td w-${column.width}${column.id === pinnedColumnId ? " sheet-td-pinned" : ""}`}
                            key={column.id}
                          >
                            {editable ? (
                              <SheetCell
                                col={columnIndex + firstDataColumn}
                                kind={column.id === "linkedin" ? "text" : column.kind}
                                label={`New candidate ${column.label.toLowerCase()}, row ${rowIndex + 1}`}
                                placeholder={
                                  column.id === "linkedin"
                                    ? "linkedin.com/in/…"
                                    : column.placeholder
                                }
                                row={rowIndex}
                                save={async (value) =>
                                  setDraftValue(draft.key, column.id, value)
                                }
                                value={draft.values[column.id] ?? ""}
                              />
                            ) : (
                              <span className="sheet-cell is-readonly is-empty" />
                            )}
                          </td>
                        );
                      })}
                      {showRowActions && (
                        <td className="candidate-action-cell">
                          {blocker && <span className="sheet-draft-hint">{blocker}</span>}
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
      </section>
      {bulkEditing && <BulkEditDialog clientId={client.id} roleId={role.id} roleName={role.name} ids={bulkEditing} stage={isStage(tab) && tab !== "all_profiles" ? tab : null} fields={roleFields} onClose={() => setBulkEditing(null)} onSaved={(count) => { setBulkEditing(null); setSelected([]); setMessage(`Updated ${count} rows. Changes are recorded in Edit history.`); refresh(); }} />}
      {showHistory && <EditHistoryDialog clientId={client.id} roleId={role.id} onClose={() => setShowHistory(false)} />}
      {showDuplicates && <DuplicateReview clientId={client.id} roleId={role.id} onClose={() => setShowDuplicates(false)} />}
      {showDeleted && <DeletedCandidates clientId={client.id} roleId={role.id} archived={role.archived} onClose={() => setShowDeleted(false)} onRestored={() => refresh()} />}
      {deleting && <TableDialog titleId="delete-rows-title" busy={busy} onClose={() => setDeleting(null)}>
        <div className="modal-heading"><h2 id="delete-rows-title">Delete {deleting.length} selected row{deleting.length === 1 ? "" : "s"} from this role?</h2></div>
        <p>These rows will leave <strong>{role.name}</strong>. Shared candidate profiles and other roles are kept. You can restore this batch with its notes and history from Recently deleted.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row"><button disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try {
            await act("removeRoleCandidates", { clientId: client.id, roleId: role.id, ids: deleting, stage: isStage(tab) ? tab : null });
            setSelected([]); setMasterSelected([]); setDeleting(null);
            setMessage("Rows deleted from this role. Restore them from Recently deleted.");
            refresh();
          } catch (e) { setError((e as Error).message); }
          finally { setBusy(false); }
        }}>{busy ? "Deleting…" : "Delete from role"}</button><button disabled={busy} onClick={() => setDeleting(null)}>Cancel</button></div>
      </TableDialog>}
      {editing && (
        <RoleFormDialog
          clientId={client.id}
          role={role}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
      {importing && (
        <AddCandidatesDialog
          clientId={client.id}
          roleId={role.id}
          roleName={role.name}
          stage={isStage(tab) && tab !== "rejected" ? tab : "all_profiles"}
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
            refresh();
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
              onChanged={() => refresh()}
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
          onChanged={() => refresh()}
        />
      )}
      {sharing && tab === "recruiter_shortlisted" && (
        <ShareDialog
          clientId={client.id}
          roleId={role.id}
          links={shareLinks}
          fields={roleFields}
          onClose={() => setSharing(null)}
          onChanged={() => refresh()}
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
    </div>
  );
}
