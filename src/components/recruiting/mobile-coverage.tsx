"use client";
import { useEffect, useState } from "react";
import { coverageNotes, hitRate, sourceName, type Coverage } from "@/lib/recruiting/coverage";

const PERIODS = [["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"]] as const;
const number = new Intl.NumberFormat("en-IN");
const pct = (n: number) => `${Math.round(n * 100)}%`;

// Which source the mobile numbers came from, so a recruiter can see which tool
// earns its credits. Sources are listed in the order a lookup asks them.
export function MobileCoverage({ balances }: { balances: Partial<Record<string, number | null>> }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("30");
  const [coverage, setCoverage] = useState<{ period: string; data: Coverage } | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/credits?coverage=${period}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setCoverage({ period, data: result }); setError("");
    }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [period]);
  const data = coverage?.data;
  const loading = coverage?.period !== period;
  const notes = data ? coverageNotes(data, balances) : [];
  const sources = data?.providers ?? [];

  return <section className="coverage" aria-labelledby="coverage-title" aria-busy={loading}>
    <div className="coverage-head">
      <div><h2 id="coverage-title">Mobile lookup coverage</h2><p className="muted">Where the numbers came from. A lookup asks each source in turn and stops at the first that finds a number.</p></div>
      <div className="coverage-periods" role="group" aria-label="Period">
        {PERIODS.map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} className={period === value ? "is-on" : undefined} onClick={() => setPeriod(value)}>{label}</button>)}
      </div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {data && <>
      <div className="coverage-totals">
        <div><strong>{number.format(data.lookups.total)}</strong><span>lookups</span></div>
        <div><strong>{number.format(data.lookups.found)}</strong><span>found a number</span></div>
        <div><strong>{number.format(data.lookups.none)}</strong><span>no number anywhere</span></div>
        <div><strong>{data.lookups.total ? pct(data.lookups.found / data.lookups.total) : "—"}</strong><span>overall hit rate</span></div>
      </div>
      {sources.length > 0 && <table className="coverage-table">
        <thead><tr><th scope="col">Source</th><th scope="col">Asked</th><th scope="col">Found someone</th><th scope="col">Hit rate</th><th scope="col">Numbers</th></tr></thead>
        <tbody>{sources.map((s) => <tr key={s.provider}>
          <th scope="row">{sourceName[s.provider]}{s.provider === "database" && <small>free</small>}{s.errors > 0 && <small className="coverage-errors">{s.errors} {s.errors === 1 ? "error" : "errors"}</small>}</th>
          <td>{number.format(s.checked)}</td>
          <td>{number.format(s.found)}</td>
          <td><span className="coverage-rate"><span className="coverage-bar" aria-hidden="true"><span style={{ width: pct(hitRate(s)) }} /></span>{s.checked ? pct(hitRate(s)) : "—"}</span></td>
          <td>{number.format(s.numbers)}</td>
        </tr>)}</tbody>
      </table>}
      {notes.length > 0 && <div className="coverage-notes"><h3>What this says</h3><ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul></div>}
      <p className="muted coverage-foot">A later source is only asked about the people the earlier ones missed, so its rate is over harder cases. Numbers added by hand are not counted.</p>
    </>}
    {!data && !error && <div className="coverage-loading" aria-hidden="true"><div className="credits-skeleton is-big" /></div>}
  </section>;
}
