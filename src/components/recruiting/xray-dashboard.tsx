"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Download, ExternalLink, LoaderCircle, Play, Plus, Save, Search, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import type { PageData } from "@/lib/types";
import { normalizeQuery } from "@/lib/query-rules";
import { MAX_BATCH, MAX_VARIATIONS, parsePastedQueries, xrayVariations, type XrayInputs, type XrayResult, type XraySplit } from "@/lib/recruiting/xray";

type Known = { inRole: string[]; blocked: string[] };
type Page = { id: string; query: string; country: string; page: number; results: XrayResult[] };
type History = { query: string; country: string; pages: number; lastPage: number; lastRun: string; searchIds: string[]; profiles: number; fresh: number };
type Template = { id: string; name: string; inputs: XrayInputs; custom_query: string | null; country: string; pages: number; split: XraySplit };
type Task = { query: string; country: string; from: number; to: number; status: "queued" | "running" | "done" | "failed"; page: number; found: number; error?: string };
const COUNTRIES = [["in", "India"], ["us", "United States"], ["gb", "United Kingdom"], ["sg", "Singapore"], ["ae", "UAE"], ["ca", "Canada"], ["au", "Australia"]] as const;
const PAGE_CHOICES = [1, 2, 3, 5, 10];
const MAX_PAGE = 10;
const PARALLEL = 3;
const IMPORT_BATCH = 200;
const EMPTY: XrayInputs = { titles: "", keywords: "", location: "", company: "", exclude: "" };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
const countryName = (code: string) => COUNTRIES.find(([c]) => c === code)?.[1] ?? code.toUpperCase();
const when = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 30 ? `${days} days ago` : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
async function post<T>(payload: unknown): Promise<T> {
  const response = await fetch("/api/xray", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error);
  return result;
}
const check = (query: string) => normalizeQuery(query);

