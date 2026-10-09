"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import type { PageData, Role } from "@/lib/types";
import { RoleFormDialog } from "./role-form";
import { RecruiterTag, useRecruiters } from "./recruiter-select";
import { ROLE_STATUSES, ctcMaxLabel, roleAgeDays, roleStatusLabel } from "@/lib/recruiting/roles";
import { formatRecruitingDate } from "@/lib/recruiting/display";

export function AllRolesWorkspace({ data }: { data: PageData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState<Role | "new" | null>(null);
  const [newClient, setNewClient] = useState(params.get("client") ?? data.clients.find((c) => !c.archived)?.id ?? "");
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  const recruiters = useRecruiters();
  function pageUrl(page: number) { const p = new URLSearchParams(params); p.set("page", String(page)); return `/roles?${p}`; }
  return <AppShell data={data}>
    <header className="page-header role-directory-header"><div><div className="eyebrow">Agency workspace</div><h1>Roles <span className="count">{data.total ?? 0}</span></h1><p className="muted">Every role across your clients, with recruiter ownership and hiring budget.</p></div>
      <div className="header-actions"><select aria-label="Client for new role" value={newClient} onChange={(e) => setNewClient(e.target.value)}>{data.clients.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="primary" disabled={!newClient} onClick={() => setForm("new")}>New role</button></div>
    </header>
    <form className="directory-controls role-directory-filters" method="get" action="/roles">
      <input name="q" type="search" aria-label="Search all roles" placeholder="Search roles or CTC" defaultValue={params.get("q") ?? ""} />
      <select name="client" aria-label="Filter roles by client" defaultValue={params.get("client") ?? ""}><option value="">All clients</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select name="recruiter" aria-label="Filter roles by recruiter" defaultValue={params.get("recruiter") ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        <option value="">All recruiters</option>
        {(recruiters ?? []).filter((r) => !r.archived).map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
        <option value="__unassigned">Unassigned</option>
      </select>
      <select name="status" aria-label="Filter roles by status" defaultValue={params.get("status") ?? "open"} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {ROLE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        <option value="all">All statuses</option>
      </select>
      <button>Apply</button><Link href="/roles">Clear</Link>
    </form>
    <div className="card table-wrap role-directory-table"><table><thead><tr><th>Role</th><th>Client</th><th>Recruiter</th><th>CTC</th><th>Opened</th><th title="Days since the role opened">Age</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {(data.roles ?? []).map((role) => <tr key={role.id}>
        <td><Link className="strong" href={`/roles/${role.id}`}>{role.name}</Link>{role.description && <small>{role.description.slice(0, 100)}</small>}</td>
        <td><Link className="badge" href={`/clients/${role.client_id}/roles`}>{clients.get(role.client_id)?.name ?? "Client"}</Link>{clients.get(role.client_id)?.archived && <small>Client archived</small>}</td>
        {/* Changed in Edit role; the list only shows who has it. */}
        <td><RecruiterTag name={role.recruiter_names?.[0] ?? ""} /></td>
        <td>{ctcMaxLabel(role) || <span className="muted">—</span>}</td>
        <td className="nowrap">{role.opened_on ? formatRecruitingDate(role.opened_on) : <span className="muted">—</span>}</td>
        <td className="nowrap">{(() => { const days = roleAgeDays(role.opened_on); return days == null ? <span className="muted">—</span> : `${days} ${days === 1 ? "day" : "days"}`; })()}</td>
        <td><span className={`badge role-${role.status}`}>{roleStatusLabel(role.status)}</span></td>
        <td><button className="small" disabled={clients.get(role.client_id)?.archived} onClick={() => setForm(role)}>Edit</button></td>
      </tr>)}
      {!data.roles?.length && <tr><td colSpan={8}><div className="empty">No roles match this view.</div></td></tr>}
    </tbody></table></div>
    <div className="pagination"><span>{data.total ?? 0} roles</span><div className="row">{(data.page ?? 1) > 1 && <Link className="button small" href={pageUrl(data.page! - 1)}>Previous</Link>}{(data.page ?? 1) * 50 < (data.total ?? 0) && <Link className="button small" href={pageUrl((data.page ?? 1) + 1)}>Next</Link>}</div></div>
    {form && <RoleFormDialog role={form} clientId={form === "new" ? newClient : form.client_id} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); router.push(`/roles/${id}`); }} />}
  </AppShell>;
}
