"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import type { PageData, Role } from "@/lib/types";
import { RoleFormDialog } from "./role-form";
import { RecruiterTag, useRecruiters } from "./recruiter-select";
import { ROLE_STATUSES, ctcMaxLabel, roleAgeDays, roleStatusLabel } from "@/lib/recruiting/roles";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

function SortHeader({ label, field, sort, href, title }: { label: string; field: "ctc" | "age"; sort: string; href: string; title?: string }) {
  const direction = sort === `${field}_desc` ? "descending" : sort === `${field}_asc` ? "ascending" : "none";
  return <th aria-sort={direction} title={title}><Link className={`sort-header${direction !== "none" ? " is-on" : ""}`} href={href} scroll={false}>
    {label}{direction === "descending" ? <ArrowDown size={13} aria-hidden="true" /> : direction === "ascending" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowUpDown size={13} aria-hidden="true" />}
  </Link></th>;
}

export function AllRolesWorkspace({ data }: { data: PageData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState<Role | "new" | null>(null);
  const [newClient, setNewClient] = useState(params.get("client") ?? data.clients.find((c) => !c.archived)?.id ?? "");
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  const recruiters = useRecruiters();
  // A header click sorts high to low first, then flips; the URL holds it.
  const sort = params.get("sort") ?? "";
  function sortUrl(field: "ctc" | "age") {
    const p = new URLSearchParams(params);
    p.set("sort", sort === `${field}_desc` ? `${field}_asc` : `${field}_desc`);
    p.delete("page");
    return `/roles?${p}`;
  }
  // The filters go into the address without leaving the page, so the search
  // box keeps its focus and the sort stays as it was.
  const typing = useRef<number | undefined>(undefined);
  function apply(form: HTMLFormElement) {
    const next = new URLSearchParams();
    new FormData(form).forEach((value, key) => { const text = String(value).trim(); if (text) next.set(key, text); });
    const sortBy = params.get("sort"); if (sortBy) next.set("sort", sortBy);
    router.replace(next.size ? `/roles?${next}` : "/roles", { scroll: false });
  }
  function pageUrl(page: number) { const p = new URLSearchParams(params); p.set("page", String(page)); return `/roles?${p}`; }
  return <AppShell data={data}>
    <header className="page-header role-directory-header"><div><div className="eyebrow">Agency workspace</div><h1>Roles <span className="count">{data.total ?? 0}</span></h1><p className="muted">Every role across your clients, with recruiter ownership and hiring budget.</p></div>
      <div className="header-actions"><select aria-label="Client for new role" value={newClient} onChange={(e) => setNewClient(e.target.value)}>{data.clients.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="primary" disabled={!newClient} onClick={() => setForm("new")}>New role</button></div>
    </header>
    {/* Every filter applies as it changes; the search a moment after typing stops. */}
    <form className="directory-controls role-directory-filters" method="get" action="/roles" onSubmit={(e) => { e.preventDefault(); apply(e.currentTarget); }}>
      <input name="q" type="search" aria-label="Search all roles" placeholder="Search roles or CTC" defaultValue={params.get("q") ?? ""} onChange={(e) => { const form = e.currentTarget.form; window.clearTimeout(typing.current); typing.current = window.setTimeout(() => { if (form) apply(form); }, 350); }} />
      <select name="client" aria-label="Filter roles by client" defaultValue={params.get("client") ?? ""} onChange={(e) => { if (e.currentTarget.form) apply(e.currentTarget.form); }}><option value="">All clients</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select name="recruiter" aria-label="Filter roles by recruiter" defaultValue={params.get("recruiter") ?? ""} onChange={(e) => { if (e.currentTarget.form) apply(e.currentTarget.form); }}>
        <option value="">All recruiters</option>
        {(recruiters ?? []).filter((r) => !r.archived).map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
        <option value="__unassigned">Unassigned</option>
      </select>
      <select name="status" aria-label="Filter roles by status" defaultValue={params.get("status") ?? "open"} onChange={(e) => { if (e.currentTarget.form) apply(e.currentTarget.form); }}>
        {ROLE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        <option value="all">All statuses</option>
      </select>
      <button type="button" className="link-button" onClick={(e) => {
        const form = e.currentTarget.form; if (!form) return;
        for (const field of Array.from(form.elements) as HTMLInputElement[]) if (field.name) field.value = field.name === "status" ? "open" : "";
        router.replace("/roles", { scroll: false });
      }}>Clear</button>
    </form>
    <div className="card table-wrap role-directory-table"><table><thead><tr><th>Role</th><th>Client</th><th>Recruiter</th><SortHeader label="CTC" field="ctc" sort={sort} href={sortUrl("ctc")} /><SortHeader label="Age" field="age" sort={sort} href={sortUrl("age")} title="Days since the role opened" /><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {(data.roles ?? []).map((role) => <tr key={role.id}>
        <td><Link className="strong" href={`/roles/${role.id}`}>{role.name}</Link>{role.description && <small>{role.description.slice(0, 100)}</small>}</td>
        <td><Link className="badge" href={`/clients/${role.client_id}/roles`}>{clients.get(role.client_id)?.name ?? "Client"}</Link>{clients.get(role.client_id)?.archived && <small>Client archived</small>}</td>
        {/* Changed in Edit role; the list only shows who has it. */}
        <td><RecruiterTag name={role.recruiter_names?.[0] ?? ""} /></td>
        <td>{ctcMaxLabel(role) || <span className="muted">—</span>}</td>
        <td className="nowrap">{(() => { const days = roleAgeDays(role.opened_on); return days == null ? <span className="muted">—</span> : `${days} ${days === 1 ? "day" : "days"}`; })()}</td>
        <td><span className={`badge role-${role.status}`}>{roleStatusLabel(role.status)}</span></td>
        <td><button className="small" disabled={clients.get(role.client_id)?.archived} onClick={() => setForm(role)}>Edit</button></td>
      </tr>)}
      {!data.roles?.length && <tr><td colSpan={7}><div className="empty">No roles match this view.</div></td></tr>}
    </tbody></table></div>
    <div className="pagination"><span>{data.total ?? 0} roles</span><div className="row">{(data.page ?? 1) > 1 && <Link className="button small" href={pageUrl(data.page! - 1)}>Previous</Link>}{(data.page ?? 1) * 50 < (data.total ?? 0) && <Link className="button small" href={pageUrl((data.page ?? 1) + 1)}>Next</Link>}</div></div>
    {form && <RoleFormDialog role={form} clientId={form === "new" ? newClient : form.client_id} onClose={() => setForm(null)} onSaved={(id) => { const created = form === "new"; setForm(null); if (created) router.push(`/roles/${id}`); else router.refresh(); }} />}
  </AppShell>;
}
