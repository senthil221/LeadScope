"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { act } from "@/lib/client/act";
import type { PageData } from "@/lib/types";
import { TableDialog } from "./table-dialog";
import { formatRecruitingDate } from "@/lib/recruiting/display";

export function BlocklistWorkspace({ data }: { data: PageData }) {
  const router = useRouter(); const params = useSearchParams();
  const clientId = params.get("client") || null;
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  function url(page: number) { const p = new URLSearchParams(params); p.set("page", String(page)); return `/blocklist?${p}`; }
  return <AppShell data={data}>
    <header className="page-header role-directory-header"><div><div className="eyebrow">{clientId ? data.clients.find((c) => c.id === clientId)?.name : "Agency-wide"}</div><h1>Blocklist</h1><p className="muted">Prevent LinkedIn profiles from being added or pushed into {clientId ? "this client's roles" : "any client's roles"}. Existing memberships stay saved. Global rules also apply to every client.</p></div></header>
    <form className="directory-controls role-directory-filters" method="get" action="/blocklist"><select name="client" aria-label="Blocklist scope" defaultValue={clientId ?? ""}><option value="">Global blocklist</option>{data.clients.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select><input name="q" type="search" aria-label="Search blocked LinkedIn URLs" placeholder="Search LinkedIn URL" defaultValue={params.get("q") ?? ""} /><button>Open scope</button></form>
    <details className="role-brief"><summary>Add LinkedIn URLs</summary><form className="role-brief-content" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return;
      const form = event.currentTarget; const values = new FormData(form);
      setBusy(true); setError(""); setMessage("");
      try {
        const urls = String(values.get("urls")).split(/[\s,;]+/).filter(Boolean);
        const result = await act<{ changed: number }>("blocklist", { clientId, urls, note: String(values.get("note") ?? "") });
        setMessage(`${result.changed} profile URL(s) added.`); form.reset(); router.refresh();
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}><label>LinkedIn profile URLs<textarea name="urls" rows={5} required maxLength={100000} placeholder="Paste one LinkedIn profile URL per line (up to 200)." disabled={busy} /></label><label>Reason or note<textarea name="note" maxLength={4000} rows={2} disabled={busy} /></label><button className="primary" disabled={busy}>{busy ? "Saving…" : `Add to ${clientId ? "client" : "global"} blocklist`}</button></form></details>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="card table-wrap blocklist-table"><table><thead><tr><th>LinkedIn profile</th><th>Note</th><th>Added</th><th>Actions</th></tr></thead><tbody>{(data.blocklist ?? []).map((entry) => <tr key={entry.id}><td><a href={entry.linkedin_url} target="_blank" rel="noreferrer">{entry.linkedin_url.replace("https://www.", "")}</a></td><td>{entry.note || "No note"}</td><td>{formatRecruitingDate(entry.created_at)}</td><td><button className="small" disabled={busy} onClick={() => setRemoving(entry.id)}>Remove</button></td></tr>)}{!data.blocklist?.length && <tr><td colSpan={4}><div className="empty">No blocked profiles in this scope.</div></td></tr>}</tbody></table></div>
    <div className="pagination"><span>{data.total ?? 0} blocked profiles</span><div className="row">{(data.page ?? 1) > 1 && <Link className="button small" href={url(data.page! - 1)}>Previous</Link>}{(data.page ?? 1) * 50 < (data.total ?? 0) && <Link className="button small" href={url((data.page ?? 1) + 1)}>Next</Link>}</div></div>
    {removing && <TableDialog titleId="remove-block-title" busy={busy} onClose={() => setRemoving(null)}><h2 id="remove-block-title">Remove this blocklist entry?</h2><p>This allows the profile to be added to roles in this scope unless another applicable block remains.</p><div className="row"><button disabled={busy} onClick={() => setRemoving(null)}>Cancel</button><button className="primary" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await act("blocklist", { clientId, removeId: removing }); setRemoving(null); router.refresh(); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>Remove entry</button></div></TableDialog>}
  </AppShell>;
}
