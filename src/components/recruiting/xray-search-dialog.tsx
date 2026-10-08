"use client";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Save, Search, Trash2, X } from "lucide-react";
import { TableDialog } from "./table-dialog";
import { addsNobody, batchResults, lastPage, runResults, savedRuns, xrayVariations, MAX_VARIATIONS, type XrayInputs, type XrayPage, type XrayResult, type XrayRun, type XraySplit } from "@/lib/recruiting/xray";
type Known = { inRole: string[]; blocked: string[] };
type Saved = XrayPage & { query: string; country: string; created_at: string };
type Template = { id: string; name: string; inputs: XrayInputs; custom_query: string | null; country: string; pages: number; split: XraySplit };
type SerperBalance = { status: string; credits: number | null; lowAt: number };
const MAX_PAGE = 10;
const IMPORT_BATCH = 200;
const PAGE_CHOICES = [1, 2, 3, 5, 10];
const COUNTRIES = [["in", "India"], ["us", "United States"], ["gb", "United Kingdom"], ["sg", "Singapore"], ["ae", "UAE"], ["ca", "Canada"], ["au", "Australia"]] as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
async function post<T>(payload: unknown): Promise<T> {
  const response = await fetch("/api/xray", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error);
  return result;
}
export function XraySearchDialog({ roleId, roleName, onClose, onImported }: { roleId: string; roleName: string; onClose: () => void; onImported: () => void }) {
  // A new search starts from the role it is for.
  const [inputs, setInputs] = useState<XrayInputs>({ titles: roleName, keywords: "", location: "", company: "", exclude: "" });
  const [custom, setCustom] = useState<string | null>(null), [country, setCountry] = useState("in"), [pages, setPages] = useState(3), [split, setSplit] = useState<XraySplit>("none");
  const [batch, setBatch] = useState<XrayRun[] | null>(null), [history, setHistory] = useState<XrayRun[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]), [templateId, setTemplateId] = useState(""), [naming, setNaming] = useState<string | null>(null);
  const [inRole, setInRole] = useState<Set<string>>(new Set()), [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set()), [showKnown, setShowKnown] = useState(false);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null), [credits, setCredits] = useState(0), [balance, setBalance] = useState<SerperBalance | null>(null);

  const variations = useMemo(() => (custom !== null ? [{ label: "", query: custom }] : xrayVariations(inputs, split)), [custom, inputs, split]);
  const query = variations.length === 1 ? variations[0].query : "";
  const cost = variations.length * pages;
  const remember = (known: Known) => {
    setInRole((previous) => new Set([...previous, ...known.inRole]));
    setBlocked((previous) => new Set([...previous, ...known.blocked]));
  };
  const checkBalance = (fresh: boolean) =>
    fetch(`/api/credits?provider=serper${fresh ? "&fresh=1" : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((r) => setBalance(r?.balances?.[0] ?? null)).catch(() => setBalance(null));
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/xray?role=${roleId}`, { signal: controller.signal }).then(async (response) => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setConfigured(result.configured); setHistory(savedRuns(result.searches as Saved[])); setTemplates(result.templates ?? []);
      setInRole(new Set(result.known.inRole)); setBlocked(new Set(result.known.blocked));
    }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    fetch("/api/credits?provider=serper", { signal: controller.signal, cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((r) => setBalance(r?.balances?.[0] ?? null)).catch(() => {});
    return () => controller.abort();
  }, [roleId]);

  const results = useMemo(() => (batch ? batchResults(batch) : []), [batch]);
  const isNew = (url: string) => !inRole.has(url) && !blocked.has(url);
  const fresh = results.filter((r) => isNew(r.url));
  const shown = showKnown ? results : fresh;
  const fetched = batch ? Math.max(...batch.map(lastPage)) : 0;
  const sameSearch = batch !== null && batch.length === variations.length && batch.every((run, i) => run.query === variations[i].query && run.country === country);
  const canFetchMore = batch !== null && batch.some((run) => !run.exhausted && lastPage(run) < MAX_PAGE);
  const lowBalance = balance?.status === "ok" && balance.credits !== null && (balance.credits < cost || balance.credits < balance.lowAt);

  // Each variation reads its next pages in turn, stopping when Google has nobody new for it.
  async function fetchPages(start: XrayRun[]) {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    const runs = start.map((run) => ({ ...run }));
    try {
      for (let index = 0; index < runs.length; index += 1) {
        if (runs[index].exhausted) continue;
        const from = lastPage(runs[index]) + 1, until = Math.min(MAX_PAGE, from + pages - 1);
        for (let page = from; page <= until; page += 1) {
          const run = runs[index];
          setProgress(`${runs.length > 1 ? `${run.label || `Search ${index + 1}`}: ` : ""}page ${page} of ${until}…`);
          const result = await post<{ id: string; results: XrayResult[]; reused: boolean; known: Known }>({ role: roleId, query: run.query, country: run.country, page, token: crypto.randomUUID() });
          remember(result.known);
          // Serper takes a moment to show a spend, so count it here first.
          if (!result.reused) { setCredits((n) => n + 1); setBalance((b) => (b && b.credits !== null ? { ...b, credits: b.credits - 1 } : b)); }
          const exhausted = result.results.length === 0 || addsNobody(run, result.results);
          runs[index] = { ...run, pages: [...run.pages.filter((p) => p.page !== page), { id: result.id, page, results: result.results }], exhausted };
          setBatch([...runs]);
          // New people are picked by default; the recruiter unticks who they do not want.
          const known = new Set([...result.known.inRole, ...result.known.blocked]);
          setSelected((previous) => new Set([...previous, ...result.results.map((r) => r.url).filter((url) => !known.has(url) && !inRole.has(url) && !blocked.has(url))]));
          if (exhausted) break;
        }
      }
      setHistory((previous) => [...runs, ...previous.filter((r) => !runs.some((run) => run.query === r.query && run.country === r.country))].slice(0, 6));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); setProgress(""); window.setTimeout(() => void checkBalance(true), 5000); }
  }
  function search() {
    setSelected(new Set());
    void fetchPages(variations.map((v) => ({ query: v.query, country, pages: [], exhausted: false, label: v.label })));
  }
  async function importSelected() {
    if (!batch || busy) return;
    const urls = results.map((r) => r.url).filter((url) => selected.has(url) && isNew(url));
    if (!urls.length) return;
    setBusy(true); setError("");
    const searches = batch.flatMap((run) => run.pages.map((p) => p.id));
    let created = 0, already = 0, skipped = 0;
    try {
      for (let i = 0; i < urls.length; i += IMPORT_BATCH) {
        const chunk = urls.slice(i, i + IMPORT_BATCH);
        if (urls.length > IMPORT_BATCH) setProgress(`Importing ${Math.min(i + IMPORT_BATCH, urls.length)} of ${urls.length}…`);
        const result = await post<{ created?: number; alreadyInRole?: number; blocked?: number }>({ action: "import", role: roleId, searches, urls: chunk });
        created += result.created ?? 0; already += result.alreadyInRole ?? 0; skipped += result.blocked ?? 0;
        setInRole((previous) => new Set([...previous, ...chunk]));
      }
      setMessage(`Imported ${plural(created, "new profile")}.${already ? ` ${already} were already on this role.` : ""}${skipped ? ` ${skipped} blocklisted skipped.` : ""}`);
      setSelected(new Set()); onImported();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); setProgress(""); }
  }

  function applyTemplate(id: string) {
    setTemplateId(id); setNaming(null);
    const t = templates.find((x) => x.id === id); if (!t) return;
    setInputs({ titles: t.inputs.titles ?? "", keywords: t.inputs.keywords ?? "", location: t.inputs.location ?? "", company: t.inputs.company ?? "", exclude: t.inputs.exclude ?? "" });
    setCustom(t.custom_query); setCountry(t.country); setPages(t.pages); setSplit(t.split); setMessage("");
  }
  async function saveTemplate() {
    const name = naming?.trim(); if (!name || busy) return;
    setBusy(true); setError("");
    try {
      const { id } = await post<{ id: string }>({ action: "saveTemplate", role: roleId, name, inputs, customQuery: custom, country, pages, split });
      const saved: Template = { id, name, inputs, custom_query: custom, country, pages, split };
      setTemplates((previous) => [...previous.filter((t) => t.id !== id && t.name.toLowerCase() !== name.toLowerCase()), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateId(id); setNaming(null); setMessage(`Saved “${name}”. Run it again any time; people already on the role stay hidden.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function deleteTemplate() {
    const t = templates.find((x) => x.id === templateId); if (!t || busy) return;
    if (!window.confirm(`Delete the saved search “${t.name}”?`)) return;
    setBusy(true); setError("");
    try { await post({ action: "deleteTemplate", id: t.id }); setTemplates((previous) => previous.filter((x) => x.id !== t.id)); setTemplateId(""); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const picked = fresh.filter((r) => selected.has(r.url)).length;
  const knownCount = results.length - fresh.length;
  const pagesFetched = batch ? batch.reduce((n, run) => n + run.pages.length, 0) : 0;
  const editField = (field: keyof XrayInputs, value: string) => { setInputs({ ...inputs, [field]: value }); setCustom(null); };

  return <TableDialog wide titleId="xray-title" busy={busy} onClose={onClose}>
    <div className="modal-head"><div><h2 id="xray-title">Google X-Ray search</h2><p className="muted">Find LinkedIn profiles for {roleName}</p></div><button disabled={busy} aria-label="Close X-Ray search" onClick={onClose}><X size={16} /></button></div>
    {configured === false && <p className="notice">Google search setup is pending. Your administrator needs to connect the Serper account.</p>}
    <div className="xray-templates">
      <label>Saved searches<select value={templateId} onChange={(e) => applyTemplate(e.target.value)} disabled={busy}><option value="">{templates.length ? "Choose a saved search" : "No saved searches yet"}</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {naming === null
        ? <><button type="button" disabled={busy} onClick={() => setNaming(templates.find((t) => t.id === templateId)?.name ?? "")}><Save size={14} />Save search</button>{templateId && <button type="button" aria-label="Delete saved search" disabled={busy} onClick={() => void deleteTemplate()}><Trash2 size={14} /></button>}</>
        : <><label>Name<input autoFocus value={naming} maxLength={80} placeholder="e.g. QA leads, south India" onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveTemplate(); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setNaming(null); } }} /></label><button type="button" className="primary" disabled={busy || !naming.trim()} onClick={() => void saveTemplate()}>Save</button><button type="button" disabled={busy} onClick={() => setNaming(null)}>Cancel</button></>}
    </div>
    <form onSubmit={(e) => { e.preventDefault(); search(); }}>
      <div className="enrichment-input-grid">
        {([['titles', 'Job titles / designations', 'SDR, Business Development'], ['keywords', 'Skills / keywords', 'cold email, cold call'], ['location', 'Location', 'Chennai, Bangalore'], ['company', 'Company / industry terms', 'B2B'], ['exclude', 'Exclude terms', 'intern, trainee']] as const).map(([field, label, placeholder]) => <label key={field}>{label}<input value={inputs[field]} placeholder={placeholder} maxLength={200} onChange={(e) => editField(field, e.target.value)} /></label>)}
        <label>Google search country<select value={country} onChange={(e) => setCountry(e.target.value)}>{COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      </div>
      {variations.length > 1
        ? <><p className="muted xray-split-note">Runs as {variations.length} separate searches, one per {split === "location" ? "location" : "title"}:</p><ul className="xray-variations">{variations.map((v) => <li key={v.query}>{v.query}</li>)}</ul></>
        : <label>Boolean query<textarea className="xray-query" value={query} maxLength={500} rows={2} onChange={(e) => setCustom(e.target.value)} /></label>}
      <div className="enrichment-actions">
        <label className="xray-pages">Pages to fetch<select value={pages} onChange={(e) => setPages(Number(e.target.value))}>{PAGE_CHOICES.map((n) => <option key={n} value={n}>{n === MAX_PAGE ? "10 (all Google shows)" : n}</option>)}</select></label>
        <label className="xray-split">Run separately for each<select value={split} disabled={custom !== null} onChange={(e) => setSplit(e.target.value as XraySplit)}><option value="none">No, one search</option><option value="location">Location</option><option value="titles">Job title</option></select></label>
        <button className="primary" disabled={busy || configured === false || variations.some((v) => v.query === "site:linkedin.com/in/" || !v.query.trim())}><Search size={15} />{busy ? progress || "Working…" : "Search profiles"}</button>
      </div>
      <p className="muted xray-cost">
        Up to {plural(cost, "credit")}{variations.length > 1 ? ` (${variations.length} searches × ${plural(pages, "page")})` : ""}, 10 profiles a page. Stops early when Google runs out; pages fetched in the last day are free.
        {split !== "none" && variations.length === 1 && custom === null && ` Add ${split === "location" ? "locations" : "titles"} separated by commas to split (up to ${MAX_VARIATIONS}).`}
        {balance && balance.credits !== null && <> <span className={`xray-balance${lowBalance ? " is-low" : ""}`}>Serper balance: {balance.credits.toLocaleString("en-IN")} credits{lowBalance ? " — running low" : ""}.</span></>}
      </p>
    </form>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    {history.length > 0 && <label>Recent searches<select value={batch && batch.length === 1 ? history.findIndex((r) => r.query === batch[0].query && r.country === batch[0].country) : -1} onChange={(e) => { const saved = history[Number(e.target.value)]; if (saved) { setBatch([saved]); setCustom(saved.query); setCountry(saved.country); setSelected(new Set(runResults(saved).map((r) => r.url).filter(isNew))); setMessage(""); } }}><option value={-1}>Choose saved results</option>{history.map((r, i) => <option key={`${r.country}:${r.query}`} value={i}>{r.query} · {plural(lastPage(r), "page")}</option>)}</select></label>}
    {batch && <>
      <div className="enrichment-actions xray-summary" role="status">
        <span><strong>{fresh.length} new</strong> of {results.length} unique profiles from {plural(pagesFetched, "page")}{batch.length > 1 ? ` across ${batch.length} searches` : ""}{knownCount > 0 && <> · {knownCount} already on this role or blocklisted</>}{!canFetchMore && fetched > 0 && <> · Google has no more results</>}</span>
        {credits > 0 && <span className="muted">{plural(credits, "credit")} used</span>}
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
        {!results.length && !busy && <p className="muted">No LinkedIn profiles found. Try broader terms or another location.</p>}
        {results.length > 0 && !shown.length && <p className="muted">Everyone found is already on this role. Fetch more pages or change the search.</p>}
      </div>
      <div className="enrichment-actions">
        <button disabled={busy || !sameSearch || !canFetchMore || configured === false} onClick={() => void fetchPages(batch)}>{!canFetchMore ? (fetched >= MAX_PAGE ? "All 10 pages fetched" : "No more pages") : `Fetch ${plural(pages, "more page")}${batch.length > 1 ? " each" : ""}`}</button>
        <button className="primary" disabled={busy || !picked} onClick={() => void importSelected()}>{busy && progress.startsWith("Importing") ? progress : picked && picked === fresh.length ? `Import all ${picked} new to All Profiles` : `Import ${picked || "selected"} to All Profiles`}</button>
      </div>
    </>}
  </TableDialog>;
}
