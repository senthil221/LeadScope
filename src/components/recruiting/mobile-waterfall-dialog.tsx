"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import { TableDialog } from "./table-dialog";
import { emptyMobileResultLabel, mobileProviderLabels, mobileProviders, type MobileJob } from "@/lib/recruiting/mobile-waterfall";
import { formatMobile } from "@/lib/recruiting/contact";
const statusLabel: Record<string, string> = { queued: "Queued", running: "Looking up", waiting: "Waiting for provider", waiting_setup: "Provider setup / credits needed", needs_review: "Check request before retry", complete: "Complete", no_mobile: "0 phones found", failed: "Lookup failed", cancelled: "Cancelled" };
type Status = { jobs: MobileJob[]; total: number; workerOnline: boolean; providers: Record<string, boolean> };
export function MobileWaterfallDialog({ roleId, memberships = [], candidateId, onClose, onSaved, onQueued }: { roleId: string; memberships?: string[]; candidateId?: string; onClose: () => void; onSaved: () => void; onQueued: () => void }) {
  const [status, setStatus] = useState<Status | null>(null), [page, setPage] = useState(1), [collectAll, setCollectAll] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const seen = useRef(new Map<string, string>());
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  const load = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ role: roleId, page: String(page) }); if (candidateId) params.set("candidate", candidateId);
    const response = await fetch(`/api/mobile-waterfall?${params}`, { signal });
    const result: Status & { error?: string } = await response.json(); if (!response.ok) throw new Error(result.error);
    let changed = false;
    for (const job of result.jobs) { if (seen.current.has(job.id) && seen.current.get(job.id) !== job.updated_at && (job.results.length || job.status === "no_mobile")) changed = true; seen.current.set(job.id, job.updated_at); }
    setStatus(result); if (changed) onSavedRef.current();
  }, [roleId, page, candidateId]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => void load(controller.signal).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);
  async function post(payload: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mobile-waterfall", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: roleId, ...payload }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      if (payload.candidates || payload.memberships) setMessage(`${result.queued} lookups queued. ${result.alreadyRunning} already running. ${result.missingLinkedIn} missing a LinkedIn URL.`);
      onQueued();
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const targetIds = candidateId ? [candidateId] : memberships;
  return <TableDialog wide titleId="mobile-title" onClose={onClose}>
    <div className="modal-head"><div><h2 id="mobile-title">Mobile number waterfall</h2><p className="muted">Direct mobiles only. HQ and work landlines are excluded.</p></div><button aria-label="Close mobile lookup" onClick={onClose}><X size={16} /></button></div>
    <div className="mobile-provider-rail">{mobileProviders.map((provider, index) => <span key={provider}><b>{index + 1}</b>{mobileProviderLabels[provider]}<small>{status?.providers[provider] ? provider === "database" ? "Ready" : "Configured" : "Setup pending"}</small></span>)}</div>
    {status && !status.workerOnline && <p className="notice">The worker is offline. Queued lookups will resume when it starts.</p>}
    <div className="enrichment-actions"><label>Lookup mode<select value={collectAll ? "all" : "first"} onChange={(e) => setCollectAll(e.target.value === "all")}><option value="first">Stop at first source with mobiles</option><option value="all">Check every source for more mobiles</option></select></label><button className="primary" disabled={busy || !targetIds.length || targetIds.length > 200} onClick={() => void post({ ...(candidateId ? { candidates: [candidateId] } : { memberships }), collectAll })}>Start lookup{targetIds.length ? ` for ${targetIds.length} profile${targetIds.length === 1 ? "" : "s"}` : ""}</button></div>
    {!targetIds.length && <p className="muted">Select profiles in the table or use the lookup button in a phone cell to start a lookup.</p>}
    {targetIds.length > 200 && <p className="notice">Select up to 200 profiles per batch.</p>}
    <p className="muted">Lookups continue after this window or browser closes. Empty Mobile and Alternate cells are filled without replacing existing values. All additional mobiles stay in this results sheet. International mobiles are retained here; the current table accepts Indian ten-digit numbers.</p>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    <div className="enrichment-results"><table><thead><tr><th>Profile</th><th>Progress</th><th>Direct mobile numbers</th><th>Actions</th></tr></thead><tbody>{status?.jobs.map((job) => <tr key={job.id}><td><strong>{job.candidate_name}</strong><small>{new Date(job.created_at).toLocaleString()}</small></td><td><span className="badge">{statusLabel[job.status] ?? job.status}</span><small>{job.provider_index < 4 ? mobileProviderLabels[mobileProviders[job.provider_index]] : "All sources checked"}</small>{job.steps.map((step, index) => <small key={index}>{mobileProviderLabels[step.provider]}: {step.count} found{step.outcome === "error" ? ", provider error" : ""}</small>)}{job.error_code && <small>{job.error_code.replaceAll("_", " ")}</small>}</td><td>{job.results.length ? job.results.map((result) => <div className="mobile-result" key={result.number}><span>{formatMobile(result.number)}<small>{mobileProviderLabels[result.provider]}</small></span><button aria-label={`Copy ${result.number}`} onClick={() => void navigator.clipboard.writeText(result.number).then(() => setMessage("Number copied.")).catch(() => setError("Copy failed. Select and copy the number manually."))}><Copy size={13} /></button></div>) : <span className={job.status === "no_mobile" ? "phone-empty-result" : "muted"}>{emptyMobileResultLabel(job.status)}</span>}</td><td>{job.status === "needs_review" && <button disabled={busy} onClick={() => { if (window.confirm("The previous provider request may have been accepted and charged. Check your provider account before retrying. Submit another request?")) void post({ action: "retry", job: job.id }); }}>Retry request</button>}{!["complete", "no_mobile", "failed", "cancelled"].includes(job.status) && <button disabled={busy} onClick={() => void post({ action: "cancel", job: job.id })}>Cancel remaining steps</button>}</td></tr>)}</tbody></table>{status?.jobs.length === 0 && <p className="muted">No lookups yet. A lookup only starts when you press Start lookup.</p>}</div>
    <div className="enrichment-actions"><span className="muted">{status?.total ?? 0} lookups</span><div className="row"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button disabled={!status || page * 25 >= status.total} onClick={() => setPage(page + 1)}>Next</button></div></div>
  </TableDialog>;
}
