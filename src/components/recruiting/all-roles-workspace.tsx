"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { act } from "@/lib/client/act";
import type { PageData, Role } from "@/lib/types";
import { RoleFormDialog } from "./role-form";

export function AllRolesWorkspace({ data }: { data: PageData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState<Role | "new" | null>(null);
  const [newClient, setNewClient] = useState(params.get("client") ?? data.clients.find((c) => !c.archived)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  function pageUrl(page: number) { const p = new URLSearchParams(params); p.set("page", String(page)); return `/roles?${p}`; }
  return <AppShell data={data}>
    <header className="page-header role-directory-header"><div><div className="eyebrow">Agency workspace</div><h1>Roles <span className="count">{data.total ?? 0}</span></h1><p className="muted">Every role across your clients, with recruiter ownership and hiring budget.</p></div>
      <div className="header-actions"><select aria-label="Client for new role" value={newClient} onChange={(e) => setNewClient(e.target.value)}>{data.clients.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="primary" disabled={!newClient} onClick={() => setForm("new")}>New role</button></div>
    </header>
    <form className="directory-controls role-directory-filters" method="get" action="/roles">
      <input name="q" type="search" aria-label="Search all roles" placeholder="Search roles or CTC" defaultValue={params.get("q") ?? ""} />
      <select name="client" aria-label="Filter roles by client" defaultValue={params.get("client") ?? ""}><option value="">All clients</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <input name="recruiter" aria-label="Recruiter name filter" placeholder="Recruiter name (exact tag)" defaultValue={params.get("recruiter") ?? ""} />
      <label className="row"><input name="archived" type="checkbox" value="1" defaultChecked={params.get("archived") === "1"} /> Include archived</label>
      <button>Apply</button><Link href="/roles">Clear</Link>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="card table-wrap role-directory-table"><table><thead><tr><th>Role</th><th>Client</th><th>Recruiter tags</th><th>CTC</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {(data.roles ?? []).map((role) => <tr key={role.id}>
        <td><Link className="strong" href={`/roles/${role.id}`}>{role.name}</Link>{role.description && <small>{role.description.slice(0, 100)}</small>}</td>
        <td><Link className="badge" href={`/clients/${role.client_id}/roles`}>{clients.get(role.client_id)?.name ?? "Client"}</Link>{clients.get(role.client_id)?.archived && <small>Client archived</small>}</td>
        <td><div className="role-tags">{(role.recruiter_names ?? []).map((name) => <span className="badge" key={name}>{name}</span>)}{!role.recruiter_names?.length && <span className="muted">Unassigned</span>}</div></td>
        <td>{role.ctc || <span className="muted">Not specified</span>}</td>
        <td><span className={`badge ${role.status}`}>{role.archived ? "Archived" : ({ open: "Open", on_hold: "On hold", closed: "Closed" })[role.status]}</span></td>
        <td><div className="row"><button className="small" disabled={busy || clients.get(role.client_id)?.archived} onClick={() => setForm(role)}>Edit</button><button className="small" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { await act("archiveRole", { id: role.id, archived: !role.archived }); router.refresh(); }
          catch (e) { setError((e as Error).message); }
          finally { setBusy(false); }
        }}>{role.archived ? "Restore" : "Archive"}</button></div></td>
      </tr>)}
      {!data.roles?.length && <tr><td colSpan={6}><div className="empty">No roles match this view.</div></td></tr>}
    </tbody></table></div>
    <div className="pagination"><span>{data.total ?? 0} roles</span><div className="row">{(data.page ?? 1) > 1 && <Link className="button small" href={pageUrl(data.page! - 1)}>Previous</Link>}{(data.page ?? 1) * 50 < (data.total ?? 0) && <Link className="button small" href={pageUrl((data.page ?? 1) + 1)}>Next</Link>}</div></div>
    {form && <RoleFormDialog role={form} clientId={form === "new" ? newClient : form.client_id} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); router.push(`/roles/${id}`); }} />}
  </AppShell>;
}
