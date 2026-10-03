"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, ArchiveRestore, ArrowRight, CheckCircle2, FolderOpen, Plus, X } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import type { PageData } from "@/lib/types";
import { act as sharedAct } from "@/lib/client/act";
import { TableDialog } from "./recruiting/table-dialog";
import { formatRecruitingDate } from "@/lib/recruiting/display";

function act<T>(action: string, payload: unknown): Promise<T> {
  return sharedAct<T>(action, payload, "Could not save the client.");
}

const pipelineColumns = [
  { key: "all_profiles", label: "All", description: "All profiles" },
  { key: "profile_shortlisted", label: "Profile", description: "Profile shortlisted" },
  { key: "recruiter_shortlisted", label: "Recruiter", description: "Recruiter shortlisted" },
  { key: "client_shortlisted", label: "Client", description: "Client shortlisted" },
  { key: "offer_sent", label: "Offer", description: "Offer sent" },
] as const;

const date = formatRecruitingDate;

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
      label: "Follow-ups",
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
      label: "Offers",
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
  async function toggleArchive(id: string, archived: boolean) {
    if (busy) return;
    setBusy(true); setError("");
    try { await act("archive", { kind: "client", id, archived }); router.refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <AppShell data={data}>
      {/* One bar rather than a page header above a section header: the title,
          what filters the list and what adds to it all belong to the same
          table, and stacking them pushed the first client below the fold. */}
      <header className="directory-bar client-directory-bar">
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
                <th scope="col">Client</th>
                <th scope="col">Roles</th>
                {pipelineColumns.map((column) => <th scope="col" className="client-pipeline-cell" key={column.key} title={column.description} aria-label={column.description}>{column.label}</th>)}
                <th scope="col">Needs attention</th>
                <th scope="col">Created</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
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
                      count: group.count(item),
                      label: group.label,
                      roleName: item.role_name,
                    })),
                );
                return (
                  <tr key={client.id} className={client.archived ? "is-archived" : undefined}>
                    <td className="client-directory-name">
                      <Link href={`/clients/${client.id}`} title={client.name}>
                        <span className="client-monogram">{client.name.slice(0, 2).toUpperCase()}</span>
                        <span>
                          <span className="client-identity-line"><strong>{client.name}</strong>{client.archived && <span className="badge">Archived</span>}</span>
                          {client.notes && <small title={client.notes}>{client.notes}</small>}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <Link className="client-role-count" href={`/clients/${client.id}/roles`}>
                        <strong>{counts?.active_roles ?? 0}</strong>
                      </Link>
                    </td>
                    {pipelineColumns.map((column) => {
                      const value = counts?.[column.key] ?? 0;
                      return <td className={`client-pipeline-cell${value ? "" : " is-zero"}`} key={column.key}>
                        <span title={`${column.description}: ${value}`}>{value.toLocaleString("en-US")}</span>
                      </td>;
                    })}
                    <td>
                      {visibleWork.length ? (
                        <div className="client-attention-list">
                          {visibleWork.slice(0, visibleWork.length > 2 ? 1 : 2).map((item) => (
                            <Link href={item.href} key={item.key} title={`${item.count} ${item.label.toLowerCase()} · ${item.roleName}`} aria-label={`${item.count} ${item.label.toLowerCase()} for ${item.roleName}`}>
                              <span className="client-attention-count">{item.count}</span>
                              <span className="client-attention-kind">{item.label}</span>
                            </Link>
                          ))}
                          {visibleWork.length > 2 && (
                            <Link href={`/clients/${client.id}/roles`} className="client-attention-more">
                              +{visibleWork.length - 1} more
                            </Link>
                          )}
                        </div>
                      ) : (
                        <span className="client-all-clear"><CheckCircle2 size={13} aria-hidden="true" />All clear</span>
                      )}
                    </td>
                    <td><time dateTime={client.created_at}>{date(client.created_at)}</time></td>
                    <td className="client-directory-actions">
                      <div className="client-row-actions">
                        <button type="button" disabled={busy} title={`${client.archived ? "Restore" : "Archive"} ${client.name}`} aria-label={`${client.archived ? "Restore" : "Archive"} ${client.name}`} onClick={() => void toggleArchive(client.id, !client.archived)}>{client.archived ? <ArchiveRestore size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}</button>
                        <Link href={`/clients/${client.id}`} title={`Open ${client.name}`} aria-label={`Open ${client.name}`}><ArrowRight size={16} aria-hidden="true" /></Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <TableDialog titleId="client-form-title" busy={busy} onClose={() => setCreating(false)}>
          <div className="modal-heading">
            <h2 id="client-form-title">Create client</h2>
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
              <input name="name" required maxLength={120} data-dialog-autofocus disabled={busy} />
            </label>
            <label>
              <span>Notes <span className="optional">optional</span></span>
              <textarea name="notes" rows={4} maxLength={4000} disabled={busy} />
            </label>
            <button disabled={busy} className="primary wide">
              {busy ? "Creating…" : "Create client"}
            </button>
          </form>
        </TableDialog>
      )}
    </AppShell>
  );
}
