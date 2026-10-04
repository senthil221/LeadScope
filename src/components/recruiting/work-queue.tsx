"use client";
import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import type { PageData } from "@/lib/types";
export type WorkItem = { role_id: string; client_id: string; role_name: string; client_name: string; recruiter_names: string[]; due: number; waiting_mobile: number; stale: number; client_review: number; unrated: number; setup_missing: number };
export function WorkQueue({ data }: { data: PageData }) {
  const [recruiter, setRecruiter] = useState("");
  const all = data.workbench ?? [];
  const names = [...new Set(all.flatMap((r) => r.recruiter_names))].sort();
  const rows = all.filter((r) => !recruiter || (recruiter === "unassigned" ? !r.recruiter_names.length : r.recruiter_names.includes(recruiter)));
  const metrics = [{ key: "due", label: "Follow-ups due" }, { key: "waiting_mobile", label: "Waiting for mobile" }, { key: "stale", label: "7+ days in stage" }, { key: "client_review", label: "Client shortlisted" }] as const;
  return <AppShell data={data}>
    <header className="page-header work-queue-header"><div><h1>Work queue</h1><p className="muted">Open roles, ordered by follow-ups due and profiles waiting for a mobile.</p></div><select aria-label="Work queue recruiter" value={recruiter} onChange={(e) => setRecruiter(e.target.value)}><option value="">All recruiters</option><option value="unassigned">Unassigned roles</option>{names.map((n) => <option key={n}>{n}</option>)}</select></header>
    {data.mobileHealth && <div className="work-health"><span className={data.mobileHealth.worker_online ? "" : "work-due"}>Mobile worker: {data.mobileHealth.worker_online ? "online" : "offline"}</span><span>{data.mobileHealth.active} active lookups</span><span>Last 24h: {data.mobileHealth.completed_today} with mobiles · {data.mobileHealth.empty_today} with no mobile</span>{data.mobileHealth.attention > 0 && <details><summary>{data.mobileHealth.attention} lookups need attention</summary><div><p>Open the role, then Actions → Mobile lookup results. Review provider status before retrying.</p>{data.mobileHealth.roles.map((r) => <Link key={r.id} href={`/roles/${r.id}`}>{r.name} · {r.jobs}</Link>)}</div></details>}</div>}
    <div className="work-metrics">{metrics.map((m) => <div key={m.key}><span>{m.label}</span><strong>{rows.reduce((sum, r) => sum + r[m.key], 0)}</strong></div>)}</div>
    <section className="card table-wrap work-queue"><table><thead><tr><th>Role / client</th><th>Recruiters</th>{metrics.map((m) => <th key={m.key}>{m.label}</th>)}<th>Needs rating</th><th>Role setup</th></tr></thead><tbody>{rows.map((r) => {
      const base = `/roles/${r.role_id}`;
      return <tr key={r.role_id}><td><Link href={base}>{r.role_name}</Link><small>{r.client_name}</small></td><td>{r.recruiter_names.join(", ") || <span className="muted">Unassigned</span>}</td>
        <td><Link className={r.due ? "work-due" : "muted"} href={`${base}?stage=follow_ups`}>{r.due}</Link></td>
        <td><Link href={`${base}?stage=profile_shortlisted&contact=missing`}>{r.waiting_mobile}</Link></td>
        <td><Link href={`${base}?stage=all_profiles&stale=1`}>{r.stale}</Link></td>
        <td><Link href={`${base}?stage=client_shortlisted`}>{r.client_review}</Link></td>
        <td><Link href={`${base}?stage=all_profiles&rating=unrated`}>{r.unrated}</Link></td>
        <td><Link href={base}>{r.setup_missing ? `${r.setup_missing} details missing` : "Complete"}</Link></td></tr>;
    })}</tbody></table>{!rows.length && <div className="empty">No open roles in this view.</div>}</section>
    <p className="muted">Role setup checks recruiter assignment, CTC, role brief and JD. The queue shows up to 200 open roles.</p>
  </AppShell>;
}
