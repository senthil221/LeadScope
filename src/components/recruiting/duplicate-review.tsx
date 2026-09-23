"use client";
import { useEffect, useState } from "react";
import { act } from "@/lib/client/act";
import { type DuplicatePair, type DuplicateProfile, type DuplicateStatus, type Page } from "@/lib/recruiting/table-tools";
import { TableDialog } from "./table-dialog";

function Profile({ profile }: { profile: DuplicateProfile }) {
  return <section className="duplicate-profile"><h3>{profile.name}</h3><p>{profile.designation || "No designation"} · {profile.company || "No company"}</p>
    <dl><dt>Email</dt><dd>{profile.email || "Empty"}</dd><dt>Phone</dt><dd>{profile.phone || "Empty"}</dd><dt>Location</dt><dd>{profile.location || "Empty"}</dd></dl>
    {profile.linkedin && <a href={profile.linkedin} target="_blank" rel="noreferrer">Open LinkedIn profile ↗</a>}
    <p className="muted">{profile.roles.length ? profile.roles.map((role) => `${role.client} / ${role.name}`).join(" · ") : "Master database only"}</p>
    <small className="muted">Profile {profile.id.slice(0,8)}</small>
  </section>;
}
function Pair({ pair, clientId, roleId, onReviewed }: { pair: DuplicatePair; clientId: string; roleId: string; onReviewed: () => void }) {
  const [note, setNote] = useState(pair.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function review(status: DuplicateStatus) {
    setBusy(true); setError("");
    try { await act("reviewDuplicate", { clientId, roleId, firstId: pair.first.id, secondId: pair.second.id, fingerprint: pair.fingerprint, revision: pair.revision, status, note }); onReviewed(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <article className="duplicate-pair"><div className="duplicate-match-reasons">{pair.reasons.join(" · ")}</div><div className="duplicate-comparison"><Profile profile={pair.first}/><Profile profile={pair.second}/></div>
    <label>Review note<textarea maxLength={2000} disabled={busy} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explain the match or why these are separate people…" /></label>
    {error && <p className="error" role="alert">{error}</p>}
    {pair.reviewedAt && <p className="muted">Last reviewed {new Date(pair.reviewedAt).toLocaleString()}{pair.status === "pending" ? " · Verify the current details before reviewing again." : ""}</p>}
    <div className="row table-tools-actions"><button disabled={busy} onClick={() => void review("confirmed")}>Confirm duplicate</button><button disabled={busy} onClick={() => void review("separate")}>Keep separate</button>{pair.status !== "pending" && <button disabled={busy} onClick={() => void review("pending")}>Reopen review</button>}</div>
  </article>;
}
export function DuplicateReview({ clientId, roleId, onClose }: { clientId: string; roleId: string; onClose: () => void }) {
  const [status, setStatus] = useState<DuplicateStatus>("pending");
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState<Page<DuplicatePair> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    act<Page<DuplicatePair>>("duplicateReview", { clientId, roleId, status, after: cursor }).then((result) => { if (alive) setPage(result); }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [clientId, roleId, status, cursor, attempt]);
  function load(next: string | null = null) { setPage(null); setError(""); setCursor(next); setAttempt((value) => value + 1); }
  return <TableDialog titleId="duplicate-review-title" wide onClose={onClose}><div className="modal-heading"><h2 id="duplicate-review-title">Duplicate review</h2><button onClick={onClose}>Close</button></div>
    <p className="muted">Profiles in this role are compared with the full master database by matching email, phone, or name and company. Shared phone numbers and similar names need human review.</p>
    <p className="table-tools-notice">Decisions are recorded for the team. Confirming a match keeps both profiles and their role histories available for cleanup; it does not merge or delete them.</p>
    <label>Review status<select value={status} onChange={(event) => { setStatus(event.target.value as DuplicateStatus); load(); }}><option value="pending">Needs review</option><option value="confirmed">Confirmed duplicates</option><option value="separate">Keep separate</option></select></label>
    {error ? <p className="error" role="alert">{error} <button onClick={() => load(cursor)}>Retry</button></p> : !page ? <p role="status">Finding matching profiles…</p> : page.rows.length === 0 ? <p>No matching pairs in this review view.</p> : <div className="duplicate-pairs">{page.rows.map((pair) => <Pair key={`${pair.cursor}:${pair.fingerprint}:${pair.revision}`} pair={pair} clientId={clientId} roleId={roleId} onReviewed={() => load(cursor)} />)}</div>}
    <div className="row table-tools-actions">{cursor && <button onClick={() => load()}>First page</button>}{page?.nextCursor && <button onClick={() => load(page.nextCursor)}>Next matches</button>}</div>
  </TableDialog>;
}
