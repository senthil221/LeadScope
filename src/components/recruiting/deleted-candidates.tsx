"use client";
import { useEffect, useState } from "react";
import { act } from "@/lib/client/act";
import { TableDialog } from "./table-dialog";

type Batch = { id: string; deletedAt: string; count: number };
export function DeletedCandidates({ clientId, roleId, archived, onClose, onRestored }: {
  clientId: string; roleId: string; archived: boolean; onClose: () => void; onRestored: () => void;
}) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    act<Batch[]>("deletedRoleCandidates", { clientId, roleId }).then((rows) => {
      if (active) setBatches(rows);
    }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [clientId, roleId]);
  async function restore(batchId: string) {
    setBusy(batchId); setError("");
    try {
      await act("restoreRoleCandidates", { clientId, roleId, batchId });
      setBatches((rows) => rows?.filter((row) => row.id !== batchId) ?? []);
      onRestored();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  return <TableDialog titleId="deleted-candidates-title" busy={busy !== null} onClose={onClose}>
    <div className="modal-heading"><h2 id="deleted-candidates-title">Recently deleted from this role</h2><button disabled={busy !== null} type="button" onClick={onClose}>Close</button></div>
    <p className="muted">Restore a batch with its original stage, notes, ratings, and history. Shared profiles remain in the master database.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!batches && !error && <p role="status">Loading deleted rows…</p>}
    {batches?.length === 0 && <p>No deleted rows to restore.</p>}
    <div className="deleted-batches">{batches?.map((batch) => <div className="deleted-batch" key={batch.id}>
      <div><strong>{batch.count} candidate{batch.count === 1 ? "" : "s"}</strong><br/><small>{new Date(batch.deletedAt).toLocaleString()}</small></div>
      <button disabled={archived || busy !== null} onClick={() => void restore(batch.id)}>{busy === batch.id ? "Restoring…" : "Restore batch"}</button>
    </div>)}</div>
    {archived && <p className="muted">Restore this archived role before restoring candidates.</p>}
  </TableDialog>;
}
