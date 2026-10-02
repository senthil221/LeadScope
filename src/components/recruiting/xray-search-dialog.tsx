"use client";
import { useEffect, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import { TableDialog } from "./table-dialog";
import { buildXrayQuery, type XrayInputs, type XrayResult } from "@/lib/recruiting/xray";
type SavedSearch = { id: string; query: string; results: XrayResult[]; page?: number; country?: string };
export function XraySearchDialog({ roleId, roleName, onClose, onImported }: { roleId: string; roleName: string; onClose: () => void; onImported: () => void }) {
  const [inputs, setInputs] = useState<XrayInputs>({ titles: "", keywords: "", location: "", company: "", exclude: "" });
  const [custom, setCustom] = useState<string | null>(null), [country, setCountry] = useState("in");
  const [search, setSearch] = useState<SavedSearch | null>(null), [history, setHistory] = useState<SavedSearch[]>([]);
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const query = custom ?? buildXrayQuery(inputs);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/xray?role=${roleId}`, { signal: controller.signal }).then(async (response) => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setConfigured(result.configured); setHistory(result.searches);
    }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [roleId]);
  async function run(page = 1) {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/xray", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: roleId, query, country, page, token: crypto.randomUUID() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      const saved = { ...result, query, page, country }; setSearch(saved); setSelected([]);
      setHistory((previous) => [saved, ...previous].slice(0, 5));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function importSelected() {
    if (!search || busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/xray", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", role: roleId, search: search.id, urls: selected }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setMessage(`Imported ${result.created ?? 0} new profiles. ${result.alreadyInRole ?? 0} already on this role. ${result.blocked ?? 0} blocklisted profiles skipped.`);
      setSelected([]); onImported();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <TableDialog wide titleId="xray-title" busy={busy} onClose={onClose}>
    <div className="modal-head"><div><h2 id="xray-title">Google X-Ray search</h2><p className="muted">Find LinkedIn profiles for {roleName}</p></div><button disabled={busy} aria-label="Close X-Ray search" onClick={onClose}><X size={16} /></button></div>
    {configured === false && <p className="notice">Google search setup is pending. Your administrator needs to connect the Serper account.</p>}
    <form onSubmit={(e) => { e.preventDefault(); void run(); }}>
      <div className="enrichment-input-grid">
        {([['titles', 'Job titles / designations', 'SDR, Business Development'], ['keywords', 'Skills / keywords', 'cold email, cold call'], ['location', 'Location', 'Chennai'], ['company', 'Company / industry terms', 'B2B'], ['exclude', 'Exclude terms', 'intern, trainee']] as const).map(([field, label, placeholder]) => <label key={field}>{label}<input value={inputs[field]} placeholder={placeholder} maxLength={200} onChange={(e) => { setInputs({ ...inputs, [field]: e.target.value }); setCustom(null); }} /></label>)}
        <label>Google search country<select value={country} onChange={(e) => setCountry(e.target.value)}><option value="in">India</option><option value="us">United States</option><option value="gb">United Kingdom</option><option value="sg">Singapore</option><option value="ae">UAE</option><option value="ca">Canada</option><option value="au">Australia</option></select></label>
      </div>
      <label>Boolean query<textarea className="xray-query" value={query} maxLength={500} rows={2} onChange={(e) => setCustom(e.target.value)} /></label>
      <div className="enrichment-actions"><small className="muted">Comma-separated titles and keywords use OR. You can edit the full query.</small><button className="primary" disabled={busy || configured === false || query === "site:linkedin.com/in/"}><Search size={15} />{busy ? "Working…" : "Search profiles"}</button></div>
    </form>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    {history.length > 0 && <label>Recent searches<select value={search?.id ?? ""} onChange={(e) => { const saved = history.find((s) => s.id === e.target.value); if (saved) { setSearch(saved); setCustom(saved.query); setCountry(saved.country ?? "in"); setSelected([]); } }}><option value="">Choose saved results</option>{history.map((s) => <option key={s.id} value={s.id}>{s.query}</option>)}</select></label>}
    {search && <>
      <div className="enrichment-actions"><span>{search.results.length} profiles on this page</span><span className="muted">Google-indexed details. Review names and details before use.</span></div>
      <div className="enrichment-results"><table><thead><tr><th><input type="checkbox" aria-label="Select all X-Ray results" checked={search.results.length > 0 && selected.length === search.results.length} onChange={(e) => setSelected(e.target.checked ? search.results.map((r) => r.url) : [])} /></th><th>Profile</th><th>Search details</th><th>LinkedIn</th></tr></thead><tbody>{search.results.map((r) => <tr key={r.url}><td><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.includes(r.url)} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, r.url] : prev.filter((url) => url !== r.url))} /></td><td><strong>{r.name}</strong><small>{r.title}</small></td><td>{r.snippet || "No indexed description"}</td><td><a href={r.url} target="_blank" rel="noopener noreferrer">Open profile <ExternalLink size={12} /></a></td></tr>)}</tbody></table>{!search.results.length && <p className="muted">No LinkedIn profiles found. Try broader terms or another location.</p>}</div>
      <div className="enrichment-actions"><button disabled={busy || query !== search.query || country !== (search.country ?? "in") || (search.page ?? 1) >= 5 || configured === false} onClick={() => void run((search.page ?? 1) + 1)}>Search next page</button><button className="primary" disabled={busy || !selected.length} onClick={() => void importSelected()}>Import {selected.length || "selected"} to All Profiles</button></div>
    </>}
  </TableDialog>;
}
