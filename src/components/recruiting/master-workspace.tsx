"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import type { PageData } from "@/lib/types";
import { formatMobile } from "@/lib/recruiting/contact";
import styles from "./master-workspace.module.css";
import { formatRecruitingDate } from "@/lib/recruiting/display";
import { DialogLoading } from "./table-dialog";
const PushProfilesDialog = dynamic(() => import("./push-profiles-dialog").then((m) => m.PushProfilesDialog), { loading: DialogLoading });

export function MasterWorkspace({ data }: { data: PageData }) {
  const params = useSearchParams();
  const rows = data.masterCandidates ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [pushing, setPushing] = useState(false);
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("");
  const page = data.page ?? 1, total = data.total ?? 0;
  function pageUrl(next: number) { const query = new URLSearchParams(params); query.set("page", String(next)); return `/master-db?${query}`; }
  const columns = ["Full name", "LinkedIn", "Headline", "Mobile", "Alternate", "Email", "Location", "Company", "Designation", "Experience", "CTC", "Qualification", "Resume", "Added"];
  const widths = [42, 230, 130, 250, 140, 140, 220, 180, 200, 180, 115, 140, 190, 110, 140];
  return <AppShell data={data}>
    <header className="page-header"><div><div className="eyebrow">Agency workspace</div><h1>Master Database <span className="count">{total.toLocaleString("en-US")}</span></h1><p className="muted">Every agency profile in one place. Shared contact details, with ratings specific to each role.</p></div></header>
    <section className={styles.sheet} aria-label="Master Database profiles">
    <form action="/master-db" className="sheet-toolbar"><input name="q" aria-label="Search Master Database" placeholder="Search name, company, email or phone" defaultValue={params.get("q") ?? ""} maxLength={200} /><button className="primary">Search</button><Link href="/master-db">Clear</Link></form>
    {message && <p className="notice" role="status">{message} {target && <Link href={`/roles/${target}`}>Open target role</Link>}</p>}
    {selected.length > 0 && <div className="bulk-bar"><strong>{selected.length} selected</strong><button className="primary" onClick={() => setPushing(true)}>Push to role</button><button onClick={() => setSelected([])}>Clear selection</button></div>}
    <div className={`sheet-table-frame master-frame ${styles.frame}`} tabIndex={0} role="region" aria-label="Master candidate table, scroll to see more columns"><table className="sheet-table master-table" style={{ width: widths.reduce((sum, width) => sum + width, 0) }}>
      <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <thead><tr><th scope="col"><input type="checkbox" aria-label="Select all visible profiles" checked={rows.length > 0 && selected.length === rows.length} onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} /></th>{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
      <tbody>{rows.map((row) => { const linkedin = row.candidate_identities?.find((identity) => identity.kind === "linkedin")?.normalized_value;
        return <tr key={row.id} className={selected.includes(row.id) ? "selected-row" : ""}>
          <td><input type="checkbox" aria-label={`Select ${row.full_name}`} checked={selected.includes(row.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, row.id] : ids.filter((id) => id !== row.id))} /></td>
          <td title={row.full_name}>{row.full_name}</td><td>{linkedin ? <a href={linkedin} target="_blank" rel="noreferrer">Open profile</a> : <span className="muted">Not provided</span>}</td>
          {[row.headline, row.phone ? formatMobile(row.phone) : "", row.alternate_phone ? formatMobile(row.alternate_phone) : "", row.email, row.location, row.current_company, row.current_designation, row.total_experience_years == null ? "" : `${row.total_experience_years} yrs`, row.current_ctc, row.highest_qualification].map((value, index) => <td key={index} title={value || ""}>{value || <span className="muted">Not provided</span>}</td>)}
          <td>{row.resume_path ? <MasterResume candidateId={row.id} /> : <span className="muted">Not provided</span>}</td>
          <td>{formatRecruitingDate(row.created_at)}</td>
        </tr>;
      })}</tbody>
    </table>{!rows.length && <div className="empty"><h3>No matching profiles</h3><p>Profiles added to any role appear here automatically.</p></div>}</div>
    <div className="sheet-footer"><span>{total ? `${(page - 1) * 50 + 1}–${Math.min(page * 50, total)} of ${total}` : "0 profiles"}</span><div className="row">{page > 1 && <Link className="button small" href={pageUrl(page - 1)}>Previous</Link>}{page * 50 < total && <Link className="button small" href={pageUrl(page + 1)}>Next</Link>}</div></div>
    </section>
    {pushing && <PushProfilesDialog candidateIds={selected} onClose={() => setPushing(false)} onPushed={(result, roleId) => { setPushing(false); setSelected([]); setTarget(roleId); setMessage(`${result.added} profiles added. ${result.alreadyInRole} already in the target role.`); }} />}
  </AppShell>;
}
function MasterResume({ candidateId }: { candidateId: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function open() {
    if (busy) return;
    setBusy(true); setError("");
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try { const response = await fetch(`/api/resume?candidateId=${candidateId}`); const result = await response.json(); if (!response.ok) throw new Error(result.error); if (tab) tab.location.href = result.url; else window.location.assign(result.url); }
    catch (reason) { tab?.close(); setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <><button className="small" disabled={busy} onClick={() => void open()}>{busy ? "Opening…" : "Open"}</button>{error && <small role="alert" className="error">{error}</small>}</>;
}
