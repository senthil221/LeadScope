"use client";
import { useEffect, useState } from "react";
import { coverageRows, hitRate, type Coverage } from "@/lib/recruiting/coverage";

const PERIODS = [["30", "30 days"], ["90", "90 days"], ["all", "All time"]] as const;
const number = new Intl.NumberFormat("en-IN");
const pct = (n: number) => `${Math.round(n * 100)}%`;

// Which source the mobile numbers came from, so it is plain which tool earns
// its credits. Sources are listed in the order a lookup asks them.
export function MobileCoverage() {
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
  const totals = data?.lookups;

  return <section className="coverage" aria-labelledby="coverage-title" aria-busy={coverage?.period !== period}>
    <header className="coverage-head">
      <h2 id="coverage-title">Mobile lookup coverage</h2>
      {totals && <p className="coverage-totals">
        <span><strong>{number.format(totals.total)}</strong> lookups</span>
        <span><strong>{number.format(totals.found)}</strong> found</span>
        <span><strong>{number.format(totals.none)}</strong> none anywhere</span>
        <span><strong>{totals.total ? pct(totals.found / totals.total) : "—"}</strong> hit rate</span>
      </p>}
      <div className="coverage-periods" role="group" aria-label="Period">
        {PERIODS.map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} className={period === value ? "is-on" : undefined} onClick={() => setPeriod(value)}>{label}</button>)}
      </div>
    </header>
    {error && <p className="error" role="alert">{error}</p>}
    {data ? <table className="coverage-table">
      <colgroup><col /><col className="is-num" /><col className="is-num" /><col className="is-rate" /><col className="is-num" /></colgroup>
      <thead><tr>
        <th scope="col">Source</th><th scope="col">Asked</th><th scope="col">Found</th>
        <th scope="col" title="Of the people this source was asked about. A later source only sees those the earlier ones missed.">Hit rate</th>
        <th scope="col">Numbers</th>
      </tr></thead>
      <tbody>{coverageRows(data).map((s) => <tr key={s.id} className={s.tag === "planned" ? "is-planned" : undefined}>
        <th scope="row">{s.name}{s.tag && <small className={`coverage-tag is-${s.tag}`}>{s.tag}</small>}{s.errors > 0 && <small className="coverage-tag is-error">{s.errors} {s.errors === 1 ? "error" : "errors"}</small>}</th>
        <td>{s.tag === "planned" ? "—" : number.format(s.checked)}</td>
        <td>{s.tag === "planned" ? "—" : number.format(s.found)}</td>
        <td><span className="coverage-rate"><span className="coverage-bar" aria-hidden="true"><span style={{ width: pct(hitRate(s)) }} /></span><span>{s.checked ? pct(hitRate(s)) : "—"}</span></span></td>
        <td>{s.tag === "planned" ? "—" : number.format(s.numbers)}</td>
      </tr>)}</tbody>
    </table> : !error && <div className="credits-skeleton coverage-loading" aria-hidden="true" />}
  </section>;
}
