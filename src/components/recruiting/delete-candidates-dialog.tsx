"use client";

import { useState } from "react";
import { TableDialog } from "./table-dialog";

export function DeleteCandidatesDialog({ count, roleName, busy, error, onClose, onConfirm }: {
  count: number; roleName: string; busy: boolean; error: string;
  onClose: () => void; onConfirm: (confirmation: "DELETE") => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  return <TableDialog titleId="delete-rows-title" busy={busy} onClose={onClose}>
    <div className="modal-heading"><h2 id="delete-rows-title">Delete {count} row{count === 1 ? "" : "s"} from this role?</h2><button type="button" disabled={busy} onClick={onClose}>Close</button></div>
    <p>Remove the selected rows from <strong>{roleName}</strong>. The master profiles and other roles are kept. The workspace owner can restore this batch with its notes and history from Recently deleted.</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!busy && confirmation === "DELETE") onConfirm(confirmation);
    }}>
      <label>
        <span>Type <code>DELETE</code> to confirm</span>
        <input aria-label="Delete confirmation" autoComplete="off" spellCheck={false} data-dialog-autofocus value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row delete-dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="delete-confirm-button" disabled={busy || confirmation !== "DELETE"}>{busy ? "Deleting…" : "Delete from role"}</button>
      </div>
    </form>
  </TableDialog>;
}
