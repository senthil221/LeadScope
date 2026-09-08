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
import type { Client, PageData, Preflight, Run } from "@/lib/types";

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
                className={data.view === "settings" ? "active" : ""}
                href={`/settings?client=${client.id}`}
              >
                <Settings size={18} />
                Suppressions & setup
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
            {data.live ? "Live search enabled" : "Live search disabled"}
          </span>
        </div>
        <div className="page-body">
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
                  "Define an audience. Discover references. Review the evidence."
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
                              {c.config.locations.slice(0, 2).join(", ")}
                              <small>
                                {c.config.roles.slice(0, 2).join(", ")}
                              </small>
                            </td>
                            <td>Up to {c.config.budget} / run</td>
                            <td>
                              <Badge
                                status={c.archived ? "Archived" : "Active"}
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
            <p>Preview your queries and request budget before starting.</p>
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
function Builder({ data, run, busy, setError }: { data: PageData } & Actions) {
  const router = useRouter();
  const c = data.campaign;
  const [name, setName] = useState(c?.name ?? "");
  const [config, setConfig] = useState<CampaignConfig>(c?.config ?? defaults);
  const [queries, setQueries] = useState<Query[]>(data.queries ?? []);
  const [dirty, setDirty] = useState(false);
  const [reset, setReset] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function update<K extends keyof CampaignConfig>(
    key: K,
    value: CampaignConfig[K],
  ) {
    setConfig((old) => ({ ...old, [key]: value }));
    setDirty(true);
  }
  async function generate() {
    setGenerating(true);
    setError("");
    try {
      const result = await act<{ queries: Query[]; warnings: string[] }>(
        "generate",
        config,
      );
      setQueries(result.queries);
      setWarnings(result.warnings);
      setDirty(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }
  const listFields: {
    key: keyof CampaignConfig;
    label: string;
    hint: string;
    required?: boolean;
  }[] = [
    {
      key: "locations",
      label: "Location aliases",
      hint: "One per line · up to 20",
      required: true,
    },
    {
      key: "roles",
      label: "Target roles",
      hint: "One per line · up to 30",
      required: true,
    },
    {
      key: "skills",
      label: "Skills",
      hint: "Any one skill can qualify · up to 30",
    },
    {
      key: "requiredKeywords",
      label: "Required keywords",
      hint: "Every keyword needs evidence · up to 15",
    },
    {
      key: "queryExclusions",
      label: "Search exclusions",
      hint: "Optional words to exclude from Google queries · up to 20",
    },
    {
      key: "leadExclusions",
      label: "Excluded current roles",
      hint: "Only clear current-role evidence rejects a lead · up to 20",
    },
  ];
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await run(
          "campaign",
          {
            id: c?.id,
            clientId: data.client!.id,
            name,
            config,
            queries,
            reset,
            expectedRevision: c?.revision,
          },
          "Campaign saved.",
        );
        if (result) {
          setDirty(false);
          router.push(`/campaigns/${result.id}`);
        }
      }}
    >
      <Header
        eyebrow={data.client!.name}
        title={c ? "Edit campaign" : "Build your campaign"}
        description="Make the audience explicit. Let the evidence guide the review."
        actions={
          <>
            <span className={`save-state ${dirty ? "unsaved" : ""}`}>
              {dirty
                ? "Unsaved changes"
                : c
                  ? "All changes saved"
                  : "New campaign"}
            </span>
            <button
              className="primary"
              disabled={busy || generating || !queries.length}
            >
              {busy ? "Saving…" : "Save campaign"}
              <Check size={16} />
            </button>
          </>
        }
      />
      <div className="builder-grid">
        <div>
          <section className="card form-card">
            <div className="card-heading">
              <span className="step">1</span>
              <div>
                <h2>Audience & evidence</h2>
                <p className="muted">
                  Profile references must support each configured criterion.
                </p>
              </div>
            </div>
            <label>
              Campaign name
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
                required
                maxLength={120}
                placeholder="Name this audience"
              />
            </label>
            <div className="form-grid">
              {listFields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  {!field.required && (
                    <span className="optional">optional</span>
                  )}
                  <textarea
                    rows={3}
                    value={(config[field.key] as string[]).join("\n")}
                    onChange={(e) =>
                      update(field.key, e.target.value.split("\n"))
                    }
                    onBlur={() =>
                      update(
                        field.key,
                        (config[field.key] as string[])
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                    required={field.required}
                  />
                  <small>{field.hint}</small>
                </label>
              ))}
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={config.includeRequired}
                onChange={(e) => update("includeRequired", e.target.checked)}
              />
              Include required keywords in focused searches
            </label>
          </section>
          <section className="card form-card">
            <div className="card-heading">
              <span className="step">2</span>
              <div>
                <h2>Search boundaries</h2>
                <p className="muted">
                  The request budget includes failed attempts and retries.
                </p>
              </div>
            </div>
            <div className="form-grid three">
              <label>
                Country code
                <input
                  value={config.country}
                  maxLength={2}
                  pattern="[a-z]{2}"
                  onChange={(e) =>
                    update("country", e.target.value.toLowerCase())
                  }
                />
                <small>Two-letter Google country code</small>
              </label>
              <label>
                Language code
                <input
                  value={config.language}
                  maxLength={2}
                  pattern="[a-z]{2}"
                  onChange={(e) =>
                    update("language", e.target.value.toLowerCase())
                  }
                />
              </label>
              {(
                [
                  {
                    key: "queryCap",
                    label: "Generated query cap",
                    min: 2,
                    max: 20,
                  },
                  { key: "pageCap", label: "Pages per query", min: 1, max: 5 },
                  { key: "budget", label: "Request budget", min: 1, max: 50 },
                  {
                    key: "target",
                    label: "Target new rule matches",
                    min: 1,
                    max: 1000,
                  },
                  {
                    key: "cooldownDays",
                    label: "Cooldown days",
                    min: 0,
                    max: 365,
                  },
                ] as const
              ).map((f) => (
                <label key={f.key}>
                  {f.label}
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    required
                    value={config[f.key]}
                    onChange={(e) => update(f.key, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
            <Notice>
              The target is best effort. Search results never guarantee a number
              of qualified leads.
            </Notice>
            {c && (
              <label className="check-label reset-check">
                <input
                  type="checkbox"
                  checked={reset}
                  onChange={(e) => setReset(e.target.checked)}
                />
                If criteria changed, reset existing candidates to Review.
                Previous decisions remain in history.
              </label>
            )}
          </section>
        </div>
        <aside className="builder-aside card">
          <SlidersHorizontal size={23} />
          <h3>
            Keep the search focused.
            <br />
            Keep the review honest.
          </h3>
          <p>
            <strong>Focused searches</strong> include a location, roles, and
            skills when configured.
          </p>
          <p>
            <strong>Broader searches</strong> omit skills to catch profiles with
            less detail. Qualification still checks every requirement.
          </p>
          <hr />
          <p>
            Required keywords are assessed after retrieval unless you choose to
            add them to focused searches.
          </p>
          <p>New rule matches always need human review before export.</p>
        </aside>
      </div>
      <section className="card form-card">
        <div className="card-heading query-heading">
          <div className="row">
            <span className="step">3</span>
            <div>
              <h2>
                Query preview <span className="count">{queries.length}</span>
              </h2>
              <p className="muted">
                Edit, disable, or add a query. Previewing uses no search
                credits.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={generating || busy}
          >
            <RefreshCw size={16} className={generating ? "spin" : ""} />
            {queries.length ? "Regenerate queries" : "Generate queries"}
          </button>
        </div>
        {warnings.map((w) => (
          <p className="warning" key={w}>
            {w}
          </p>
        ))}
        {!queries.length && (
          <Empty title="Preview before you search">
            <p>Add a location and target role, then generate your queries.</p>
          </Empty>
        )}
        {queries.map((query, index) => (
          <div className="query-editor" key={index}>
            <label className="check-label">
              <input
                aria-label={`Enable query ${index + 1}`}
                type="checkbox"
                checked={query.enabled}
                onChange={(e) => {
                  setQueries((old) =>
                    old.map((q, i) =>
                      i === index ? { ...q, enabled: e.target.checked } : q,
                    ),
                  );
                  setDirty(true);
                }}
              />
              <span className="query-number">
                {String(index + 1).padStart(2, "0")}
              </span>
            </label>
            <div>
              <span className={`strategy ${query.strategy}`}>
                {query.strategy}
              </span>
              <textarea
                aria-label={`Query ${index + 1}`}
                value={query.text}
                maxLength={500}
                rows={2}
                onChange={(e) => {
                  setQueries((old) =>
                    old.map((q, i) =>
                      i === index ? { ...q, text: e.target.value } : q,
                    ),
                  );
                  setDirty(true);
                }}
              />
              <small>{query.text.length} / 500 characters</small>
            </div>
            <button
              type="button"
              aria-label={`Remove query ${index + 1}`}
              onClick={() => {
                setQueries((old) => old.filter((_, i) => i !== index));
                setDirty(true);
              }}
            >
              <X size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={queries.filter((q) => q.strategy === "custom").length >= 20}
          onClick={() => {
            setQueries((old) => [
              ...old,
              {
                text: "site:linkedin.com/in/ ",
                strategy: "custom",
                enabled: true,
              },
            ]);
            setDirty(true);
          }}
        >
          <Plus size={16} />
          Add custom query
        </button>
      </section>
      <div className="bottom-actions">
        <span className="muted">
          Saving a campaign never dispatches a search.
        </span>
        <button
          className="primary"
          disabled={busy || generating || !queries.length}
        >
          {busy ? "Saving…" : "Save campaign"}
          <ArrowRight size={16} />
        </button>
      </div>
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
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [force, setForce] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const token = useRef<string | null>(null);
  const router = useRouter();
  async function preview(forced = force) {
    setChecking(true);
    setError("");
    try {
      token.current ??= crypto.randomUUID();
      setPreflight(
        await act<Preflight>("preflight", {
          campaignId: c.id,
          force: forced,
          token: token.current,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  async function start() {
    if (starting) return;
    setStarting(true);
    setError("");
    try {
      token.current ??= crypto.randomUUID();
      const r = await act<{ runId: string }>("start", {
        campaignId: c.id,
        force,
        token: token.current,
        cap: preflight?.cap,
        revision: preflight?.revision,
      });
      router.push(`/runs/${r.runId}?start=1`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }
  return (
    <>
      <Header
        eyebrow={data.client!.name}
        title={c.name}
        description={`${c.config.locations.join(" · ")} / ${c.config.roles.join(" · ")}`}
        actions={
          <>
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
              <Copy size={16} />
              Duplicate
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
              <Archive size={16} />
              {c.archived ? "Restore" : "Archive"}
            </button>
            <Link className="button" href={`/campaigns/${c.id}/edit`}>
              <SlidersHorizontal size={16} />
              Edit campaign
            </Link>
          </>
        }
      />
      <Metrics data={data} />
      <section className="card form-card">
        <div className="section-heading">
          <div>
            <h2>Ready when you are</h2>
            <p className="muted">
              {data.queries?.filter((q) => q.enabled).length} enabled queries ·
              up to {c.config.pageCap} pages each · target {c.config.target} new
              rule matches
            </p>
          </div>
          <button
            className="primary"
            disabled={checking || c.archived || data.client!.archived}
            onClick={() => preview()}
          >
            <Search size={16} />
            {checking ? "Checking…" : "Preview search"}
          </button>
        </div>
        {!data.live && (
          <Notice>
            Live search is disabled. Configure the server integration key,
            Serper API key, and live-search setting in the setup instructions.
            Query editing remains available.
          </Notice>
        )}
        <div className="query-preview-list">
          {data.queries?.map((q, i) => (
            <div key={q.id} className={!q.enabled ? "disabled-query" : ""}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <span className={`strategy ${q.strategy}`}>{q.strategy}</span>
              <code>{q.text}</code>
              {!q.enabled && <small>Disabled</small>}
            </div>
          ))}
        </div>
        {preflight && (
          <div className="preflight">
            <div className="section-heading">
              <h3>Review this search</h3>
              <span className="pill">
                {preflight.eligible} eligible /{" "}
                {preflight.queries.length - preflight.eligible} skipped
              </span>
            </div>
            <p>
              {
                preflight.queries.filter(
                  (q) => !q.skipped && q.strategy === "focused",
                ).length
              }{" "}
              focused ·{" "}
              {
                preflight.queries.filter(
                  (q) => !q.skipped && q.strategy === "broader",
                ).length
              }{" "}
              broader · {preflight.pages} pages per query · target{" "}
              {preflight.target}
            </p>
            {preflight.queries.map((q) => (
              <div key={q.id} className="preflight-query">
                <div>
                  <code>{q.text}</code>
                  <small>
                    Last successful search: {date(q.lastSuccess)} · Previous
                    pages: {q.priorPages.join(", ") || "none"}
                    {q.skipped ? " · Skipped by cooldown" : " · Eligible"}
                  </small>
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={force.includes(q.id)}
                    disabled={checking}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...force, q.id]
                        : force.filter((id) => id !== q.id);
                      setForce(next);
                      void preview(next);
                    }}
                  />
                  Force rerun
                </label>
              </div>
            ))}
            <Notice>
              Only the open run page processes searches. Closing the tab stops
              subsequent requests; an in-flight request may still finish. The
              cap includes retries and may leave pages unsearched.
            </Notice>
            <button
              className="primary"
              disabled={!data.live || !preflight.cap || starting || checking}
              onClick={start}
            >
              <Play size={16} />
              {starting
                ? "Starting…"
                : `Start search — up to ${preflight.cap} requests`}
            </button>
            {!preflight.cap && (
              <p className="warning">
                All queries are skipped. Force a query to rerun, or wait for the
                cooldown.
              </p>
            )}
          </div>
        )}
      </section>
      <div className="section-heading">
        <Link
          className="button"
          href={`/leads?client=${c.client_id}&campaign=${c.id}`}
        >
          Review campaign leads <ArrowRight size={16} />
        </Link>
      </div>
      <History runs={data.runs ?? []} />
    </>
  );
}
function RunPage({
  data,
  run: action,
  busy,
  setError,
}: { data: PageData } & Actions) {
  const r = data.run!;
  const router = useRouter();
  const params = useSearchParams();
  const [processing, setProcessing] = useState(
    params.get("start") === "1" && r.status === "running",
  );
  const [waiting, setWaiting] = useState<string | null>(null);
  const [inflight, setInflight] = useState(false);
  const guard = useRef(false);
  useEffect(() => {
    if (!processing) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;
    async function next() {
      if (cancelled) return;
      if (guard.current) {
        timeout = setTimeout(next, 500);
        return;
      }
      if (document.hidden) {
        timeout = setTimeout(next, 1000);
        return;
      }
      guard.current = true;
      setInflight(true);
      try {
        const result = await act<{ state: string; nextRetryAt?: string }>(
          "process",
          { runId: r.id },
        );
        router.refresh();
        if (
          ["completed", "cancelled", "failed", "paused"].includes(result.state)
        ) {
          setProcessing(false);
          return;
        }
        setWaiting(result.nextRetryAt ?? null);
        const delay = result.nextRetryAt
          ? Math.max(
              1000,
              Math.min(
                60000,
                new Date(result.nextRetryAt).getTime() - Date.now(),
              ),
            )
          : 1000;
        if (!cancelled) timeout = setTimeout(next, delay);
      } catch (e) {
        setError((e as Error).message);
        setProcessing(false);
      } finally {
        guard.current = false;
        setInflight(false);
      }
    }
    void next();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [processing, r.id, router, setError]);
  const finished = ["completed", "cancelled", "failed"].includes(r.status);
  return (
    <>
      <Header
        eyebrow={data.campaign!.name}
        title="Search run"
        description={`Started ${date(r.created_at)} · Snapshot saved at start`}
        actions={
          <>
            <Badge status={r.status} />
            {!finished && (
              <>
                {processing ? (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setProcessing(false);
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
                      const ok = await action(
                        "control",
                        { runId: r.id, action: "resume" },
                        "Processing resumed while this page is open.",
                      );
                      if (ok) setProcessing(true);
                    }}
                  >
                    <Play size={16} />
                    Resume processing
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={async () => {
                    setProcessing(false);
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
        Keep this page open to process searches. Hidden tabs pause dispatch.
        Closing it stops subsequent requests; a request already in flight may
        finish and consume a slot. There is no background worker.
      </Notice>
      <section className="card run-progress">
        <div className="section-heading">
          <div className="row">
            {inflight ? (
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
            {r.reserved} / {r.budget} slots reserved
          </span>
        </div>
        <progress max={r.budget} value={r.reserved} />
        <p className="muted">
          {r.dispatched} dispatch attempts recorded · target {r.rule_matches} /{" "}
          {r.target} new rule matches
          {r.stop_reason ? ` · ${r.stop_reason.replaceAll("_", " ")}` : ""}
        </p>
        <small>
          Reserved slots are a conservative application budget, not a statement
          of provider billing.
        </small>
      </section>
      <div className="metrics six">
        {[
          ["New client profiles", r.new_client_profiles],
          ["New campaign candidates", r.new_candidates],
          ["Rule matches", r.rule_matches],
          ["Review candidates", r.reviews],
          ["Duplicate occurrences", r.duplicates],
          ["Request errors", r.errors],
        ].map(([label, count]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h2>Query & page coverage</h2>
        <Link
          className="button primary"
          href={`/leads?client=${r.client_id}&campaign=${r.campaign_id}`}
        >
          Review results <ArrowRight size={16} />
        </Link>
      </div>
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
                Cooldown · last successful {date(q.last_success_at)} · previous
                pages {q.prior_pages.join(", ")}
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
                  data.jobs?.filter((j) => ids.includes(j.run_query_id)) ?? [];
                return (
                  <tr key={strategy}>
                    <td className="capitalize">{strategy}</td>
                    <td>
                      {jobs.reduce(
                        (n, j) => n + Number(j.metrics.dispatchedAttempts ?? 0),
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
        title="Suppressions & setup"
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