// Google X-Ray for one role. Queries are mostly written elsewhere and pasted
// in a batch; they run a few at a time, every page they find lands in one
// table, and what was found stays in the history to come back to.
export function XrayDashboard({ data }: { data: PageData }) {
  const role = data.role!;
  const [mode, setMode] = useState<"paste" | "build">("paste");
  const [pasted, setPasted] = useState("");
  const [inputs, setInputs] = useState<XrayInputs>({ ...EMPTY, titles: role.name });
  const [split, setSplit] = useState<XraySplit>("none");
  const [country, setCountry] = useState("in"), [pages, setPages] = useState(3);
  const [templates, setTemplates] = useState<Template[]>([]), [templateId, setTemplateId] = useState(""), [naming, setNaming] = useState<string | null>(null);
  const [history, setHistory] = useState<History[] | null>(null), [historyPicked, setHistoryPicked] = useState<Set<string>>(new Set()), [historyAll, setHistoryAll] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]), [running, setRunning] = useState(false);
  const [loaded, setLoaded] = useState<Page[]>([]);
  const [inRole, setInRole] = useState<Set<string>>(new Set()), [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set()), [showKnown, setShowKnown] = useState(false);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null), [balance, setBalance] = useState<number | null>(null), [spent, setSpent] = useState(0);
  const loadedRef = useRef<Page[]>([]);
  const knownRef = useRef({ inRole, blocked });
  useEffect(() => { loadedRef.current = loaded; knownRef.current = { inRole, blocked }; });

  const readHistory = (signal?: AbortSignal) => fetch(`/api/xray?role=${role.id}&history=1`, { cache: "no-store", signal }).then(async (response) => {
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    setConfigured(result.configured); setHistory(result.history); setTemplates(result.templates ?? []);
  }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
  const readBalance = (fresh: boolean, signal?: AbortSignal) => fetch(`/api/credits?provider=serper${fresh ? "&fresh=1" : ""}`, { cache: "no-store", signal })
    .then((r) => (r.ok ? r.json() : null)).then((r) => setBalance(r?.balances?.[0]?.credits ?? null)).catch(() => {});
  useEffect(() => {
    const controller = new AbortController();
    void readHistory(controller.signal);
    void readBalance(false, controller.signal);
    return () => controller.abort();
    // Read once for this role; later reads follow the work done on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role.id]);

  // What is about to run.
  const parsedPaste = useMemo(() => parsePastedQueries(pasted, check), [pasted]);
  const built = useMemo(() => xrayVariations(inputs, split).map((v) => { try { return { query: check(v.query) }; } catch (e) { return { query: v.query, error: (e as Error).message }; } }), [inputs, split]);
  const queue = mode === "paste" ? parsedPaste : built;
  const runnable = queue.filter((q) => !q.error).slice(0, MAX_BATCH);
  const cost = runnable.length * pages;

  // Everyone on the loaded pages, once, in the order they were found.
  const { results, foundBy } = useMemo(() => {
    const seen = new Map<string, XrayResult>(); const by = new Map<string, Set<string>>();
    for (const page of loaded) for (const r of page.results) {
      if (!seen.has(r.url)) seen.set(r.url, r);
      by.set(r.url, (by.get(r.url) ?? new Set()).add(page.query));
    }
    return { results: [...seen.values()], foundBy: by };
  }, [loaded]);
  const isNew = (url: string) => !inRole.has(url) && !blocked.has(url);
  const fresh = results.filter((r) => isNew(r.url));
  const shown = showKnown ? results : fresh;
  const picked = fresh.filter((r) => selected.has(r.url)).length;

  function remember(known: Known) {
    setInRole((prev) => new Set([...prev, ...known.inRole]));
    setBlocked((prev) => new Set([...prev, ...known.blocked]));
  }
  function addPages(next: Page[], known: Known, pick: boolean) {
    remember(known);
    setLoaded((prev) => { const ids = new Set(prev.map((p) => p.id)); return [...prev, ...next.filter((p) => !ids.has(p.id))]; });
    if (!pick) return;
    const skip = new Set([...known.inRole, ...known.blocked, ...knownRef.current.inRole, ...knownRef.current.blocked]);
    setSelected((prev) => new Set([...prev, ...next.flatMap((p) => p.results.map((r) => r.url)).filter((u) => !skip.has(u))]));
  }

  // A few queries at a time; each reads its pages in turn and stops when a
  // page has nobody it has not already seen.
  async function run(list: { query: string; country: string; from: number; to: number }[]) {
    if (running || !list.length) return;
    setRunning(true); setError(""); setMessage("");
    const work: Task[] = list.map((t) => ({ ...t, status: "queued", page: 0, found: 0 }));
    setTasks(work.map((t) => ({ ...t })));
    const update = (i: number, patch: Partial<Task>) => { work[i] = { ...work[i], ...patch }; setTasks(work.map((t) => ({ ...t }))); };
    const order = list.map((_, i) => i);
    async function worker() {
      for (let i = order.shift(); i !== undefined; i = order.shift()) {
        const task = work[i];
        const seen = new Set(loadedRef.current.filter((p) => p.query === task.query && p.country === task.country).flatMap((p) => p.results.map((r) => r.url)));
        let found = 0;
        update(i, { status: "running" });
        try {
          for (let page = task.from; page <= task.to; page += 1) {
            update(i, { page });
            const result = await post<{ id: string; results: XrayResult[]; reused: boolean; known: Known }>({ role: role.id, query: task.query, country: task.country, page, token: crypto.randomUUID() });
            if (!result.reused) { setSpent((n) => n + 1); setBalance((b) => (b == null ? b : b - 1)); }
            const added = result.results.filter((r) => !seen.has(r.url));
            added.forEach((r) => seen.add(r.url)); found += added.length;
            addPages([{ id: result.id, query: task.query, country: task.country, page, results: result.results }], result.known, true);
            update(i, { found });
            if (!added.length) break;
          }
          update(i, { status: "done" });
        } catch (e) { update(i, { status: "failed", error: (e as Error).message }); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker));
    setRunning(false);
    const failed = work.filter((t) => t.status === "failed").length;
    setMessage(`${plural(work.length - failed, "query", "queries")} finished${failed ? `, ${failed} failed` : ""}.`);
    void readHistory();
    window.setTimeout(() => void readBalance(true), 5000);
  }
  function runQueue() {
    void run(runnable.map((q) => ({ query: q.query, country, from: 1, to: pages })));
  }

  async function load(rows: History[], more = false) {
    if (!rows.length || busy) return;
    setBusy("load"); setError(""); setMessage("");
    try {
      const ids = rows.flatMap((h) => h.searchIds).slice(0, 500);
      const result = await post<{ pages: Page[]; known: Known }>({ action: "load", role: role.id, searches: ids });
      addPages(result.pages, result.known, true);
      if (!more) setMessage(`Loaded ${plural(rows.length, "query", "queries")} from history.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
    if (more) void run(rows.filter((h) => h.lastPage < MAX_PAGE).map((h) => ({ query: h.query, country: h.country, from: h.lastPage + 1, to: Math.min(MAX_PAGE, h.lastPage + pages) })));
  }

  async function importSelected() {
    const urls = fresh.map((r) => r.url).filter((u) => selected.has(u));
    if (!urls.length || busy) return;
    setBusy("import"); setError(""); setMessage("");
    let created = 0, already = 0, skipped = 0;
    try {
      for (let i = 0; i < urls.length; i += IMPORT_BATCH) {
        const chunk = urls.slice(i, i + IMPORT_BATCH), wanted = new Set(chunk);
        const searches = loaded.filter((p) => p.results.some((r) => wanted.has(r.url))).map((p) => p.id).slice(0, 500);
        const result = await post<{ created?: number; alreadyInRole?: number; blocked?: number }>({ action: "import", role: role.id, searches, urls: chunk });
        created += result.created ?? 0; already += result.alreadyInRole ?? 0; skipped += result.blocked ?? 0;
        setInRole((prev) => new Set([...prev, ...chunk]));
      }
      setSelected(new Set());
      setMessage(`Imported ${plural(created, "new profile")} into All profiles.${already ? ` ${already} were already on the role.` : ""}${skipped ? ` ${skipped} blocklisted skipped.` : ""}`);
      void readHistory();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  function applyTemplate(id: string) {
    setTemplateId(id); setNaming(null);
    const t = templates.find((x) => x.id === id); if (!t) return;
    setInputs({ ...EMPTY, ...t.inputs }); setCountry(t.country); setPages(t.pages); setSplit(t.split);
  }
  async function saveTemplate() {
    const name = naming?.trim(); if (!name || busy) return;
    setBusy("template"); setError("");
    try {
      const { id } = await post<{ id: string }>({ action: "saveTemplate", role: role.id, name, inputs, customQuery: null, country, pages, split });
      setTemplates((prev) => [...prev.filter((t) => t.id !== id && t.name.toLowerCase() !== name.toLowerCase()), { id, name, inputs, custom_query: null, country, pages, split }].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateId(id); setNaming(null); setMessage(`Saved “${name}”.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function deleteTemplate() {
    const t = templates.find((x) => x.id === templateId); if (!t || busy || !window.confirm(`Delete the saved search “${t.name}”?`)) return;
    setBusy("template");
    try { await post({ action: "deleteTemplate", id: t.id }); setTemplates((prev) => prev.filter((x) => x.id !== t.id)); setTemplateId(""); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  const historyKey = (h: History) => `${h.country}\u0000${h.query}`;
  const historyRows = history ?? [];
  const historyShown = historyAll ? historyRows : historyRows.slice(0, 25);
  const pickedHistory = historyRows.filter((h) => historyPicked.has(historyKey(h)));
  // The ticked queries, or every one when none is ticked.
  const exportRows = pickedHistory.length ? pickedHistory : historyRows;
  async function copyQueries() {
    try { await navigator.clipboard.writeText(exportRows.map((h) => h.query).join("\n")); setMessage(`Copied ${plural(exportRows.length, "query", "queries")}.`); }
    catch { setError("Copy failed. Use Export CSV instead."); }
  }
  function exportCsv() {
    const cell = (v: string | number) => { const t = String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [["Query", "Country", "Pages", "Profiles", "New", "Last run"], ...exportRows.map((h) => [h.query, countryName(h.country), h.pages, h.profiles, h.fresh, new Date(h.lastRun).toISOString().slice(0, 10)])];
    // The byte-order mark lets Excel read the file as UTF-8.
    const blob = new Blob(["﻿" + lines.map((row) => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `xray-queries-${role.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv` });
    link.click(); URL.revokeObjectURL(link.href);
  }
  const done = tasks.filter((t) => t.status === "done" || t.status === "failed").length;
  const lowBalance = balance != null && (balance < cost || balance < 200);

  return <AppShell data={data}>
    <header className="page-header xray-page-header">
      <div>
        <Link className="role-back" href={`/roles/${role.id}`}><ArrowLeft size={15} aria-hidden="true" /><span>{role.name}</span></Link>
        <h1>Google X-Ray</h1>
        <p className="muted">Find LinkedIn profiles for {role.name} at {data.client?.name}. Paste queries, run them together, import who is new.</p>
      </div>
      {balance != null && <span className={`xray-credit${lowBalance ? " is-low" : ""}`}>Serper <strong>{balance.toLocaleString("en-IN")}</strong> credits{spent > 0 && <small> · {spent} used here</small>}</span>}
    </header>
    {configured === false && <p className="notice">Google search is not connected. Add the Serper key on the server.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}

    <section className="xray-card" aria-labelledby="xray-new">
      <div className="xray-card-head">
        <h2 id="xray-new">New search</h2>
        <div className="xray-tabs" role="tablist" aria-label="How to search">
          <button type="button" role="tab" aria-selected={mode === "paste"} onClick={() => setMode("paste")}>Paste queries</button>
          <button type="button" role="tab" aria-selected={mode === "build"} onClick={() => setMode("build")}>Build a query</button>
        </div>
      </div>
      {mode === "paste" ? <div className="xray-paste">
        <textarea aria-label="X-Ray queries, one per line" rows={7} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={`One query per line. Numbering, bullets and code blocks are fine.\n\nsite:linkedin.com/in/ ("QA Manager" OR "Test Manager") "Chennai"\nsite:linkedin.com/in/ "SDET" "Selenium" "Pune"`} />
        {parsedPaste.length > 0 && <ol className="xray-queue">
          {parsedPaste.map((q, i) => <li key={`${i}:${q.query}`} className={q.error ? "is-bad" : undefined}><code>{q.query}</code>{q.error && <span>{q.error}</span>}</li>)}
        </ol>}
        {parsedPaste.filter((q) => !q.error).length > MAX_BATCH && <p className="muted">Runs the first {MAX_BATCH} queries; run the rest after.</p>}
      </div> : <div className="xray-build">
        <div className="xray-templates">
          <label>Saved searches<select value={templateId} onChange={(e) => applyTemplate(e.target.value)} disabled={Boolean(busy)}><option value="">{templates.length ? "Choose a saved search" : "No saved searches yet"}</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          {naming === null
            ? <><button type="button" disabled={Boolean(busy)} onClick={() => setNaming(templates.find((t) => t.id === templateId)?.name ?? "")}><Save size={14} />Save search</button>{templateId && <button type="button" aria-label="Delete saved search" disabled={Boolean(busy)} onClick={() => void deleteTemplate()}><Trash2 size={14} /></button>}</>
            : <><label>Name<input autoFocus value={naming} maxLength={80} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveTemplate(); } }} /></label><button type="button" className="primary" disabled={!naming.trim() || Boolean(busy)} onClick={() => void saveTemplate()}>Save</button><button type="button" onClick={() => setNaming(null)}>Cancel</button></>}
        </div>
        <div className="enrichment-input-grid">
          {([["titles", "Job titles / designations", "SDR, Business Development"], ["keywords", "Skills / keywords", "cold email, cold call"], ["location", "Location", "Chennai, Bangalore"], ["company", "Company / industry terms", "B2B"], ["exclude", "Exclude terms", "intern, trainee"]] as const).map(([field, label, placeholder]) => <label key={field}>{label}<input value={inputs[field]} placeholder={placeholder} maxLength={200} onChange={(e) => setInputs({ ...inputs, [field]: e.target.value })} /></label>)}
          <label>Run separately for each<select value={split} onChange={(e) => setSplit(e.target.value as XraySplit)}><option value="none">No, one search</option><option value="location">Location (up to {MAX_VARIATIONS})</option><option value="titles">Job title (up to {MAX_VARIATIONS})</option></select></label>
        </div>
        <ol className="xray-queue">{built.map((q) => <li key={q.query} className={q.error ? "is-bad" : undefined}><code>{q.query}</code>{q.error && <span>{q.error}</span>}</li>)}</ol>
        <button type="button" onClick={() => { setPasted((prev) => [prev.trim(), ...built.filter((q) => !q.error).map((q) => q.query)].filter(Boolean).join("\n")); setMode("paste"); }}><Plus size={14} />Add to pasted queries</button>
      </div>}
      <div className="xray-run-bar">
        <label>Country<select value={country} onChange={(e) => setCountry(e.target.value)}>{COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
        <label>Pages per query<select value={pages} onChange={(e) => setPages(Number(e.target.value))}>{PAGE_CHOICES.map((n) => <option key={n} value={n}>{n === MAX_PAGE ? "10 (all)" : n}</option>)}</select></label>
        <span className="muted">{runnable.length ? `${plural(runnable.length, "query", "queries")} · up to ${plural(cost, "credit")}, ${PARALLEL} at a time. Pages run in the last day are free.` : "Add queries to run."}</span>
        <button type="button" className="primary" disabled={running || !runnable.length || configured === false} onClick={runQueue}>{running ? <><LoaderCircle className="spin" size={15} />Running {done}/{tasks.length}</> : <><Play size={15} />Run {runnable.length > 1 ? `${runnable.length} queries` : "search"}</>}</button>
      </div>
    </section>

    {tasks.length > 0 && <section className="xray-card xray-progress" aria-label="Queries in this run">
      <div className="xray-meter" role="progressbar" aria-valuemin={0} aria-valuemax={tasks.length} aria-valuenow={done}><span style={{ width: `${(done / tasks.length) * 100}%` }} /></div>
      <ul>{tasks.map((t, i) => <li key={`${i}:${t.query}`} data-status={t.status}>
        <span className="xray-task-state">{t.status === "running" ? <LoaderCircle className="spin" size={13} /> : t.status === "done" ? <Check size={13} /> : t.status === "failed" ? <X size={13} /> : <span className="xray-dot" />}</span>
        <code title={t.query}>{t.query}</code>
        <span className="muted">{t.status === "failed" ? t.error : t.status === "queued" ? "Waiting" : `${plural(t.found, "profile")}${t.status === "running" ? ` · page ${t.page}` : ""}`}</span>
      </li>)}</ul>
    </section>}

    <section className="xray-card" aria-labelledby="xray-results">
      <div className="xray-card-head">
        <h2 id="xray-results">Results</h2>
        {results.length > 0 && <span className="xray-summary"><strong>{fresh.length.toLocaleString("en-IN")} new</strong> of {plural(results.length, "unique profile")}{results.length > fresh.length && ` · ${results.length - fresh.length} already on the role or blocklisted`}</span>}
        <div className="xray-head-actions">
          {results.length > fresh.length && <label className="xray-show-known"><input type="checkbox" checked={showKnown} onChange={(e) => setShowKnown(e.target.checked)} />Show those already here</label>}
          {loaded.length > 0 && <button type="button" className="small" disabled={running || Boolean(busy)} onClick={() => { setLoaded([]); setSelected(new Set()); setTasks([]); setMessage(""); }}>Clear</button>}
          <button type="button" className="primary" disabled={!picked || Boolean(busy) || running} onClick={() => void importSelected()}>{busy === "import" ? "Importing…" : picked && picked === fresh.length ? `Import all ${picked.toLocaleString("en-IN")} new` : `Import ${picked || "selected"}`}</button>
        </div>
      </div>
      {results.length ? <div className="enrichment-results xray-results"><table>
        <thead><tr><th><input type="checkbox" aria-label="Select all new profiles" checked={fresh.length > 0 && picked === fresh.length} onChange={(e) => setSelected(e.target.checked ? new Set(fresh.map((r) => r.url)) : new Set())} /></th><th>Profile</th><th>Search details</th><th>Found by</th><th>LinkedIn</th></tr></thead>
        <tbody>{shown.map((r) => {
          const status = inRole.has(r.url) ? "On this role" : blocked.has(r.url) ? "Blocklisted" : null;
          const by = [...(foundBy.get(r.url) ?? [])];
          return <tr key={r.url} className={status ? "xray-known" : undefined}>
            <td><input type="checkbox" aria-label={`Select ${r.name}`} disabled={Boolean(status)} checked={!status && selected.has(r.url)} onChange={(e) => setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(r.url); else next.delete(r.url); return next; })} /></td>
            <td><strong>{r.name}</strong>{status && <span className="xray-badge">{status}</span>}<small>{r.title}</small></td>
            <td>{r.snippet || "No indexed description"}</td>
            <td><span className="xray-found-by" title={by.join("\n")}>{by.length === 1 ? "1 query" : `${by.length} queries`}</span></td>
            <td><a href={r.url} target="_blank" rel="noopener noreferrer">Open <ExternalLink size={12} /></a></td>
          </tr>;
        })}</tbody>
      </table>{!shown.length && <p className="muted xray-empty">Everyone found is already on this role.</p>}</div>
        : <p className="muted xray-empty">Run queries above, or load past ones from the history below. Results from every query collect here, each person once.</p>}
    </section>

    <section className="xray-card" aria-labelledby="xray-history">
      <div className="xray-card-head">
        <h2 id="xray-history">History <span className="count">{historyRows.length}</span></h2>
        <span className="muted">Every query run for this role. New counts people the role does not have yet.</span>
        <div className="xray-head-actions">
          <button type="button" className="small" disabled={!historyRows.length} onClick={() => void copyQueries()} title="One query per line, to paste anywhere"><Copy size={13} />Copy {pickedHistory.length ? pickedHistory.length : "all"} queries</button>
          <button type="button" className="small" disabled={!historyRows.length} onClick={exportCsv}><Download size={13} />Export CSV</button>
          <button type="button" className="small" disabled={!pickedHistory.length || Boolean(busy) || running} onClick={() => void load(pickedHistory)}><Search size={13} />Load {pickedHistory.length || ""} selected</button>
          <button type="button" className="small" disabled={!pickedHistory.length || Boolean(busy) || running || configured === false} onClick={() => void load(pickedHistory, true)}><Play size={13} />Fetch {pages} more {pages === 1 ? "page" : "pages"}</button>
        </div>
      </div>
      {history === null ? <div className="credits-skeleton coverage-loading" aria-hidden="true" /> : historyRows.length ? <div className="xray-history-wrap"><table className="xray-history">
        <thead><tr><th><input type="checkbox" aria-label="Select all queries" checked={historyShown.length > 0 && historyShown.every((h) => historyPicked.has(historyKey(h)))} onChange={(e) => setHistoryPicked(e.target.checked ? new Set(historyShown.map(historyKey)) : new Set())} /></th><th>Query</th><th>Country</th><th>Pages</th><th>Profiles</th><th>New</th><th>Last run</th><th /></tr></thead>
        <tbody>{historyShown.map((h) => <tr key={historyKey(h)}>
          <td><input type="checkbox" aria-label={`Select ${h.query}`} checked={historyPicked.has(historyKey(h))} onChange={(e) => setHistoryPicked((prev) => { const next = new Set(prev); if (e.target.checked) next.add(historyKey(h)); else next.delete(historyKey(h)); return next; })} /></td>
          <td><code title={h.query}>{h.query}</code></td>
          <td>{countryName(h.country)}</td>
          <td>{h.pages}{h.lastPage >= MAX_PAGE && <small> · all</small>}</td>
          <td>{h.profiles}</td>
          <td>{h.fresh ? <strong className="xray-fresh">{h.fresh}</strong> : <span className="muted">0</span>}</td>
          <td className="muted">{when(h.lastRun)}</td>
          <td><div className="row"><button type="button" className="small" disabled={Boolean(busy) || running} onClick={() => void load([h])}>Load</button><button type="button" className="small" disabled={Boolean(busy) || running} onClick={() => { setPasted((prev) => [prev.trim(), h.query].filter(Boolean).join("\n")); setCountry(h.country); setMode("paste"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Reuse</button></div></td>
        </tr>)}</tbody>
      </table>{historyRows.length > 25 && !historyAll && <button type="button" className="small xray-more" onClick={() => setHistoryAll(true)}>Show all {historyRows.length}</button>}</div>
        : <p className="muted xray-empty">No queries run for this role yet.</p>}
    </section>
  </AppShell>;
}
