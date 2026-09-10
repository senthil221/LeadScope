"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import type { Client, Role } from "@/lib/types";
import { RoleFormDialog } from "./role-form";

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

const statusLabels: Record<string, string> = {
  open: "Open",
  on_hold: "On hold",
  closed: "Closed",
};

export function RolesPage({
  client,
  roles,
}: {
  client: Client;
  roles: Role[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<Role | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = roles.filter((r) => !r.archived);
  const archived = roles.filter((r) => r.archived);

  async function toggleArchive(role: Role) {
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

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">{client.name}</div>
          <h1>Roles</h1>
          <p className="muted">
            Each role has its own candidate pipeline, rating threshold, and
            client sharing.
          </p>
        </div>
        <div className="header-actions">
          <button className="primary" onClick={() => setForm("new")}>
            <Plus size={17} />
            New role
          </button>
        </div>
      </header>
      {error && (
        <p className="toast error" role="alert">
          {error}
        </p>
      )}
      <div className="section-heading">
        <h2>
          Open roles <span className="count">{active.length}</span>
        </h2>
      </div>
      <div className="card">
        {!active.length ? (
          <div className="empty">
            <h3>No roles yet</h3>
            <p>Create a role to start building its candidate pipeline.</p>
            <button className="primary" onClick={() => setForm("new")}>
              <Plus size={16} />
              Create your first role
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Rating threshold</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {active.map((role) => (
                  <tr key={role.id}>
                    <td>
                      <Link className="strong" href={`/roles/${role.id}`}>
                        {role.name}
                      </Link>
                      {role.description && (
                        <small>{role.description.slice(0, 100)}</small>
                      )}
                    </td>
                    <td>{role.rating_threshold} / 5</td>
                    <td>
                      <span className={`badge ${role.status}`}>
                        {statusLabels[role.status] ?? role.status}
                      </span>
                    </td>
                    <td>
                      <div className="row">
                        <button
                          className="small"
                          disabled={busy}
                          onClick={() => setForm(role)}
                        >
                          Edit
                        </button>
                        <button
                          className="small"
                          disabled={busy}
                          onClick={() => void toggleArchive(role)}
                        >
                          Archive
                        </button>
                        <Link
                          aria-label={`Open ${role.name}`}
                          href={`/roles/${role.id}`}
                        >
                          <ArrowRight size={17} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {archived.length > 0 && (
        <>
          <div className="section-heading">
            <h2>
              Archived roles <span className="count">{archived.length}</span>
            </h2>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Rating threshold</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {archived.map((role) => (
                  <tr key={role.id}>
                    <td>
                      <Link className="strong" href={`/roles/${role.id}`}>
                        {role.name}
                      </Link>
                    </td>
                    <td>{role.rating_threshold} / 5</td>
                    <td>
                      <button
                        className="small"
                        disabled={busy}
                        onClick={() => void toggleArchive(role)}
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {form && (
        <RoleFormDialog
          clientId={client.id}
          role={form}
          onClose={() => setForm(null)}
          onSaved={(id) => {
            setForm(null);
            router.push(`/roles/${id}`);
          }}
        />
      )}
    </>
  );
}
