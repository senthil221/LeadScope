"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Layers, Plus } from "lucide-react";
import type { Client, Role, RoleWorkQueueCount } from "@/lib/types";
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
  workQueueCounts,
}: {
  client: Client;
  roles: Role[];
  workQueueCounts: RoleWorkQueueCount[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<Role | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = roles.filter((r) => !r.archived);
  const archived = roles.filter((r) => r.archived);
  const workQueueByRole = new Map(
    workQueueCounts.map((count) => [count.role_id, count]),
  );

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
            Choose a role to review candidates, shortlist them, and prepare
            profiles for your client.
          </p>
        </div>
        <div className="header-actions">
          <Link className="button" href={`/clients/${client.id}/campaigns`}>
            <Layers size={16} />
            Campaigns
          </Link>
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
          Roles <span className="count">{active.length}</span>
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
                  <th>Work to do</th>
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
                    <td>
                      {(() => {
                        const count = workQueueByRole.get(role.id);
                        const items = [
                          ["New profiles", count?.new_profiles ?? 0, "all_profiles"],
                          ["Client review", count?.client_review ?? 0, "client_shortlisted"],
                          ["Due follow-ups", count?.due_follow_ups ?? 0, "follow_ups"],
                          ["Offers", count?.offers_in_progress ?? 0, "offer_sent"],
                        ] as const;
                        return (
                          <div className="role-work-queue">
                            {items.map(([label, value, stage]) => (
                              <Link key={stage} href={`/roles/${role.id}?stage=${stage}`}>
                                <strong>{value}</strong>
                                <span>{label}</span>
                              </Link>
                            ))}
                          </div>
                        );
                      })()}
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
