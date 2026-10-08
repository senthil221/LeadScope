"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import type { PageData } from "@/lib/types";
import type { Balance } from "@/lib/server/balances";

const number = new Intl.NumberFormat("en-IN");
const statusText: Record<Balance["status"], string> = { ok: "Connected", missing: "Not set up", restricted: "Connected", error: "Unavailable" };

// What is left on each paid account. Balances are read live from each
// provider when the page opens and on Refresh; reading them costs nothing.
export function CreditsWorkspace({ data }: { data: PageData }) {
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [checkedAt, setCheckedAt] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const read = (fresh: boolean, signal?: AbortSignal) =>
    fetch(`/api/credits${fresh ? "?fresh=1" : ""}`, { cache: "no-store", signal }).then(async (response) => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setBalances(result.balances); setCheckedAt(result.checkedAt); setError("");
    }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/credits", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setBalances(result.balances); setCheckedAt(result.checkedAt);
    }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, []);
  async function refresh() { setBusy(true); await read(true); setBusy(false); }
  const low = (balances ?? []).filter((b) => b.status === "ok" && b.credits !== null && b.credits < b.lowAt);

  return <AppShell data={data}>
    <header className="page-header role-directory-header">
      <div><h1>Credits</h1><p className="muted">What is left on each paid tool the workspace uses. Checking a balance does not use any credits.</p></div>
      <button onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : undefined} />{busy ? "Checking…" : "Refresh"}</button>
    </header>
    {error && <p className="error" role="alert">{error}</p>}
    {low.length > 0 && <p className="notice credits-warning" role="status"><AlertTriangle size={15} />Running low on {low.map((b) => b.name).join(", ")}. Top up before the next big search or lookup run.</p>}
    <div className="credits-grid" aria-busy={balances === null}>
      {(balances ?? []).map((b) => {
        const isLow = b.status === "ok" && b.credits !== null && b.credits < b.lowAt;
        return <section key={b.id} className={`credits-card is-${b.status}${isLow ? " is-low" : ""}`} aria-labelledby={`credits-${b.id}`}>
          <div className="credits-card-head">
            <h2 id={`credits-${b.id}`}>{b.name}</h2>
            <span className={`credits-status is-${b.status}`}>{isLow ? "Low" : statusText[b.status]}</span>
          </div>
          <p className="credits-use">{b.usedFor}</p>
          <div className="credits-figure">
            {b.credits !== null ? <><strong>{number.format(b.credits)}</strong><span>credits left</span></> : <span className="credits-none">{b.status === "restricted" ? "Balance hidden" : "—"}</span>}
          </div>
          {b.lines.length > 1 && <ul className="credits-lines">{b.lines.map((line) => <li key={line.label}><span>{line.label}</span><span>{number.format(line.left)}{line.limit ? ` of ${number.format(line.limit)}` : ""}</span></li>)}</ul>}
          {b.note && <p className="credits-note">{b.note}</p>}
          <a className="credits-link" href={b.dashboard} target="_blank" rel="noopener noreferrer">Open {b.name} <ExternalLink size={12} /></a>
        </section>;
      })}
      {balances === null && !error && Array.from({ length: 4 }, (_, i) => <section key={i} className="credits-card is-loading" aria-hidden="true"><div className="credits-skeleton" /><div className="credits-skeleton is-big" /></section>)}
    </div>
    {checkedAt && <p className="muted credits-checked">Checked {new Date(checkedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}. Low means under 200 for Serper, 100 for SignalHire and Apollo, 50 for BetterContact.</p>}
  </AppShell>;
}
