"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Archive,
  Briefcase,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Copy,
  Crosshair,
  ExternalLink,
  FileSearch,
  FolderOpen,
  Layers,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Users,
  X,
} from "lucide-react";
import { defaults, type CampaignConfig, type Query } from "@/lib/domain";
import type { Client, PageData, Run } from "@/lib/types";
import { ProspectSheet } from "./prospect-sheet";
import { ExcludedProfiles } from "./excluded-profiles";
import { RolesPage } from "./recruiting/roles";
import { RolePipeline } from "./recruiting/role-pipeline";

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
const statusNames: Record<string, string> = {
  rule_match: "Rule match",
  review: "Review",
  accepted: "Accepted",
  rejected: "Rejected",
  suppressed: "Suppressed",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
  pending: "Pending",
  retry_wait: "Retry scheduled",
  leased: "Searching",
  response_saved: "Saving results",
  succeeded: "Complete",
  skipped: "Skipped",
};
const date = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>{statusNames[status] ?? status}</span>
  );
}
function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <FileSearch size={25} />}</div>
      <h3>{title}</h3>
      <div className="muted">{children}</div>
    </div>
  );
}
function Header({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      <div className="header-actions">{actions}</div>
    </header>
  );
}
function Metrics({ data }: { data: PageData }) {
  return (
    <div className="metrics">
      {[
        [
          "Rule matches",
          data.counts?.rule_match ?? 0,
          "Evidence meets your rules",
        ],
        ["To review", data.counts?.review ?? 0, "Needs a closer look"],
        ["Accepted", data.counts?.accepted ?? 0, "Manually approved"],
        [
          "Suppressed",
          data.counts?.suppressed ?? 0,
          "Excluded for this client",
        ],
      ].map(([label, value, hint]) => (
        <div className="metric" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{hint}</small>
        </div>
      ))}
    </div>
  );
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <CircleHelp size={18} />
      <div>{children}</div>
    </div>
  );
}

