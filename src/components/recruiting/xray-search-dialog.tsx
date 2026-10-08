"use client";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import { TableDialog } from "./table-dialog";
import { addsNobody, buildXrayQuery, lastPage, runResults, savedRuns, type XrayInputs, type XrayPage, type XrayResult, type XrayRun } from "@/lib/recruiting/xray";
type Known = { inRole: string[]; blocked: string[] };
type Saved = XrayPage & { query: string; country: string; created_at: string };
const MAX_PAGE = 10;
const PAGE_CHOICES = [1, 2, 3, 5, 10];
async function post<T>(payload: unknown): Promise<T> {
  const response = await fetch("/api/xray", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error);
  return result;
}
export function XraySearchDialog({ roleId, roleName, onClose, onImported }: { roleId: string; roleName: string; onClose: () => void; onImported: () => void }) {
  const [inputs, setInputs] = useState<XrayInputs>({ titles: "", keywords: "", location: "", company: "", exclude: "" });
  const [custom, setCustom] = useState<string | null>(null), [country, setCountry] = useState("in"), [pages, setPages] = useState(3);
  const [run, setRun] = useState<XrayRun | null>(null), [history, setHistory] = useState<XrayRun[]>([]);
  const [inRole, setInRole] = useState<Set<string>>(new Set()), [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set()), [showKnown, setShowKnown] = useState(false);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null), [credits, setCredits] = useState(0);
  const query = custom ?? buildXrayQuery(inputs);
  const remember = (known: Known) => {
    setInRole((previous) => new Set([...previous, ...known.inRole]));
    setBlocked((previous) => new Set([...previous, ...known.blocked]));
  };
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/xray?role=${roleId}`, { signal: controller.signal }).then(async (response) => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setConfigured(result.configured); setHistory(savedRuns(result.searches as Saved[]));
      setInRole(new Set(result.known.inRole)); setBlocked(new Set(result.known.blocked));
    }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [roleId]);

  const results = useMemo(() => (run ? runResults(run) : []), [run]);
  const isNew = (url: string) => !inRole.has(url) && !blocked.has(url);
  const fresh = results.filter((r) => isNew(r.url));
  const shown = showKnown ? results : fresh;
  const fetched = run ? lastPage(run) : 0;
  const sameSearch = run !== null && run.query === query && run.country === country;

  // Fetch pages one after another, stopping as soon as Google has nobody new.
  async function fetchPages(start: XrayRun, from: number) {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    const until = Math.min(MAX_PAGE, from + pages - 1);
    let current = start;
    try {
      for (let page = from; page <= until; page += 1) {
        setProgress(`Fetching page ${page} of ${until}…`);
        const result = await post<{ id: string; results: XrayResult[]; reused: boolean; known: Known }>({ role: roleId, query: current.query, country: current.country, page, token: crypto.randomUUID() });
        remember(result.known);
        if (!result.reused) setCredits((n) => n + 1);
        const exhausted = result.results.length === 0 || addsNobody(current, result.results);
        current = { ...current, pages: [...current.pages.filter((p) => p.page !== page), { id: result.id, page, results: result.results }], exhausted };
        setRun(current);
        // New people are picked by default; the recruiter unticks who they do not want.
        const known = new Set([...result.known.inRole, ...result.known.blocked]);
        setSelected((previous) => new Set([...previous, ...result.results.map((r) => r.url).filter((url) => !known.has(url) && !inRole.has(url) && !blocked.has(url))]));
        if (exhausted) break;
      }
      setHistory((previous) => [current, ...previous.filter((r) => r.query !== current.query || r.country !== current.country)].slice(0, 6));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); setProgress(""); }
  }
  function search() {
    setSelected(new Set());
    void fetchPages({ query, country, pages: [], exhausted: false }, 1);
  }
  async function importSelected() {
    if (!run || busy) return;
    const urls = results.map((r) => r.url).filter((url) => selected.has(url) && isNew(url));
    if (!urls.length) return;
    setBusy(true); setError("");
    try {
      const result = await post<{ created?: number; alreadyInRole?: number; blocked?: number }>({ action: "import", role: roleId, searches: run.pages.map((p) => p.id), urls });
      setMessage(`Imported ${result.created ?? 0} new profiles.${result.alreadyInRole ? ` ${result.alreadyInRole} were already on this role.` : ""}${result.blocked ? ` ${result.blocked} blocklisted skipped.` : ""}`);
      setInRole((previous) => new Set([...previous, ...urls])); setSelected(new Set()); onImported();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const picked = fresh.filter((r) => selected.has(r.url)).length;
  const knownCount = results.length - fresh.length;

  return <TableDialog wide titleId="xray-title" busy={busy} onClose={onClose}>
    <div className="modal-head"><div><h2 id="xray-title">Google X-Ray search</h2><p className="muted">Find LinkedIn profiles for {roleName}</p></div><button disabled={busy} aria-label="Close X-Ray search" onClick={onClose}><X size={16} /></button></div>
    {configured === false && <p className="notice">Google search setup is pending. Your administrator needs to connect the Serper account.</p>}
    <form onSubmit={(e) => { e.preventDefault(); search(); }}>
      <div className="enrichment-input-grid">
        {([['titles', 'Job titles / designations', 'SDR, Business Development'], ['keywords', 'Skills / keywords', 'cold email, cold call'], ['location', 'Location', 'Chennai'], ['company', 'Company / industry terms', 'B2B'], ['exclude', 'Exclude terms', 'intern, trainee']] as const).map(([field, label, placeholder]) => <label key={field}>{label}<input value={inputs[field]} placeholder={placeholder} maxLength={200} onChange={(e) => { setInputs({ ...inputs, [field]: e.target.value }); setCustom(null); }} /></label>)}
        <label>Google search country<select value={country} onChange={(e) => setCountry(e.target.value)}><option value="in">India</option><option value="us">United States</option><option value="gb">United Kingdom</option><option value="sg">Singapore</option><option value="ae">UAE</option><option value="ca">Canada</option><option value="au">Australia</option></select></label>
      </div>
      <label>Boolean query<textarea className="xray-query" value={query} maxLength={500} rows={2} onChange={(e) => setCustom(e.target.value)} /></label>
      <div className="enrichment-actions">
        <label className="xray-pages">Pages to fetch<select value={pages} onChange={(e) => setPages(Number(e.target.value))}>{PAGE_CHOICES.map((n) => <option key={n} value={n}>{n === MAX_PAGE ? "10 (all Google shows)" : n}</option>)}</select></label>
        <small className="muted">Up to {pages} {pages === 1 ? "credit" : "credits"}, 10 profiles a page. Stops early when Google runs out; pages fetched in the last day are free.</small>
        <button className="primary" disabled={busy || configured === false || query === "site:linkedin.com/in/"}><Search size={15} />{busy ? progress || "Working…" : "Search profiles"}</button>
      </div>
    </form>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    {history.length > 0 && <label>Recent searches<select value={run ? history.findIndex((r) => r.query === run.query && r.country === run.country) : -1} onChange={(e) => { const saved = history[Number(e.target.value)]; if (saved) { setRun(saved); setCustom(saved.query); setCountry(saved.country); setSelected(new Set(runResults(saved).map((r) => r.url).filter(isNew))); setMessage(""); } }}><option value={-1}>Choose saved results</option>{history.map((r, i) => <option key={`${r.country}:${r.query}`} value={i}>{r.query} · {lastPage(r)} {lastPage(r) === 1 ? "page" : "pages"}</option>)}</select></label>}
    {run && <>
      <div className="enrichment-actions xray-summary" role="status">
        <span><strong>{fresh.length} new</strong> of {results.length} unique profiles from {fetched} {fetched === 1 ? "page" : "pages"}{knownCount > 0 && <> · {knownCount} already on this role or blocklisted</>}{run.exhausted && <> · Google has no more results</>}</span>
        {credits > 0 && <span className="muted">{credits} {credits === 1 ? "credit" : "credits"} used</span>}
        {knownCount > 0 && <label className="xray-show-known"><input type="checkbox" checked={showKnown} onChange={(e) => setShowKnown(e.target.checked)} />Show profiles already here</label>}
      </div>
      <div className="enrichment-results"><table><thead><tr><th><input type="checkbox" aria-label="Select all new X-Ray results" checked={fresh.length > 0 && picked === fresh.length} onChange={(e) => setSelected(e.target.checked ? new Set(fresh.map((r) => r.url)) : new Set())} /></th><th>Profile</th><th>Search details</th><th>LinkedIn</th></tr></thead>
        <tbody>{shown.map((r) => {
          const status = inRole.has(r.url) ? "Already on this role" : blocked.has(r.url) ? "Blocklisted" : null;
          return <tr key={r.url} className={status ? "xray-known" : undefined}>
            <td><input type="checkbox" aria-label={`Select ${r.name}`} disabled={Boolean(status)} checked={!status && selected.has(r.url)} onChange={(e) => setSelected((previous) => { const next = new Set(previous); if (e.target.checked) next.add(r.url); else next.delete(r.url); return next; })} /></td>
            <td><strong>{r.name}</strong>{status && <span className="xray-badge">{status}</span>}<small>{r.title}</small></td>
            <td>{r.snippet || "No indexed description"}</td>
            <td><a href={r.url} target="_blank" rel="noopener noreferrer">Open profile <ExternalLink size={12} /></a></td>
          </tr>;
        })}</tbody></table>
        {!results.length && <p className="muted">No LinkedIn profiles found. Try broader terms or another location.</p>}
        {results.length > 0 && !shown.length && <p className="muted">Everyone found is already on this role. Fetch more pages or change the search.</p>}
      </div>
      <div className="enrichment-actions">
        <button disabled={busy || !sameSearch || run.exhausted || fetched >= MAX_PAGE || configured === false} onClick={() => void fetchPages(run, fetched + 1)}>{run.exhausted ? "No more pages" : fetched >= MAX_PAGE ? "All 10 pages fetched" : `Fetch ${Math.min(pages, MAX_PAGE - fetched)} more ${Math.min(pages, MAX_PAGE - fetched) === 1 ? "page" : "pages"}`}</button>
        <button className="primary" disabled={busy || !picked} onClick={() => void importSelected()}>{picked && picked === fresh.length ? `Import all ${picked} new to All Profiles` : `Import ${picked || "selected"} to All Profiles`}</button>
      </div>
    </>}
  </TableDialog>;
}
