"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import type { Client, Role, RoleDashboardCount } from "@/lib/types";
import { RoleFormDialog } from "./role-form";
import { act as sharedAct } from "@/lib/client/act";

function act<T = { id: string }>(action: string, payload: unknown = {}): Promise<T> {
  return sharedAct<T>(action, payload);
}

const statusLabels: Record<string, string> = {
  open: "Open",
  on_hold: "On hold",
  closed: "Closed",
};

export function RolesPage({
  client,
  roles,
  dashboardCounts,
}: {
  client: Client;
  roles: Role[];
  dashboardCounts: RoleDashboardCount[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<Role | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = roles.filter((r) => !r.archived && r.status !== "closed");
  const closed = roles.filter((r) => !r.archived && r.status === "closed");
  const archived = roles.filter((r) => r.archived);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (role: Role) =>
    !normalizedQuery ||
    role.name.toLocaleLowerCase().includes(normalizedQuery) ||
    role.description.toLocaleLowerCase().includes(normalizedQuery);
  const visibleActive = active.filter(matchesQuery);
  const visibleClosed = closed.filter(matchesQuery);
  const visibleArchived = archived.filter(matchesQuery);
  const dashboardByRole = new Map(
    dashboardCounts.map((count) => [count.role_id, count]),
  );
  const activeRoleIds = new Set(active.map((role) => role.id));
  const totals = dashboardCounts.filter((count) => activeRoleIds.has(count.role_id)).reduce(
    (sum, count) => ({
      allProfiles: sum.allProfiles + count.all_profiles,
      recruiter: sum.recruiter + count.recruiter_shortlisted,
      client: sum.client + count.client_shortlisted,
      followUps: sum.followUps + count.due_follow_ups,
      offers: sum.offers + count.offers_in_progress,
    }),
    { allProfiles: 0, recruiter: 0, client: 0, followUps: 0, offers: 0 },
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
          <h1>Client overview</h1>
          <p className="muted">See role progress, open work, and the next hiring action in one place.</p>
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
      <section className="role-dashboard-summary" aria-label="Role work summary">
        <div>
          <strong>{active.length}</strong>
          <span>current roles</span>
        </div>
        <div>
          <strong>{totals.allProfiles}</strong>
          <span>all profiles</span>
        </div>
        <div>
          <strong>{totals.recruiter}</strong>
          <span>recruiter review</span>
        </div>
        <div>
          <strong>{totals.client}</strong>
          <span>client review</span>
        </div>
        <div>
          <strong>{totals.followUps}</strong>
          <span>due follow-ups</span>
        </div>
        <div>
          <strong>{totals.offers}</strong>
          <span>active offers</span>
        </div>
      </section>
      <div className="section-heading">
        <h2>
          Current roles <span className="count">{visibleActive.length}</span>
        </h2>
        <div className="directory-controls">
          <input
            aria-label="Search roles"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search roles"
            type="search"
            value={query}
          />
        </div>
      </div>
      <div className="card">
        {!visibleActive.length ? (
          <div className="empty">
            <h3>
              {normalizedQuery
                ? "No current roles match that search"
                : roles.length
                  ? "No current roles"
                  : "No roles yet"}
            </h3>
            <p>
              {normalizedQuery
                ? "Try a role name or a word from its description."
                : roles.length
                  ? "Reopen a closed role or create a new one to continue hiring."
                  : "Create a role to start building its candidate pipeline."}
            </p>
            {!normalizedQuery && (
              <button className="primary" onClick={() => setForm("new")}>
                <Plus size={16} />
                Create your first role
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Pipeline</th>
                  <th>Needs attention</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleActive.map((role) => (
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
                        const count = dashboardByRole.get(role.id);
                        const stages = [
                          ["All", count?.all_profiles ?? 0, "all_profiles"],
                          ["Profile", count?.profile_shortlisted ?? 0, "profile_shortlisted"],
                          ["Recruiter", count?.recruiter_shortlisted ?? 0, "recruiter_shortlisted"],
                          ["Client", count?.client_shortlisted ?? 0, "client_shortlisted"],
                          ["Offer", count?.offer_sent ?? 0, "offer_sent"],
                          ["Rejected", count?.rejected ?? 0, "rejected"],
                        ] as const;
                        return (
                          <div className="role-pipeline-counts">
                            {stages.map(([label, value, stage]) => (
                              <Link key={stage} href={`/roles/${role.id}?stage=${stage}`}>
                                <strong>{value}</strong>
                                <span>{label}</span>
                              </Link>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const count = dashboardByRole.get(role.id);
                        const items = [
                          ["Client review", count?.client_shortlisted ?? 0, "client_shortlisted"],
                          ["Follow-ups", count?.due_follow_ups ?? 0, "follow_ups"],
                          ["Offers", count?.offers_in_progress ?? 0, "offer_sent"],
                        ] as const;
                        const actionable = items.filter(([, value]) => value > 0);
                        return (
                          actionable.length ? <div className="role-attention-links">
                            {actionable.map(([label, value, stage]) => (
                              <Link key={stage} href={`/roles/${role.id}?stage=${stage}`}>
                                <strong>{value}</strong> {label.toLowerCase()}
                              </Link>
                            ))}
                          </div> : <span className="role-all-clear">All clear</span>
                        );
                      })()}
                    </td>
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
      {visibleClosed.length > 0 && (
        <>
          <div className="section-heading">
            <h2>
              Closed roles <span className="count">{visibleClosed.length}</span>
            </h2>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleClosed.map((role) => (
                  <tr key={role.id}>
                    <td>
                      <Link className="strong" href={`/roles/${role.id}`}>
                        {role.name}
                      </Link>
                      {role.description && <small>{role.description.slice(0, 100)}</small>}
                    </td>
                    <td><span className="badge closed">Closed</span></td>
                    <td>
                      <button className="small" disabled={busy} onClick={() => setForm(role)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {visibleArchived.length > 0 && (
        <>
          <div className="section-heading">
            <h2>
              Archived roles <span className="count">{visibleArchived.length}</span>
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
                {visibleArchived.map((role) => (
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
