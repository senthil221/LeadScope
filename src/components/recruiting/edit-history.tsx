"use client";
import { useEffect, useState } from "react";
import { act } from "@/lib/client/act";
import { displayEditValue, editFieldLabel, type EditHistoryEntry, type Page } from "@/lib/recruiting/table-tools";
import { TableDialog } from "./table-dialog";

export function EditHistory({ clientId, roleId, candidateId = null }: { clientId: string; roleId: string; candidateId?: string | null }) {
  const [page, setPage] = useState<Page<EditHistoryEntry> | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    act<Page<EditHistoryEntry>>("candidateEditHistory", { clientId, roleId, candidateId, before: cursor }).then((result) => { if (alive) setPage(result); }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [clientId, roleId, candidateId, cursor, attempt]);
  function load(before: string | null) { setPage(null); setError(""); setCursor(before); setAttempt((value) => value + 1); }
  return <div>
    <p className="muted">Field changes are recorded from this release onward. Shared profile changes also appear in other roles using that profile.</p>
    {error ? <p className="error" role="alert">{error} <button onClick={() => load(cursor)}>Retry</button></p> : !page ? <p role="status">Loading edit history…</p> : page.rows.length === 0 ? <p>No recorded edits in this view yet.</p> :
      <ol className="edit-history-list">{page.rows.map((entry) => <li key={entry.id}>
        <div className="edit-history-heading"><strong>{entry.candidateName} · {entry.fieldLabel ?? editFieldLabel(entry.field)}</strong><time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time></div>
        <p className="muted">{entry.actor} · {entry.scope}{entry.batchId ? ` · Bulk edit ${entry.batchId.slice(0,8)}` : ""}</p>
        <div className="edit-history-values"><div><small>Before</small><p>{displayEditValue(entry.before, entry.field)}</p></div><div><small>After</small><p>{displayEditValue(entry.after, entry.field)}</p></div></div>
      </li>)}</ol>}
    <div className="row table-tools-actions">{cursor && <button onClick={() => load(null)}>Latest edits</button>}{page?.nextCursor && <button onClick={() => load(page.nextCursor)}>Older edits</button>}</div>
  </div>;
}

export function EditHistoryDialog({ clientId, roleId, onClose }: { clientId: string; roleId: string; onClose: () => void }) {
  return <TableDialog titleId="edit-history-title" wide onClose={onClose}><div className="modal-heading"><h2 id="edit-history-title">Edit history</h2><button onClick={onClose}>Close</button></div><EditHistory clientId={clientId} roleId={roleId}/></TableDialog>;
}
