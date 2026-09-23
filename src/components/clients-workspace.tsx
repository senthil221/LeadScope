"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, FolderOpen, Plus, X } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import type { PageData } from "@/lib/types";
import { act as sharedAct } from "@/lib/client/act";

function act<T>(action: string, payload: unknown): Promise<T> {
  return sharedAct<T>(action, payload, "Could not save the client.");
}

const pipelineColumns = [
  { key: "all_profiles", label: "All" },
  { key: "profile_shortlisted", label: "Profile" },
  { key: "recruiter_shortlisted", label: "Recruiter" },
  { key: "client_shortlisted", label: "Client" },
  { key: "offer_sent", label: "Offer" },
] as const;

const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// The directory is a standalone recruiting entry point. It intentionally
// contains only client discovery and creation, keeping campaign tooling out
// of the initial client-list bundle.
export function ClientsWorkspace({ data }: { data: PageData }) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eligibleClients = data.clients.filter(
    (client) => showArchived || !client.archived,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const clients = eligibleClients.filter(
    (client) =>
      !normalizedQuery ||
      client.name.toLocaleLowerCase().includes(normalizedQuery) ||
      client.notes.toLocaleLowerCase().includes(normalizedQuery),
  );
  const workQueue = data.agencyWorkQueue ?? [];
  const directoryCounts = new Map(
    (data.clientDirectoryCounts ?? []).map((item) => [item.client_id, item]),
  );
  const workGroups = [
    {
      key: "follow_ups",
      label: "Due follow-ups",
      stage: "follow_ups",
      count: (item: (typeof workQueue)[number]) => item.due_follow_ups,
    },
    {
      key: "client_review",
      label: "Client review",
      stage: "client_shortlisted",
      count: (item: (typeof workQueue)[number]) => item.client_review,
    },
    {
      key: "offers",
      label: "Offer follow-ups",
      stage: "offer_sent",
      count: (item: (typeof workQueue)[number]) => item.offers_in_progress,
    },
  ] as const;

  async function createClient(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    try {
      const values = new FormData(form);
      const result = await act<{ id: string }>("client", {
        name: values.get("name"),
        notes: values.get("notes"),
      });
      router.push(`/clients/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell data={data}>
      {/* One bar rather than a page header above a section header: the title,
          what filters the list and what adds to it all belong to the same
          table, and stacking them pushed the first client below the fold. */}
      <header className="directory-bar">
        <h1>
          Clients <span className="count">{clients.length}</span>
        </h1>
        <div className="directory-controls">
          <input
            aria-label="Search clients"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clients"
            type="search"
            value={query}
          />
          <label className="check-label">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Include archived
          </label>
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            New client
          </button>
        </div>
      </header>
      {error && <p className="toast error" role="alert">{error}</p>}
      {data.dashboardSummaryUnavailable && (
        <div className="notice" role="status">
          Your client list is available, but the dashboard totals could not load. Apply the latest database migrations, then refresh this page.
        </div>
      )}
      {!clients.length ? (
        <div className="card empty">
          <div className="empty-icon"><FolderOpen size={28} /></div>
          <h3>
            {normalizedQuery
              ? "No clients match that search"
              : data.clients.length
                ? "No active clients"
                : "Your first client starts here"}
          </h3>
          <p>
            {normalizedQuery
              ? "Try a client name or a word from its notes."
              : data.clients.length
                ? "Include archived clients to view them."
                : "Create a client, then add the roles you are hiring for."}
          </p>
          {!data.clients.length && (
            <button className="primary" onClick={() => setCreating(true)}>
              <Plus size={16} />
              Create your first client
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrap client-directory-wrap">
          <table className="client-directory-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Roles</th>
                <th>Pipeline</th>
                <th>Needs attention</th>
                <th>Created</th>
                <th><span className="sr-only">Open client</span></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const counts = directoryCounts.get(client.id);
                const clientWork = workQueue.filter((item) => item.client_id === client.id);
                const visibleWork = clientWork.flatMap((item) =>
                  workGroups
                    .filter((group) => group.count(item) > 0)
                    .map((group) => ({
                      key: `${item.role_id}-${group.key}`,
                      href: `/roles/${item.role_id}?stage=${group.stage}`,
                      label: `${group.count(item)} ${group.label.toLowerCase()} · ${item.role_name}`,
                    })),
                );
                return (
                  <tr key={client.id} className={client.archived ? "is-archived" : undefined}>
                    <td className="client-directory-name">
                      <Link href={`/clients/${client.id}`}>
                        <span className="client-monogram">{client.name.slice(0, 2).toUpperCase()}</span>
                        {/* A note only earns its line when there is one. The
                            placeholder repeated a sentence down the whole
                            column and told nobody anything. */}
                        <span>
                          <strong>{client.name}</strong>
                          {client.notes && <small>{client.notes}</small>}
                        </span>
                      </Link>
                      {client.archived && <span className="badge">Archived</span>}
                    </td>
                    <td>
                      <Link className="client-role-count" href={`/clients/${client.id}/roles`}>
                        <strong>{counts?.active_roles ?? 0}</strong>
                      </Link>
                    </td>
                    <td>
                      {/* One line, in pipeline order. Stages nobody is sitting
                          in are dimmed so the row reads as where the work is
                          rather than as five equally loud numbers. */}
                      <div className="client-pipeline-summary" aria-label="Candidate pipeline">
                        {pipelineColumns.map((column) => {
                          const value = counts?.[column.key] ?? 0;
                          return (
                            <span className={value ? undefined : "is-zero"} key={column.key}>
                              <strong>{value}</strong> {column.label}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      {visibleWork.length ? (
                        <div className="client-attention-list">
                          {visibleWork.slice(0, 2).map((item) => (
                            <Link href={item.href} key={item.key}>{item.label}</Link>
                          ))}
                          {visibleWork.length > 2 && (
                            <Link href={`/clients/${client.id}/roles`} className="client-attention-more">
                              +{visibleWork.length - 2} more
                            </Link>
                          )}
                        </div>
                      ) : (
                        <span className="client-all-clear">All clear</span>
                      )}
                    </td>
                    <td><time dateTime={client.created_at}>{date(client.created_at)}</time></td>
                    <td>
                      <Link href={`/clients/${client.id}`} className="table-row-action" aria-label={`Open ${client.name}`}>
                        <ArrowRight size={18} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <dialog open className="modal">
          <div className="modal-heading">
            <h2>Create client</h2>
            <button aria-label="Close" disabled={busy} onClick={() => setCreating(false)}>
              <X size={18} />
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createClient(event.currentTarget);
            }}
          >
            <label>
              Client name
              <input name="name" required maxLength={120} autoFocus disabled={busy} />
            </label>
            <label>
              Notes <span className="optional">optional</span>
              <textarea name="notes" rows={4} maxLength={4000} disabled={busy} />
            </label>
            <button disabled={busy} className="primary wide">
              {busy ? "Creating…" : "Create client"}
            </button>
          </form>
        </dialog>
      )}
    </AppShell>
  );
}
