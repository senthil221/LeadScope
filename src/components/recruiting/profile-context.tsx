"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { act } from "@/lib/client/act";
import { stageLabels, type Stage } from "@/lib/recruiting/stages";
type Membership = { id: string; role_id: string; stage: string; roles: { name: string; recruiter_names: string[]; archived: boolean; clients: { name: string } } };
export function ProfileContext({ candidateId }: { candidateId: string }) {
  const [rows, setRows] = useState<Membership[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; act<Membership[]>("profileContext", { candidateId }).then((r) => { if (active) { setRows(r); setError(""); } }).catch((e) => { if (active) setError(e.message); }); return () => { active = false; }; }, [candidateId, retry]);
  return <section className="profile-context" aria-label="Profile across roles"><h3>Across roles</h3>{error ? <p role="alert">{error} <button onClick={() => setRetry(retry + 1)}>Retry</button></p> : rows === null ? <p role="status">Loading role history…</p> : !rows.length ? <p className="muted">This profile is not assigned to a role.</p> : rows.map((r) => <div key={r.id}><Link href={`/roles/${r.role_id}?candidate=${r.id}`}>{r.roles.name}</Link><span>{r.roles.clients.name}</span><span className="badge">{stageLabels[r.stage as Stage] ?? r.stage}{r.roles.archived ? " · Archived" : ""}</span>{r.roles.recruiter_names.length > 0 && <small>{r.roles.recruiter_names.join(", ")}</small>}</div>)}</section>;
}