function WorkspaceSearches({ data }: { data: PageData }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  const guard = useRef(false);
  const ids = (data.activeRuns ?? [])
    .filter((r) => r.status === "running")
    .map((r) => r.id)
    .join(",");
  useEffect(() => {
    if (!data.live || !ids) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const blocked = new Set<string>();
    const nextAt = new Map<string, number>();
    const queue = ids.split(",");
    let cursor = 0;
    let lastRefresh = 0;
    async function tick() {
      if (cancelled) return;
      if (document.hidden || guard.current) {
        timeout = setTimeout(tick, 1000);
        return;
      }
      const ready = queue.filter(
        (id) => !blocked.has(id) && (nextAt.get(id) ?? 0) <= Date.now(),
      );
      const batch = Array.from(
        { length: Math.min(3, ready.length) },
        (_, i) => ready[(cursor + i) % ready.length],
      );
      cursor += batch.length;
      guard.current = true;
      try {
        await Promise.all(
          batch.map(async (id) => {
            try {
              const result = await act<{ state: string; nextRetryAt?: string }>(
                "process",
                { runId: id },
              );
              if (
                ["completed", "cancelled", "failed", "paused"].includes(
                  result.state,
                )
              )
                blocked.add(id);
              if (result.nextRetryAt)
                nextAt.set(id, new Date(result.nextRetryAt).getTime());
            } catch (e) {
              blocked.add(id);
              if (!cancelled)
                setErrors((old) => ({ ...old, [id]: (e as Error).message }));
            }
          }),
        );
        if (
          !cancelled &&
          batch.length &&
          (Date.now() - lastRefresh > 10000 || blocked.size === queue.length)
        ) {
          lastRefresh = Date.now();
          router.refresh();
        }
      } finally {
        guard.current = false;
      }
      if (!cancelled) timeout = setTimeout(tick, 1500);
    }
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [ids, data.live, router, retry]);
  if (!data.activeRuns?.length) return null;
  return (
    <details
      className="workspace-searches"
      open={Object.keys(errors).length > 0 ? true : undefined}
    >
      <summary>
        <span className="row">
          <Search size={15} />
          {data.activeRuns.filter((r) => r.status === "running").length} running
          · {data.activeRuns.filter((r) => r.status === "paused").length} paused
        </span>
        <span>Searches continue while this workspace is open</span>
      </summary>
      <div className="active-search-grid">
        {data.activeRuns.map((r) => (
          <div className="active-search" key={r.id}>
            <Link className="strong" href={"/runs/" + r.id}>
              {data.campaigns.find((c) => c.id === r.campaign_id)?.name ??
                data.clients.find((c) => c.id === r.client_id)?.name ??
                "Campaign search"}
            </Link>
            <Badge status={r.status} />
            <small>
              {r.new_candidates} leads · {r.reserved}/{r.budget} requests
              reserved
            </small>
            {errors[r.id] && (
              <>
                <span role="alert" className="error">
                  {errors[r.id]}
                </span>
                <button
                  className="small"
                  onClick={() => {
                    setErrors({});
                    setRetry((v) => v + 1);
                  }}
                >
                  Retry connection
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <small>
        Up to 3 campaigns process together. Hidden or closed tabs stop new
        requests; in-flight requests may finish. Each search keeps its own
        limit.
      </small>
    </details>
  );
}

export function Workspace({ data }: { data: PageData }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [clientForm, setClientForm] = useState<Client | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const client = data.client;
  async function run(
    action: string,
    payload: unknown,
    success: string,
    destination?: string,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await act(action, payload);
      setMessage(success);
      if (destination === "campaign")
        router.push(`/campaigns/${result.id}/edit`);
      else if (destination) router.push(destination);
      else router.refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const actions = { run, busy, setError, setMessage };
  const clientLink = client ? `/clients/${client.id}` : "/clients";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/clients" className="brand">
          <Crosshair size={27} />
          <span>LeadScope</span>
          <span className="beta">BETA</span>
        </Link>
        <div className="workspace-label">AGENCY WORKSPACE</div>
        <label className="client-switch">
          <FolderOpen size={17} />
          <select
            aria-label="Switch client"
            value={client?.id ?? ""}
            onChange={(e) =>
              router.push(
                e.target.value ? `/clients/${e.target.value}` : "/clients",
              )
            }
          >
            <option value="">All clients</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
        <nav>
          <Link
            className={data.view === "clients" ? "active" : ""}
            href="/clients"
          >
            <Users size={18} />
            Clients
          </Link>
          {client && (
            <>
              <Link
                className={
                  ["client", "builder", "campaign", "runs"].includes(data.view)
                    ? "active"
                    : ""
                }
                href={clientLink}
              >
                <Layers size={18} />
                Campaigns
              </Link>
              <Link
                className={
                  ["leads", "lead"].includes(data.view) ? "active" : ""
                }
                href={`/leads?client=${client.id}`}
              >
                <FileSearch size={18} />
                Leads & review
              </Link>
              <Link
                className={
                  ["roles", "role"].includes(data.view) ? "active" : ""
                }
                href={`/clients/${client.id}/roles`}
              >
                <Briefcase size={18} />
                Roles
              </Link>
              <Link
                className={data.view === "settings" ? "active" : ""}
                href={`/settings?client=${client.id}`}
              >
                <Settings size={18} />
                Settings
              </Link>
              <Link
                className={data.view === "prospects" ? "active" : ""}
                href={`/clients/${client.id}/prospects`}
              >
                <CheckCheck size={18} />
                Prospect sheet
              </Link>
              <Link
                className={data.view === "excluded" ? "active" : ""}
                href={`/clients/${client.id}/excluded`}
              >
                <ShieldCheck size={18} />
                Excluded
              </Link>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <ShieldCheck size={19} />
            <span>
              Public search references.
              <br />
              Always human reviewed.
            </span>
          </div>
          <div className="operator">
            <span className="avatar">{data.email[0].toUpperCase()}</span>
            <div>
              <strong>Agency operator</strong>
              <small title={data.email}>{data.email}</small>
            </div>
            <form action="/auth/logout" method="post">
              <button aria-label="Sign out" title="Sign out">
                <LogOut size={16} />
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <span>
            {client ? (
              <>
                <Link href="/clients">Clients</Link>
                <span className="slash">/</span>
                {client.name}
              </>
            ) : (
              "Agency workspace"
            )}
          </span>
          <span className="live-indicator">
            <i className={data.live ? "on" : ""} />
            {data.live ? "Search connected" : "Search setup needed"}
          </span>
        </div>
        <div className="page-body">
          {client && (
            <nav className="client-tabs" aria-label="Client tabs">
              <Link
                className={
                  ["client", "campaign", "builder", "runs"].includes(data.view)
                    ? "active"
                    : ""
                }
                href={`/clients/${client.id}`}
              >
                Campaigns
              </Link>
              <Link
                className={
                  ["leads", "lead"].includes(data.view) ? "active" : ""
                }
                href={`/leads?client=${client.id}`}
              >
                Leads & review
              </Link>
              <Link
                className={
                  ["roles", "role"].includes(data.view) ? "active" : ""
                }
                href={`/clients/${client.id}/roles`}
              >
                Roles
              </Link>
              <Link
                className={data.view === "prospects" ? "active" : ""}
                href={`/clients/${client.id}/prospects`}
              >
                Prospect sheet
              </Link>
              <Link
                className={data.view === "excluded" ? "active" : ""}
                href={`/clients/${client.id}/excluded`}
              >
                Excluded
              </Link>
            </nav>
          )}
          <WorkspaceSearches data={data} />
          {error && (
            <div className="toast error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {message && (
            <div className="toast success" role="status">
              <Check size={16} />
              {message}
              <button
                aria-label="Dismiss notification"
                onClick={() => setMessage("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {data.view === "clients" && (
            <>
              <Header
                eyebrow="CLIENT DIRECTORY"
                title="A workspace for every client"
                description="Keep campaigns, evidence, and decisions in the right place."
                actions={
                  <button
                    className="primary"
                    onClick={() => setClientForm("new")}
                  >
                    <Plus size={17} />
                    New client
                  </button>
                }
              />
              <div className="section-heading">
                <h2>
                  Clients{" "}
                  <span className="count">
                    {
                      data.clients.filter((c) => showArchived || !c.archived)
                        .length
                    }
                  </span>
                </h2>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Include archived
                </label>
              </div>
              {!data.clients.length ? (
                <div className="card">
                  <Empty
                    icon={<FolderOpen size={28} />}
                    title="Your first client starts here"
                  >
                    <p>
                      Create a client workspace, then define who you’re looking
                      for.
                    </p>
                    <button
                      className="primary"
                      onClick={() => setClientForm("new")}
                    >
                      <Plus size={16} />
                      Create your first client
                    </button>
                  </Empty>
                </div>
              ) : (
                <div className="client-grid">
                  {data.clients
                    .filter((c) => showArchived || !c.archived)
                    .map((c) => (
                      <Link
                        href={`/clients/${c.id}`}
                        key={c.id}
                        className="card client-card"
                      >
                        <div className="client-card-top">
                          <span className="client-monogram">
                            {c.name.slice(0, 2).toUpperCase()}
                          </span>
                          {c.archived ? (
                            <Badge status="Archived" />
                          ) : (
                            <ArrowRight size={18} />
                          )}
                        </div>
                        <h3>{c.name}</h3>
                        <p className="muted">
                          {c.notes || "No client notes yet."}
                        </p>
                        <small>Created {date(c.created_at)}</small>
                      </Link>
                    ))}
                </div>
              )}
            </>
          )}
          {data.view === "client" && client && (
            <>
              <Header
                eyebrow="CLIENT WORKSPACE"
                title={client.name}
                description={
                  client.notes ||
                  "Run multiple campaigns here. Leads stay organized by campaign."
                }
                actions={
                  <>
                    <button onClick={() => setClientForm(client)}>
                      Edit client
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          "archive",
                          {
                            kind: "client",
                            id: client.id,
                            archived: !client.archived,
                          },
                          client.archived
                            ? "Client restored."
                            : "Client archived; unfinished runs paused.",
                        )
                      }
                    >
                      <Archive size={16} />
                      {client.archived ? "Restore" : "Archive"}
                    </button>
                    {!client.archived && (
                      <Link
                        className="button primary"
                        href={`/campaigns/new?client=${client.id}`}
                      >
                        <Plus size={16} />
                        New campaign
                      </Link>
                    )}
                  </>
                }
              />
              {client.archived && (
                <Notice>
                  This client is archived. Restore it to start or resume
                  searches. History remains available.
                </Notice>
              )}
              <Metrics data={data} />
              <div className="section-heading">
                <h2>
                  Campaigns{" "}
                  <span className="count">{data.campaigns.length}</span>
                </h2>
                <Link href={`/leads?client=${client.id}`}>
                  View all leads <ArrowRight size={15} />
                </Link>
              </div>
              <div className="card">
                {!data.campaigns.length ? (
                  <Empty title="Define your first audience">
                    <p>
                      Add locations, roles, and qualification criteria to create
                      a campaign.
                    </p>
                    {!client.archived && (
                      <Link
                        className="button primary"
                        href={`/campaigns/new?client=${client.id}`}
                      >
                        Create campaign <ArrowRight size={15} />
                      </Link>
                    )}
                  </Empty>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Campaign</th>
                          <th>Audience</th>
                          <th>Request budget</th>
                          <th>State</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.campaigns.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <Link
                                className="strong"
                                href={`/campaigns/${c.id}`}
                              >
                                {c.name}
                              </Link>
                            </td>
                            <td>
                              {c.config.locations.slice(0, 2).join(", ") ||
                                "Any location"}
                              <small>
                                {c.config.roles.slice(0, 2).join(", ") ||
                                  "Any role"}
                              </small>
                            </td>
                            <td>Up to {c.config.budget} / run</td>
                            <td>
                              <Badge
                                status={
                                  c.archived
                                    ? "Archived"
                                    : (data.activeRuns?.find(
                                        (r) => r.campaign_id === c.id,
                                      )?.status ?? "Ready")
                                }
                              />
                            </td>
                            <td>
                              <Link
                                aria-label={`Open ${c.name}`}
                                href={`/campaigns/${c.id}`}
                              >
                                <ArrowRight size={17} />
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <History runs={data.runs ?? []} />
            </>
          )}
          {data.view === "builder" && <Builder data={data} {...actions} />}
          {data.view === "campaign" && (
            <CampaignPage data={data} {...actions} />
          )}
          {data.view === "runs" && <RunPage data={data} {...actions} />}
          {data.view === "leads" && <LeadsPage data={data} {...actions} />}
          {data.view === "roles" && client && (
            <RolesPage client={client} roles={data.roles ?? []} />
          )}
          {data.view === "role" && client && data.role && (
            <RolePipeline
              client={client}
              role={data.role}
              roleCandidates={data.roleCandidates ?? []}
              counts={data.roleCandidateCounts ?? {}}
              masterCandidates={data.masterCandidates ?? []}
              total={data.total ?? 0}
              page={data.page ?? 1}
            />
          )}
          {data.view === "excluded" && <ExcludedProfiles data={data} />}
          {data.view === "prospects" && client && (
            <ProspectSheet
              rows={data.prospects ?? []}
              total={data.total ?? 0}
              page={data.page ?? 1}
              clientId={client.id}
              clientName={client.name}
            />
          )}
          {data.view === "lead" && <LeadDetail data={data} {...actions} />}
          {data.view === "settings" && (
            <SettingsPage data={data} {...actions} />
          )}
        </div>
      </main>
      {clientForm && (
        <dialog open className="modal">
          <div className="modal-heading">
            <h2>{clientForm === "new" ? "Create client" : "Edit client"}</h2>
            <button aria-label="Close" onClick={() => setClientForm(null)}>
              <X size={18} />
            </button>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const result = await run(
                "client",
                {
                  id: clientForm === "new" ? undefined : clientForm.id,
                  name: form.get("name"),
                  notes: form.get("notes"),
                },
                "Client saved.",
              );
              if (result) {
                setClientForm(null);
                router.push(`/clients/${result.id}`);
              }
            }}
          >
            <label>
              Client name
              <input
                name="name"
                required
                maxLength={120}
                autoFocus
                defaultValue={clientForm === "new" ? "" : clientForm.name}
              />
            </label>
            <label>
              Notes <span className="optional">optional</span>
              <textarea
                name="notes"
                rows={4}
                maxLength={4000}
                defaultValue={clientForm === "new" ? "" : clientForm.notes}
              />
            </label>
            <button disabled={busy} className="primary wide">
              {busy ? "Saving…" : "Save client"}
            </button>
          </form>
        </dialog>
      )}
    </div>
  );
}
type Actions = {
  run: (
    action: string,
    payload: unknown,
    success: string,
    destination?: string,
  ) => Promise<{ id: string } | undefined>;
  busy: boolean;
  setError: (s: string) => void;
  setMessage: (s: string) => void;
};
function History({ runs }: { runs: Run[] }) {
  const [status, setStatus] = useState("");
  return (
    <>
      <div className="section-heading">
        <h2>Search history</h2>
        <select
          aria-label="Filter search history"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All states</option>
          {["running", "paused", "completed", "cancelled", "failed"].map(
            (s) => (
              <option key={s} value={s}>
                {statusNames[s]}
              </option>
            ),
          )}
        </select>
      </div>
      <div className="card">
        {!runs.length ? (
          <Empty icon={<Search size={24} />} title="No searches yet">
            <p>Start a search to add leads here automatically.</p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Reserved / cap</th>
                  <th>Dispatched</th>
                  <th>New candidates</th>
                  <th>Rule matches</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs
                  .filter((r) => !status || r.status === status)
                  .map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/runs/${r.id}`}>{date(r.created_at)}</Link>
                      </td>
                      <td>
                        <Badge status={r.status} />
                      </td>
                      <td>
                        {r.reserved} / {r.budget}
                      </td>
                      <td>{r.dispatched}</td>
                      <td>{r.new_candidates}</td>
                      <td>{r.rule_matches}</td>
                      <td>
                        <Link href={`/runs/${r.id}`} aria-label="Open run">
                          <ArrowRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer muted">
          Most recent {runs.length} runs shown.
        </div>
      </div>
    </>
  );
}
function SearchSetupNotice({ clientId }: { clientId: string }) {
  return (
    <Notice>
      Search is not connected yet. You can save campaigns now.{" "}
      <Link className="strong" href={"/settings?client=" + clientId}>
        Open setup
      </Link>
    </Notice>
  );
}
function Builder({ data, setError }: { data: PageData } & Actions) {
  const router = useRouter();
  const c = data.campaign;
  const [name, setName] = useState(c?.name ?? "");
  const [config, setConfig] = useState<CampaignConfig>(
    c?.config ?? {
      ...defaults,
      queryCap: 4,
      pageCap: 1,
      budget: Math.min(4, data.serverCap ?? 50),
    },
  );
  const [queries, setQueries] = useState<Query[]>(data.queries ?? []);
  const [mode, setMode] = useState<"build" | "paste">(
    data.queries?.some((q) => q.strategy === "custom") ? "paste" : "build",
  );
  const [dirty, setDirty] = useState(false);
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const saved = useRef({ id: c?.id, revision: c?.revision, fingerprint: "" });
  const token = useRef(crypto.randomUUID());
  const guard = useRef(false);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const cleanConfig = () => ({
    ...config,
    ...Object.fromEntries(
      [
        "locations",
        "roles",
        "skills",
        "requiredKeywords",
        "queryExclusions",
        "leadExclusions",
      ].map((k) => [
        k,
        (config[k as keyof CampaignConfig] as string[])
          .map((v) => v.trim())
          .filter(Boolean),
      ]),
    ),
  });
  function update<K extends keyof CampaignConfig>(
    key: K,
    value: CampaignConfig[K],
  ) {
    setConfig((old) => ({ ...old, [key]: value }));
    setDirty(true);
    if (
      [
        "locations",
        "roles",
        "skills",
        "requiredKeywords",
        "includeRequired",
        "queryExclusions",
        "queryCap",
      ].includes(key) &&
      mode === "build"
    )
      setQueries((old) => old.filter((q) => q.strategy === "custom"));
  }
  async function generated() {
    const result = await act<{ queries: Query[]; warnings: string[] }>(
      "generate",
      cleanConfig(),
    );
    setQueries(result.queries);
    setWarnings(result.warnings);
    setDirty(true);
    return result.queries;
  }
  async function generate() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await generated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function save(start: boolean) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      let next = queries.filter(
        (q) => q.text.trim() && q.text.trim() !== "site:linkedin.com/in/",
      );
      if (!next.length && mode === "build") next = await generated();
      next = next.map((q) => ({
        ...q,
        text: /site:/i.test(q.text)
          ? q.text
          : "site:linkedin.com/in/ " + q.text,
      }));
      if (start && !next.some((q) => q.enabled))
        throw new Error("Add any search detail or paste a query to start.");
      const cleaned = cleanConfig();
      const title =
        name.trim() ||
        [
          ...cleaned.locations,
          ...cleaned.roles,
          ...cleaned.skills,
          ...cleaned.requiredKeywords,
        ]
          .slice(0, 3)
          .join(" · ")
          .slice(0, 120) ||
        "New campaign";
      const fingerprint = JSON.stringify({
        name: title,
        config: cleaned,
        queries: next,
        reset,
      });
      if (!saved.current.id || saved.current.fingerprint !== fingerprint) {
        const result = await act<{ id: string }>("campaign", {
          id: saved.current.id,
          clientId: data.client!.id,
          name: title,
          config: cleaned,
          queries: next,
          reset,
          expectedRevision: saved.current.revision,
        });
        saved.current = {
          id: result.id,
          revision: (saved.current.revision ?? 0) + 1,
          fingerprint,
        };
        token.current = crypto.randomUUID();
        setDirty(false);
        setName(title);
        setQueries(next);
      }
      if (start) {
        const cap = Math.min(
          cleaned.budget,
          data.serverCap ?? 50,
          next.filter((q) => q.enabled).length * cleaned.pageCap,
        );
        const result = await act<{ runId: string }>("start", {
          campaignId: saved.current.id,
          token: token.current,
          cap,
          revision: saved.current.revision,
        });
        router.push("/runs/" + result.runId);
      } else router.push("/campaigns/" + saved.current.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const fields = [
    { key: "locations", label: "Location", placeholder: "Any location" },
    { key: "roles", label: "Job titles", placeholder: "Any role" },
    { key: "skills", label: "Skills", placeholder: "Any skill" },
    { key: "requiredKeywords", label: "Keywords", placeholder: "Any keyword" },
  ] as const;
  const cap = Math.min(
    config.budget,
    data.serverCap ?? 50,
    (queries.filter((q) => q.enabled).length || config.queryCap) *
      config.pageCap,
  );
  return (
    <form
      className="simple-builder"
      onSubmit={(e) => {
        e.preventDefault();
        void save(true);
      }}
    >
      <Header
        eyebrow={data.client!.name}
        title={c ? "Edit campaign" : "New campaign"}
        description="Add whatever you know, or paste a search query. Everything else is optional."
        actions={
          <Link className="button" href={"/clients/" + data.client!.id}>
            All campaigns
          </Link>
        }
      />
      <section className="card compact-form">
        <div
          className="search-mode"
          role="group"
          aria-label="Query input method"
        >
          <button
            type="button"
            aria-pressed={mode === "build"}
            className={mode === "build" ? "selected" : ""}
            onClick={() => setMode("build")}
          >
            Build a query
          </button>
          <button
            type="button"
            aria-pressed={mode === "paste"}
            className={mode === "paste" ? "selected" : ""}
            onClick={() => {
              setMode("paste");
              if (!queries.length)
                setQueries([{ text: "", strategy: "custom", enabled: true }]);
            }}
          >
            Paste a query
          </button>
        </div>
        {mode === "build" ? (
          <>
            <div className="form-grid">
              {fields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <textarea
                    rows={2}
                    placeholder={field.placeholder}
                    value={config[field.key].join("\n")}
                    onChange={(e) =>
                      update(field.key, e.target.value.split("\n"))
                    }
                  />
                  <small>Optional · one per line</small>
                </label>
              ))}
            </div>
            <button type="button" onClick={generate} disabled={busy}>
              <RefreshCw size={15} />
              {busy
                ? "Working…"
                : queries.length
                  ? "Regenerate queries"
                  : "Generate query"}
            </button>
          </>
        ) : (
          <p className="muted">
            Paste your query below. We add the LinkedIn profile restriction if
            needed. No job title or location is required.
          </p>
        )}
        {warnings.map((w) => (
          <p key={w} className="warning">
            {w}
          </p>
        ))}
        {(queries.length > 0 || mode === "paste") && (
          <div className="simple-queries">
            {queries.map((query, i) => (
              <div className="simple-query" key={i}>
                <input
                  type="checkbox"
                  aria-label={"Enable query " + (i + 1)}
                  checked={query.enabled}
                  onChange={(e) => {
                    setQueries((old) =>
                      old.map((q, n) =>
                        n === i ? { ...q, enabled: e.target.checked } : q,
                      ),
                    );
                    setDirty(true);
                  }}
                />
                <textarea
                  rows={2}
                  aria-label={"Query " + (i + 1)}
                  placeholder='("cold email" OR "cold call") "B2B" "Chennai"'
                  maxLength={500}
                  value={query.text}
                  onChange={(e) => {
                    setQueries((old) =>
                      old.map((q, n) =>
                        n === i
                          ? { ...q, text: e.target.value, strategy: "custom" }
                          : q,
                      ),
                    );
                    setDirty(true);
                  }}
                />
                <button
                  type="button"
                  className="text-button"
                  aria-label={"Remove query " + (i + 1)}
                  onClick={() => {
                    setQueries((old) => old.filter((_, n) => n !== i));
                    setDirty(true);
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              disabled={
                queries.filter((q) => q.strategy === "custom").length >= 20
              }
              onClick={() => {
                setQueries((old) => [
                  ...old,
                  { text: "", strategy: "custom", enabled: true },
                ]);
                setDirty(true);
              }}
            >
              <Plus size={15} />
              Add query
            </button>
          </div>
        )}
        <details className="more-options">
          <summary>
            More options <span>Campaign name, limits & review rules</span>
          </summary>
          <label>
            Campaign name
            <input
              maxLength={120}
              placeholder="Named automatically if left blank"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          {mode === "paste" && (
            <div className="form-grid">
              {fields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <textarea
                    rows={2}
                    placeholder={field.placeholder}
                    value={config[field.key].join("\n")}
                    onChange={(e) =>
                      update(field.key, e.target.value.split("\n"))
                    }
                  />
                  <small>
                    Optional review rule; does not change your pasted query.
                  </small>
                </label>
              ))}
            </div>
          )}
          <div className="form-grid three">
            {[
              { key: "budget", label: "Maximum requests", max: 50 },
              { key: "pageCap", label: "Pages per query", max: 5 },
              { key: "queryCap", label: "Generated queries", max: 20 },
              { key: "target", label: "Target matches", max: 1000 },
              {
                key: "cooldownDays",
                label: "Skip recent searches (days)",
                max: 365,
              },
            ].map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  type="number"
                  min={
                    f.key === "cooldownDays" ? 0 : f.key === "queryCap" ? 2 : 1
                  }
                  max={f.max}
                  value={config[f.key as keyof CampaignConfig] as number}
                  onChange={(e) =>
                    update(
                      f.key as keyof CampaignConfig,
                      e.target.value === ""
                        ? defaults[f.key as keyof CampaignConfig]
                        : Number(e.target.value),
                    )
                  }
                />
              </label>
            ))}
            <label>
              Country
              <select
                value={config.country}
                onChange={(e) => update("country", e.target.value)}
              >
                <option value="in">India</option>
                <option value="us">United States</option>
                <option value="gb">United Kingdom</option>
                {!["in", "us", "gb"].includes(config.country) && (
                  <option value={config.country}>{config.country}</option>
                )}
              </select>
            </label>
            <label>
              Country code
              <input
                maxLength={2}
                value={config.country}
                onChange={(e) =>
                  update("country", e.target.value.toLowerCase())
                }
                onBlur={() => {
                  if (!config.country) update("country", "in");
                }}
              />
            </label>
            <label>
              Language code
              <input
                maxLength={2}
                value={config.language}
                onChange={(e) =>
                  update("language", e.target.value.toLowerCase())
                }
                onBlur={() => {
                  if (!config.language) update("language", "en");
                }}
              />
            </label>
          </div>
          <div className="form-grid">
            {[
              { key: "queryExclusions", label: "Exclude search terms" },
              { key: "leadExclusions", label: "Exclude current roles" },
            ].map((f) => (
              <label key={f.key}>
                {f.label}
                <textarea
                  rows={2}
                  value={(
                    config[f.key as keyof CampaignConfig] as string[]
                  ).join("\n")}
                  onChange={(e) =>
                    update(
                      f.key as keyof CampaignConfig,
                      e.target.value.split("\n"),
                    )
                  }
                />
                <small>Optional · one per line</small>
              </label>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={config.includeRequired}
              onChange={(e) => update("includeRequired", e.target.checked)}
            />
            Include keywords in generated searches
          </label>
          {c && (
            <label className="check-label reset-check">
              <input
                type="checkbox"
                checked={reset}
                onChange={(e) => setReset(e.target.checked)}
              />
              If review rules changed, return existing leads to Review. Previous
              decisions stay in history.
            </label>
          )}
        </details>
        {!data.live && <SearchSetupNotice clientId={data.client!.id} />}
        <div className="search-footer">
          <span className="muted">
            Up to {cap} request{cap === 1 ? "" : "s"} · results save
            automatically
          </span>
          <div className="row">
            <button type="button" onClick={() => save(false)} disabled={busy}>
              Save for later
            </button>
            <button className="primary" disabled={busy || !data.live}>
              <Play size={15} />
              {busy ? "Working…" : "Start search"}
            </button>
          </div>
        </div>
      </section>
    </form>
  );
}
function CampaignPage({
  data,
  run,
  busy,
  setError,
}: { data: PageData } & Actions) {
  const c = data.campaign!;
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const guard = useRef(false);
  const token = useRef(crypto.randomUUID());
  const enabled = data.queries?.filter((q) => q.enabled) ?? [];
  const cap = Math.min(
    c.config.budget,
    data.serverCap ?? 50,
    enabled.length * c.config.pageCap,
  );
  const active = data.activeRuns?.filter((r) => r.campaign_id === c.id) ?? [];
  async function start() {
    if (guard.current) return;
    guard.current = true;
    setStarting(true);
    setError("");
    try {
      const result = await act<{ runId: string }>("start", {
        campaignId: c.id,
        token: token.current,
        cap,
        revision: c.revision,
        force: repeat ? enabled.map((q) => q.id) : [],
      });
      router.push("/runs/" + result.runId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setStarting(false);
    }
  }
  return (
    <>
      <Header
        eyebrow={data.client!.name}
        title={c.name}
        description={
          [...c.config.locations, ...c.config.roles].join(" · ") ||
          "Custom audience"
        }
        actions={
          <>
            <Link
              className="button"
              href={"/campaigns/new?client=" + c.client_id}
            >
              <Plus size={16} />
              New campaign
            </Link>
            <Link className="button" href={"/campaigns/" + c.id + "/edit"}>
              <SlidersHorizontal size={16} />
              Edit
            </Link>
            <Link
              className="button primary"
              href={"/leads?client=" + c.client_id + "&campaign=" + c.id}
            >
              View leads <ArrowRight size={16} />
            </Link>
          </>
        }
      />
      <Metrics data={data} />
      <section className="card compact-form">
        <div className="section-heading">
          <div>
            <h2>Search</h2>
            <span className="muted">
              {enabled.length} {enabled.length === 1 ? "query" : "queries"} · up
              to {cap} requests · leads save automatically
            </span>
          </div>
          <button
            className="primary"
            disabled={
              starting ||
              !data.live ||
              !cap ||
              c.archived ||
              data.client!.archived
            }
            onClick={start}
          >
            <Play size={15} />
            {starting ? "Starting…" : "Start search"}
          </button>
        </div>
        {!data.live && <SearchSetupNotice clientId={c.client_id} />}
        {!enabled.length && (
          <p>
            Add a query to get started.{" "}
            <Link className="strong" href={"/campaigns/" + c.id + "/edit"}>
              Edit campaign
            </Link>
          </p>
        )}
        <div className="saved-queries">
          {enabled.map((q) => (
            <code key={q.id}>{q.text}</code>
          ))}
        </div>
        {active.map((r) => (
          <p className="row" key={r.id}>
            <Badge status={r.status} />
            {r.new_candidates} leads added{" "}
            <Link className="strong" href={"/runs/" + r.id}>
              Open search
            </Link>
          </p>
        ))}
        <details className="more-options">
          <summary>
            More options <span>Repeat search, duplicate or archive</span>
          </summary>
          <label className="check-label">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(e) => {
                setRepeat(e.target.checked);
                token.current = crypto.randomUUID();
              }}
            />
            Search these queries again, including recent results
          </label>
          <p className="muted">
            Recent searches are skipped by default to save credits.
          </p>
          <div className="row">
            <button
              disabled={busy}
              onClick={() =>
                run(
                  "duplicate",
                  { id: c.id },
                  "Campaign duplicated.",
                  "campaign",
                )
              }
            >
              <Copy size={15} />
              Duplicate campaign
            </button>
            <button
              disabled={busy}
              onClick={() =>
                run(
                  "archive",
                  { kind: "campaign", id: c.id, archived: !c.archived },
                  c.archived ? "Campaign restored." : "Campaign archived.",
                )
              }
            >
              <Archive size={15} />
              {c.archived ? "Restore" : "Archive"}
            </button>
          </div>
        </details>
      </section>
      <History runs={data.runs ?? []} />
    </>
  );
}
function RunPage({ data, run: action, busy }: { data: PageData } & Actions) {
  const r = data.run!;
  const processing = r.status === "running" && data.live;
  const waiting = data.jobs?.find((j) => j.status === "retry_wait")?.retry_at;
  const finished = ["completed", "cancelled", "failed"].includes(r.status);
  return (
    <>
      <Header
        eyebrow={data.campaign!.name}
        title="Search progress"
        description={`Started ${date(r.created_at)} · leads save as they are found`}
        actions={
          <>
            <Link
              className="button"
              href={"/campaigns/new?client=" + r.client_id}
            >
              <Plus size={15} />
              New campaign
            </Link>
            <Badge status={r.status} />
            {!finished && (
              <>
                {processing ? (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      await action(
                        "control",
                        { runId: r.id, action: "pause" },
                        "Run paused. An in-flight request may still finish.",
                      );
                    }}
                  >
                    <Pause size={16} />
                    Pause
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={busy || !data.live}
                    onClick={async () => {
                      await action(
                        "control",
                        { runId: r.id, action: "resume" },
                        "Search resumed. You can work in other campaigns.",
                      );
                    }}
                  >
                    <Play size={16} />
                    Resume search
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={async () => {
                    await action(
                      "control",
                      { runId: r.id, action: "cancel" },
                      "Run cancelled. Unstarted requests were skipped.",
                    );
                  }}
                >
                  <Square size={14} />
                  Cancel run
                </button>
              </>
            )}
          </>
        }
      />
      <Notice>
        Leads save automatically. You can work on other campaigns while this
        search runs. Keep a LeadScope workspace tab open and visible.
      </Notice>
      <section className="card run-progress">
        <div className="section-heading">
          <div className="row">
            {processing ? (
              <LoaderCircle size={20} className="spin" />
            ) : (
              <Search size={20} />
            )}
            <h2>
              {finished
                ? statusNames[r.status]
                : processing
                  ? waiting
                    ? `Retry due ${date(waiting)}`
                    : "Searching public references"
                  : "Processing is paused in this tab"}
            </h2>
          </div>
          <span>
            {r.reserved} / {r.budget} requests reserved
          </span>
        </div>
        <progress max={r.budget} value={r.reserved} />
        <p className="muted">
          {r.new_candidates} leads added · {r.dispatched} search requests sent
          {r.stop_reason ? ` · ${r.stop_reason.replaceAll("_", " ")}` : ""}
        </p>
      </section>
      <div className="metrics">
        {[
          ["Leads added", r.new_candidates],
          ["Rule matches", r.rule_matches],
          ["Review candidates", r.reviews],
          ["Search errors", r.errors],
        ].map(([label, count]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h2>Your leads</h2>
        <Link
          className="button primary"
          href={`/leads?client=${r.client_id}&campaign=${r.campaign_id}`}
        >
          Review results <ArrowRight size={16} />
        </Link>
      </div>
      <details className="more-options">
        <summary>
          Search details <span>Queries, retries & duplicate counts</span>
        </summary>
        <p className="muted">
          {r.duplicates} duplicate occurrences · target {r.rule_matches}/
          {r.target} new rule matches. Request reservations include retries and
          uncertain outcomes.
        </p>
        <section className="card">
          {data.runQueries?.map((q) => (
            <div className="run-query" key={q.id}>
              <div className="row">
                <span className={`strategy ${q.strategy}`}>{q.strategy}</span>
                {q.skipped && <Badge status="skipped" />}
              </div>
              <code>{q.text}</code>
              {q.skipped ? (
                <p className="muted">
                  Cooldown · last successful {date(q.last_success_at)} ·
                  previous pages {q.prior_pages.join(", ")}
                </p>
              ) : (
                <div className="page-jobs">
                  {data.jobs
                    ?.filter((j) => j.run_query_id === q.id)
                    .map((j) => (
                      <div className="page-job" key={j.id}>
                        <strong>Page {j.page_number}</strong>
                        <Badge status={j.status} />
                        <small>{j.attempts} reserved attempts</small>
                        {j.metrics.newCandidates !== undefined && (
                          <small>
                            {j.metrics.newCandidates} new candidates ·{" "}
                            {j.metrics.ruleMatches} rule matches
                          </small>
                        )}
                        {j.failure_code && (
                          <small className="warning">
                            {j.failure_code.replaceAll("_", " ")}
                            {j.retry_at ? ` · ${date(j.retry_at)}` : ""}
                          </small>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </section>
        <section className="card form-card">
          <h2>Yield by search strategy</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Dispatched attempts</th>
                  <th>New candidates</th>
                  <th>Rule matches</th>
                </tr>
              </thead>
              <tbody>
                {["focused", "broader", "custom"].map((strategy) => {
                  const ids =
                    data.runQueries
                      ?.filter((q) => q.strategy === strategy)
                      .map((q) => q.id) ?? [];
                  const jobs =
                    data.jobs?.filter((j) => ids.includes(j.run_query_id)) ??
                    [];
                  return (
                    <tr key={strategy}>
                      <td className="capitalize">{strategy}</td>
                      <td>
                        {jobs.reduce(
                          (n, j) =>
                            n + Number(j.metrics.dispatchedAttempts ?? 0),
                          0,
                        )}
                      </td>
                      <td>
                        {jobs.reduce(
                          (n, j) => n + Number(j.metrics.newCandidates ?? 0),
                          0,
                        )}
                      </td>
                      <td>
                        {jobs.reduce(
                          (n, j) => n + Number(j.metrics.ruleMatches ?? 0),
                          0,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Automatic counts describe this run’s observations. Current human
            decisions are shown in Leads & review. Counts overlap and should not
            be added together.
          </p>
        </section>
      </details>
    </>
  );
}
function ReviewTimer({ campaignId }: { campaignId?: string }) {
  useEffect(() => {
    if (!campaignId) return;
    let lastActivity = Date.now(),
      seconds = 0;
    const activity = () => {
      lastActivity = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll", "pointermove"];
    events.forEach((event) =>
      window.addEventListener(event, activity, { passive: true }),
    );
    const timer = setInterval(() => {
      if (!document.hidden && Date.now() - lastActivity < 30000) seconds++;
      if (seconds >= 15) {
        const amount = seconds;
        seconds = 0;
        void act("time", {
          campaignId,
          seconds: amount,
          token: crypto.randomUUID(),
        }).catch(() => {});
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, activity));
      if (seconds)
        void act("time", {
          campaignId,
          seconds,
          token: crypto.randomUUID(),
        }).catch(() => {});
    };
  }, [campaignId]);
  return null;
}
function LeadsPage({
  data,
  run,
  busy,
  setError,
  setMessage,
}: { data: PageData } & Actions) {
  const params = useSearchParams();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const client = data.client!;
  const leads = data.leads ?? [];
  const campaignId = params.get("campaign") ?? "";
  const filterUrl = (changes: Record<string, string>) => {
    const p = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) =>
      v ? p.set(k, v) : p.delete(k),
    );
    return `/leads?${p}`;
  };
  const exportUrl = `/api/export?client=${client.id}${campaignId ? `&campaign=${campaignId}` : ""}`;
  async function exportLeads(format: "csv" | "tsv") {
    try {
      const response = await fetch(`${exportUrl}&format=${format}`);
      if (!response.ok) throw new Error((await response.json()).error);
      const text = await response.text();
      if (format === "tsv") {
        await navigator.clipboard.writeText(text);
        setMessage("Accepted leads copied. Paste into Google Sheets.");
      } else {
        const url = URL.createObjectURL(
          new Blob([text], { type: "text/csv;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "leadscope-accepted.csv";
        a.click();
        URL.revokeObjectURL(url);
        setMessage("Accepted leads exported.");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function decide(decision: string) {
    const result = await run(
      "review",
      { clientId: client.id, ids: selected, decision, note },
      "Review saved.",
    );
    if (result) {
      setSelected([]);
      setNote("");
    }
  }
  const accepted = data.counts?.accepted ?? 0;
  const precision = data.precision;
  return (
    <>
      <ReviewTimer campaignId={campaignId || undefined} />
      <Header
        eyebrow={client.name}
        title="Leads & review"
        description="The source is the evidence. Your decision makes it a lead."
        actions={
          <>
            <button onClick={() => exportLeads("tsv")}>
              <Clipboard size={16} />
              Copy for Sheets
            </button>
            <button className="primary" onClick={() => exportLeads("csv")}>
              <ArrowDownToLine size={16} />
              Export accepted
            </button>
          </>
        }
      />
      <div className="tabs">
        <Link
          className={!params.get("status") ? "selected" : ""}
          href={filterUrl({ status: "", page: "" })}
        >
          All leads
        </Link>
        {["rule_match", "review", "accepted", "rejected", "suppressed"].map(
          (status) => (
            <Link
              className={params.get("status") === status ? "selected" : ""}
              key={status}
              href={filterUrl({ status, page: "" })}
            >
              {status === "rule_match" ? "Rule matches" : statusNames[status]}
              <span>{data.counts?.[status] ?? 0}</span>
            </Link>
          ),
        )}
      </div>
      <div className="card">
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            router.push(
              filterUrl({
                q: String(form.get("q") ?? ""),
                campaign: String(form.get("campaign") ?? ""),
                page: "",
              }),
            );
          }}
        >
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="Search leads"
              name="q"
              placeholder="Search title, snippet, or profile URL"
              maxLength={200}
              defaultValue={params.get("q") ?? ""}
            />
          </div>
          <select
            aria-label="Campaign filter"
            name="campaign"
            defaultValue={campaignId}
          >
            <option value="">All campaigns</option>
            {data.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button>
            <SlidersHorizontal size={15} />
            Apply filters
          </button>
          {(params.get("q") || campaignId) && (
            <Link href={`/leads?client=${client.id}`}>Clear</Link>
          )}
        </form>
        {selected.length > 0 && (
          <div className="bulk-bar">
            <strong>{selected.length} selected</strong>
            <input
              aria-label="Decision note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional decision note"
              maxLength={4000}
            />
            <button disabled={busy} onClick={() => decide("accepted")}>
              <CheckCheck size={15} />
              Accept
            </button>
            <button disabled={busy} onClick={() => decide("review")}>
              Review
            </button>
            <button disabled={busy} onClick={() => decide("rejected")}>
              Reject
            </button>
            <button disabled={busy} onClick={() => decide("suppressed")}>
              Suppress for client
            </button>
          </div>
        )}
        {!leads.length ? (
          <Empty
            title={
              data.total === 0 && !params.get("status") && !params.get("q")
                ? "No leads discovered yet"
                : "No leads match these filters"
            }
          >
            <p>
              Run a campaign to collect real public profile references, or
              adjust your filters.
            </p>
            <Link className="button" href={`/clients/${client.id}`}>
              Open campaigns <ArrowRight size={15} />
            </Link>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="lead-table">
              <thead>
                <tr>
                  <th className="select-cell">
                    <input
                      aria-label="Select all visible leads"
                      type="checkbox"
                      checked={
                        leads.length > 0 && selected.length === leads.length
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? leads.map((l) => l.id) : [],
                        )
                      }
                    />
                  </th>
                  <th>Profile reference</th>
                  <th>Assessment</th>
                  <th>Campaign</th>
                  <th>Last seen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className={selected.includes(lead.id) ? "selected-row" : ""}
                  >
                    <td>
                      <input
                        aria-label={`Select ${lead.title || lead.canonical_url}`}
                        type="checkbox"
                        checked={selected.includes(lead.id)}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, lead.id]
                              : old.filter((id) => id !== lead.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <Link className="lead-title" href={`/leads/${lead.id}`}>
                        {lead.title || lead.canonical_url}
                      </Link>
                      <p className="snippet-preview">
                        {lead.snippet ||
                          "No snippet provided by the search result."}
                      </p>
                      <a
                        href={lead.canonical_url}
                        target="_blank"
                        rel="noreferrer"
                        className="profile-url"
                      >
                        {lead.canonical_url.replace("https://www.", "")}
                        <ExternalLink size={12} />
                      </a>
                    </td>
                    <td>
                      <Badge status={lead.status} />
                      {lead.manual_decision && (
                        <small>
                          Rule: {statusNames[lead.automatic_status]}
                        </small>
                      )}
                      {lead.criteria_version !== lead.current_version && (
                        <small className="warning">Criteria changed</small>
                      )}
                    </td>
                    <td>{lead.campaign_name}</td>
                    <td className="nowrap">{date(lead.last_seen)}</td>
                    <td>
                      <Link className="button small" href={`/leads/${lead.id}`}>
                        Review <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <span>{data.total ?? 0} matching candidates · 25 per page</span>
          <div className="row">
            <Link
              aria-disabled={(data.page ?? 1) <= 1}
              className={`button small ${(data.page ?? 1) <= 1 ? "disabled" : ""}`}
              href={filterUrl({
                page: String(Math.max(1, (data.page ?? 1) - 1)),
              })}
            >
              <ArrowLeft size={14} />
              Previous
            </Link>
            <span>Page {data.page ?? 1}</span>
            <Link
              aria-disabled={(data.page ?? 1) * 25 >= (data.total ?? 0)}
              className={`button small ${(data.page ?? 1) * 25 >= (data.total ?? 0) ? "disabled" : ""}`}
              href={filterUrl({ page: String((data.page ?? 1) + 1) })}
            >
              Next
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
      <div className="review-metrics">
        <span>
          Rule-match precision{" "}
          <strong>
            {precision?.adjudicated
              ? `${Math.round((100 * precision.accepted) / precision.adjudicated)}%`
              : "N/A"}
          </strong>
          <small>
            {precision?.accepted ?? 0} accepted / {precision?.adjudicated ?? 0}{" "}
            manually adjudicated rule matches
          </small>
        </span>
        <span>
          Accepted / dispatched request{" "}
          <strong>
            {data.dispatched ? (accepted / data.dispatched).toFixed(2) : "N/A"}
          </strong>
        </span>
        <span>
          Approx. review time / accepted{" "}
          <strong>
            {accepted
              ? `${Math.round((data.reviewSeconds ?? 0) / accepted)} sec`
              : "N/A"}
          </strong>
          <small>Active review only; select a campaign to track time</small>
        </span>
      </div>
      <p className="footnote">
        Exports include manually Accepted, currently unsuppressed leads in the
        selected client/campaign, independent of the table’s status or text
        filter. Prior spreadsheet copies cannot be revoked automatically.
      </p>
    </>
  );
}
function LeadDetail({ data, run, busy }: { data: PageData } & Actions) {
  const lead = data.lead!;
  const [note, setNote] = useState(lead.decision_note);
  const [profileNote, setProfileNote] = useState(lead.notes);
  return (
    <>
      <ReviewTimer campaignId={lead.campaign_id} />
      <Link
        className="back-link"
        href={`/leads?client=${lead.client_id}&campaign=${lead.campaign_id}`}
      >
        <ArrowLeft size={16} />
        Back to campaign leads
      </Link>
      <Header
        eyebrow={lead.campaign_name}
        title={lead.title || "Profile reference"}
        actions={
          <a
            className="button"
            href={lead.canonical_url}
            target="_blank"
            rel="noreferrer"
          >
            Open LinkedIn <ExternalLink size={16} />
          </a>
        }
      />
      <div className="detail-grid">
        <div>
          <section className="card form-card">
            <div className="section-heading">
              <h2>Qualification evidence</h2>
              <Badge status={lead.automatic_status} />
            </div>
            <p className="muted">
              Rule match describes search evidence; it is not human
              verification.
            </p>
            {lead.criteria_version !== lead.current_version && (
              <Notice>
                Campaign criteria have changed. These historical results are in
                Review. Use Requalify below to assess stored evidence against
                the current criteria.
              </Notice>
            )}
            <blockquote>
              {lead.assessment.snippet || "No snippet available."}
            </blockquote>
            <div className="evidence-list">
              {Object.entries(lead.assessment.criteria).map(
                ([name, criterion]) => (
                  <div key={name}>
                    <div>
                      <strong className="capitalize">{name}</strong>
                      <Badge status={criterion.state} />
                    </div>
                    <p>{criterion.reason.replaceAll("_", " ")}</p>
                    {criterion.spans.map((span, i) => (
                      <div className="evidence-span" key={i}>
                        <mark>{span.text}</mark>
                        <small>
                          {span.source}, characters {span.start}–{span.end}
                        </small>
                      </div>
                    ))}
                  </div>
                ),
              )}
            </div>
            <small>
              Evidence observed {date(lead.assessment.observedAt)} · Rule
              version {lead.assessment.version}
            </small>
            {lead.prior_assessment && (
              <details>
                <summary>Earlier supporting or conflicting evidence</summary>
                <p>{lead.prior_assessment.title}</p>
                <blockquote>{lead.prior_assessment.snippet}</blockquote>
                <small>{date(lead.prior_assessment.observedAt)}</small>
              </details>
            )}
            {lead.criteria_version !== lead.current_version && (
              <button
                disabled={busy}
                onClick={() =>
                  run(
                    "requalify",
                    { id: lead.id },
                    "Stored evidence requalified. Review the new assessment.",
                  )
                }
              >
                <RefreshCw size={15} />
                Requalify stored evidence
              </button>
            )}
          </section>
          <section className="card form-card">
            <h2>Decision history</h2>
            {!data.reviewEvents?.length && (
              <p className="muted">No manual decisions recorded.</p>
            )}
            {data.reviewEvents?.map((event) => (
              <details key={event.id}>
                <summary>
                  {date(event.created_at)} ·{" "}
                  {statusNames[event.decision] ??
                    event.decision.replaceAll("_", " ")}
                </summary>
                <p className="muted">
                  Operator {event.actor} ·{" "}
                  {event.was_rule_match
                    ? "Rule match at decision"
                    : "Not a rule match at decision"}
                </p>
                <p>{event.note || "No note entered."}</p>
              </details>
            ))}
            <hr />
            <h2>
              Discovery history{" "}
              <span className="count">{data.discoveries?.length ?? 0}</span>
            </h2>
            <p className="muted">
              Original source text and the query that found it. Latest 100
              discoveries.
            </p>
            {data.discoveries?.map((d) => (
              <details key={d.id}>
                <summary>
                  {date(d.observed_at)} · Page {d.search_jobs.page_number} ·
                  Position {d.position}
                </summary>
                <h3>{d.title}</h3>
                <blockquote>{d.snippet || "No snippet returned."}</blockquote>
                <code>{d.search_jobs.run_queries.text}</code>
                <p>
                  <a href={lead.canonical_url} target="_blank" rel="noreferrer">
                    Open canonical profile <ExternalLink size={12} />
                  </a>
                </p>
                <small>Original result URL: {d.original_url}</small>
              </details>
            ))}
          </section>
        </div>
        <aside>
          <section className="card form-card decision-card">
            <div className="section-heading">
              <h2>Your decision</h2>
              <Badge status={lead.status} />
            </div>
            <label>
              Decision note
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                maxLength={4000}
              />
            </label>
            <div className="decision-buttons">
              {["accepted", "review", "rejected", "suppressed"].map(
                (decision) => (
                  <button
                    key={decision}
                    className={decision === "accepted" ? "primary" : ""}
                    disabled={
                      busy ||
                      (decision === "accepted" &&
                        (lead.suppressed ||
                          lead.criteria_version !== lead.current_version))
                    }
                    onClick={() =>
                      run(
                        "review",
                        {
                          clientId: lead.client_id,
                          ids: [lead.id],
                          decision,
                          note,
                        },
                        "Decision saved.",
                      )
                    }
                  >
                    {decision === "accepted" && <CheckCheck size={16} />}
                    {decision === "suppressed"
                      ? "Suppress for this client"
                      : decision === "accepted"
                        ? "Accept lead"
                        : decision === "rejected"
                          ? "Reject lead"
                          : "Keep in Review"}
                  </button>
                ),
              )}
            </div>
            <small>Reviewed {date(lead.decided_at)}</small>
            {lead.suppressed && (
              <Notice>
                Client suppression overrides every campaign decision. Remove it
                from Suppressions to return this lead to Review.
              </Notice>
            )}
          </section>
          <section className="card form-card">
            <h2>Client-wide notes</h2>
            <label className="sr-only" htmlFor="profile-note">
              Client-wide notes
            </label>
            <textarea
              id="profile-note"
              value={profileNote}
              onChange={(e) => setProfileNote(e.target.value)}
              rows={5}
              maxLength={4000}
            />
            <button
              disabled={busy || profileNote === lead.notes}
              onClick={() =>
                run(
                  "note",
                  {
                    clientId: lead.client_id,
                    profileId: lead.client_profile_id,
                    note: profileNote,
                  },
                  "Client-wide notes saved.",
                )
              }
            >
              Save notes
            </button>
            <hr />
            <small>
              First seen {date(lead.first_seen)}
              <br />
              Last seen {date(lead.last_seen)}
            </small>
          </section>
        </aside>
      </div>
    </>
  );
}
function SettingsPage({ data, run, busy }: { data: PageData } & Actions) {
  const [showAdd, setShowAdd] = useState(false);
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = await run(
      "suppression",
      {
        clientId: data.client!.id,
        url: form.get("url"),
        reason: form.get("reason"),
        note: form.get("note"),
        active: true,
      },
      "Profile suppressed for this client.",
    );
    if (result) setShowAdd(false);
  }
  return (
    <>
      <Header
        eyebrow={data.client!.name}
        title="Settings"
        description="Keep client-wide exclusions deliberate and visible."
        actions={
          <button className="primary" onClick={() => setShowAdd(!showAdd)}>
            <Plus size={16} />
            Add suppression
          </button>
        }
      />
      <Notice>
        Suppression overrides all campaigns for this client, including future
        searches and exports. Removing it sends affected candidates to Review.
      </Notice>
      {showAdd && (
        <form className="card form-card" onSubmit={add}>
          <h2>Suppress a profile</h2>
          <label>
            LinkedIn profile URL
            <input name="url" type="url" required maxLength={2000} />
          </label>
          <label>
            Reason
            <input name="reason" required maxLength={200} />
          </label>
          <label>
            Note
            <textarea name="note" maxLength={4000} />
          </label>
          <div className="row">
            <button className="primary" disabled={busy}>
              Save suppression
            </button>
            <button type="button" onClick={() => setShowAdd(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="card">
        {!data.suppressions?.length ? (
          <Empty
            icon={<ShieldCheck size={24} />}
            title="No suppressed profiles"
          >
            <p>Exclude a profile here or use Suppress while reviewing leads.</p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>Reason & note</th>
                  <th>State</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.suppressions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <a
                        href={s.canonical_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {s.canonical_url.replace("https://www.", "")}
                        <ExternalLink size={12} />
                      </a>
                    </td>
                    <td>
                      {s.reason}
                      <small>{s.note}</small>
                    </td>
                    <td>
                      <Badge status={s.active ? "suppressed" : "Removed"} />
                    </td>
                    <td>{date(s.updated_at)}</td>
                    <td>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(
                            "suppression",
                            {
                              clientId: data.client!.id,
                              url: s.canonical_url,
                              reason: s.reason,
                              note: s.note,
                              active: !s.active,
                            },
                            s.active
                              ? "Suppression removed. Affected candidates are in Review."
                              : "Suppression restored.",
                          )
                        }
                      >
                        {s.active ? "Remove suppression" : "Restore"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <section className="card form-card">
        <h2>Suppression history</h2>
        {!data.suppressionEvents?.length && (
          <p className="muted">No suppression changes recorded.</p>
        )}
        {data.suppressionEvents?.map((event) => (
          <details key={event.id}>
            <summary>
              {date(event.created_at)} ·{" "}
              {event.active ? "Suppressed" : "Removed"} ·{" "}
              {event.canonical_url.replace("https://www.linkedin.com/in/", "")}
            </summary>
            <p>{event.reason}</p>
            <p className="muted">{event.note}</p>
            <small>Operator {event.actor}</small>
          </details>
        ))}
        <hr />
        <h2>Connection status</h2>
        <p className="muted">
          Presence checks only. No paid request is made and no credentials are
          displayed.
        </p>
        <div className="setup-checks">
          {Object.entries(data.checks ?? {}).map(([name, value]) => (
            <div key={name}>
              <span>{name}</span>
              <span className={value ? "configured" : "missing"}>
                {value ? "Configured" : "Not configured"}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="card form-card">
        <h2>Raw response retention</h2>
        <p className="muted">
          Remove raw provider responses from completed jobs older than 30 days.
          Discovery evidence, decisions, and search history are retained.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            run("cleanup", {}, "Old completed raw responses cleaned up.")
          }
        >
          Clean up responses older than 30 days
        </button>
      </section>
    </>
  );
}
