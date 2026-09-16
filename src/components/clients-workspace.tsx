"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, FolderOpen, ListChecks, Plus, X } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import type { PageData } from "@/lib/types";

async function act<T>(action: string, payload: unknown): Promise<T> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not save the client.");
  return result;
}

const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// The directory is a standalone recruiting entry point. It intentionally
// contains only client discovery and creation, keeping campaign tooling out
// of the initial client-list bundle.
export function ClientsWorkspace({ data }: { data: PageData }) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clients = data.clients.filter((client) => showArchived || !client.archived);
  const workQueue = data.agencyWorkQueue ?? [];
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
      label: "Offers in progress",
      stage: "offer_sent",
      count: (item: (typeof workQueue)[number]) => item.offers_in_progress,
    },
  ] as const;
  const workTotal = workQueue.reduce(
    (sum, item) =>
      sum + item.due_follow_ups + item.client_review + item.offers_in_progress,
    0,
  );

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
      <header className="page-header">
        <div>
          <div className="eyebrow">Client directory</div>
          <h1>A workspace for every client</h1>
          <p className="muted">Open a client to manage its roles and candidate pipeline.</p>
        </div>
        <div className="header-actions">
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={17} />
            New client
          </button>
        </div>
      </header>
      {error && <p className="toast error" role="alert">{error}</p>}
      {workTotal > 0 && (
        <section className="today-work card" aria-labelledby="today-work-heading">
          <div className="section-heading">
            <div>
              <div className="today-work-title">
                <ListChecks size={18} aria-hidden="true" />
                <h2 id="today-work-heading">Today</h2>
                <span className="count">{workTotal}</span>
              </div>
              <p className="muted">Work that needs attention across active clients and roles.</p>
            </div>
          </div>
          <div className="today-work-grid">
            {workGroups.map((group) => {
              const items = workQueue.filter((item) => group.count(item) > 0);
              const total = items.reduce((sum, item) => sum + group.count(item), 0);
              return (
                <div className="today-work-group" key={group.key}>
                  <h3>{group.label}</h3>
                  {total ? (
                    <>
                      <strong className="today-work-total">{total}</strong>
                      <div className="today-work-items">
                        {items.map((item) => (
                          <Link
                            href={`/roles/${item.role_id}?stage=${group.stage}`}
                            key={item.role_id}
                          >
                            <strong>{group.count(item)}</strong>
                            <span>{item.client_name} · {item.role_name}</span>
                          </Link>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted">All clear</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div className="section-heading">
        <h2>
          Clients <span className="count">{clients.length}</span>
        </h2>
        <label className="check-label">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Include archived
        </label>
      </div>
      {!clients.length ? (
        <div className="card empty">
          <div className="empty-icon"><FolderOpen size={28} /></div>
          <h3>{data.clients.length ? "No active clients" : "Your first client starts here"}</h3>
          <p>{data.clients.length ? "Include archived clients to view them." : "Create a client, then add the roles you are hiring for."}</p>
          {!data.clients.length && (
            <button className="primary" onClick={() => setCreating(true)}>
              <Plus size={16} />
              Create your first client
            </button>
          )}
        </div>
      ) : (
        <div className="client-grid">
          {clients.map((client) => (
            <Link href={`/clients/${client.id}`} key={client.id} className="card client-card">
              <div className="client-card-top">
                <span className="client-monogram">{client.name.slice(0, 2).toUpperCase()}</span>
                {client.archived ? <span className="badge">Archived</span> : <ArrowRight size={18} />}
              </div>
              <h3>{client.name}</h3>
              <p className="muted">{client.notes || "No client notes yet."}</p>
              <small>Created {date(client.created_at)}</small>
            </Link>
          ))}
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
