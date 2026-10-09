"use client";
import { useMemo, useState } from "react";
import { ArrowUpRight, FileText, Search } from "lucide-react";
import { SharedFieldCell } from "./shared-field-cell";
import { ShareRefresh } from "./share-refresh";
import styles from "./client-share.module.css";

export type ShareCandidate = {
  id: string; name: string; designation: string; company: string; linkedin?: string; resume: boolean; stage: string;
  experience: string; ctc: string; location: string; qualification: string; phones: string[]; email: string; added: string;
  note?: string; custom: Record<string, string>;
};
// What each shared stage means to the client reading it.
const STAGES = [
  { id: "recruiter_shortlisted", label: "For review" },
  { id: "client_shortlisted", label: "Shortlisted" },
  { id: "offer_sent", label: "Offer sent" },
];
const stageLabel = (id: string) => STAGES.find((s) => s.id === id)?.label ?? "For review";
const PAGE = 25;

export function ClientShareSheet({ token, candidates, fields, canEditNotes, roleName }: {
  token: string; candidates: ShareCandidate[]; fields: { key: string; label: string }[]; canEditNotes: boolean; roleName: string;
}) {
  const [query, setQuery] = useState(""), [stage, setStage] = useState(""), [page, setPage] = useState(0), [blocked, setBlocked] = useState("");
  // A filter change re-renders the rows; feedback still being typed must be saved first.
  function changeView(change: () => void) {
    if (document.querySelector('[data-unsaved="true"]')) { setBlocked("Save your feedback before changing the view."); return; }
    setBlocked(""); change();
  }
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s.id, candidates.filter((c) => c.stage === s.id).length])), [candidates]);
  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return candidates.filter((c) => (!stage || c.stage === stage) && (!term || [c.name, c.designation, c.company, c.location, c.qualification, c.email, ...c.phones, ...Object.values(c.custom)].join(" ").toLowerCase().includes(term)));
  }, [candidates, query, stage]);
  const current = Math.min(page, Math.max(0, Math.ceil(shown.length / PAGE) - 1));
  const rows = shown.slice(current * PAGE, current * PAGE + PAGE);

  return <section className={styles.sheet} aria-label="Shortlisted candidates">
    <div className={styles.toolbar}>
      <div className={styles.stages} role="group" aria-label="Filter by stage">
        <button type="button" aria-pressed={!stage} onClick={() => changeView(() => { setStage(""); setPage(0); })}>All <span>{candidates.length}</span></button>
        {STAGES.filter((s) => counts[s.id]).map((s) => <button key={s.id} type="button" aria-pressed={stage === s.id} onClick={() => changeView(() => { setStage(s.id); setPage(0); })}>{s.label} <span>{counts[s.id]}</span></button>)}
      </div>
      <label className={styles.search}><Search size={14} aria-hidden="true" /><input type="search" aria-label="Search candidates" placeholder="Search name, company, location" value={query} onChange={(e) => { const value = e.target.value; changeView(() => { setQuery(value); setPage(0); }); }} /></label>
    </div>
    {blocked && <p className={styles.blocked} role="alert">{blocked}</p>}
    <div className={styles.scroll} tabIndex={0} role="region" aria-label="Candidates. Scroll sideways for more details.">
      <table className={styles.table}>
        <caption className={styles.srOnly}>Candidates shortlisted for {roleName}</caption>
        <thead><tr>
          <th scope="col">Candidate</th><th scope="col">Experience</th><th scope="col">Current CTC</th><th scope="col">Location</th>
          <th scope="col">Qualification</th><th scope="col">Contact</th>
          {fields.map((f) => <th scope="col" key={f.key}>{f.label}</th>)}
          <th scope="col">Your feedback</th>
        </tr></thead>
        <tbody>{rows.map((c) => <tr key={c.id}>
          <th scope="row" className={styles.candidate}>
            <span className={styles.nameLine}><strong>{c.name}</strong><span className={styles.pill} data-stage={c.stage}>{stageLabel(c.stage)}</span></span>
            {(c.designation || c.company) && <span className={styles.role}>{[c.designation, c.company].filter(Boolean).join(" · ")}</span>}
            <span className={styles.links}>
              {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer">LinkedIn <ArrowUpRight size={11} aria-hidden="true" /></a>}
              {c.resume && <a href={`/api/share/${token}?resume=${c.id}`} target="_blank" rel="noreferrer"><FileText size={11} aria-hidden="true" /> Resume</a>}
              {c.added && <span className={styles.added}>Added {c.added}</span>}
            </span>
          </th>
          <td>{c.experience || <Dash />}</td>
          <td>{c.ctc || <Dash />}</td>
          <td>{c.location || <Dash />}</td>
          <td>{c.qualification || <Dash />}</td>
          <td className={styles.contact}>{c.phones.length || c.email ? <>{c.phones.map((p) => <span key={p}>{p}</span>)}{c.email && <a href={`mailto:${c.email}`} title={c.email}>{c.email}</a>}</> : <Dash />}</td>
          {fields.map((f) => <td key={f.key}>{c.custom[f.key] || <Dash />}</td>)}
          <td className={styles.feedback}>{canEditNotes ? <SharedFieldCell token={token} roleCandidateId={c.id} column="client_notes" value={c.note} kind="text" multiline label={`Feedback on ${c.name}`} /> : c.note}</td>
        </tr>)}</tbody>
      </table>
      {!shown.length && <div className={styles.empty}><h2>{candidates.length ? "No one matches" : "Candidates will appear here"}</h2><p>{candidates.length ? "Try another search or stage." : "Your recruiter is preparing the shortlist."}</p></div>}
    </div>
    <div className={styles.sheetFooter}>
      <span>{shown.length ? `${current * PAGE + 1}–${Math.min((current + 1) * PAGE, shown.length)} of ${shown.length}` : "0 candidates"}</span>
      {shown.length > PAGE && <div className={styles.pager}><button type="button" disabled={!current} onClick={() => changeView(() => setPage(current - 1))}>Previous</button><button type="button" disabled={(current + 1) * PAGE >= shown.length} onClick={() => changeView(() => setPage(current + 1))}>Next</button></div>}
      <ShareRefresh />
    </div>
  </section>;
}
function Dash() {
  return <span className={styles.dash} aria-label="Not provided">—</span>;
}
