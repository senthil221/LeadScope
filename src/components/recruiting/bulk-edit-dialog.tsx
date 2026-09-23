"use client";
import { useState } from "react";
import type { RoleField } from "@/lib/types";
import { act } from "@/lib/client/act";
import { bulkFields, bulkValue, displayEditValue, type BulkPreview, type EditMode } from "@/lib/recruiting/table-tools";
import { TableDialog } from "./table-dialog";

export function BulkEditDialog({ clientId, roleId, roleName, ids, stage, fields, onClose, onSaved }: {
  clientId: string; roleId: string; roleName: string; ids: string[]; stage: string | null;
  fields: RoleField[]; onClose: () => void; onSaved: (count: number) => void;
}) {
  const options = bulkFields(fields);
  const [fieldId, setFieldId] = useState(options[0].id);
  const field = options.find((option) => option.id === fieldId)!;
  const [mode, setMode] = useState<EditMode>("fill_empty");
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function resetPreview() { setPreview(null); setError(""); }
  async function submit(apply: boolean) {
    setError(""); setBusy(true);
    try {
      const result = await act<BulkPreview>("bulkEditCandidates", {
        clientId, roleId, ids, stage, field: field.id, value: bulkValue(field, mode, value), mode,
        expected: apply ? preview!.token : null,
      });
      if (apply) onSaved(result.changed);
      else setPreview(result);
    } catch (e) { setError((e as Error).message); setPreview(null); }
    finally { setBusy(false); }
  }
  return <TableDialog titleId="bulk-edit-title" busy={busy} wide onClose={onClose}>
    <div className="modal-heading"><h2 id="bulk-edit-title">Bulk edit {ids.length} selected row{ids.length === 1 ? "" : "s"}</h2><button disabled={busy} onClick={onClose}>Close</button></div>
    <p className="muted">{roleName} · Only the selected rows on this page are included.</p>
    <fieldset disabled={busy} className="table-tools-fields">
      <label>Field<select value={fieldId} onChange={(event) => { setFieldId(event.target.value); setValue(""); resetPreview(); }}>{options.map((option) => <option key={option.id} value={option.id}>{option.label}{option.shared ? " · Shared profile" : " · This role"}</option>)}</select></label>
      <label>Edit mode<select value={mode} onChange={(event) => { setMode(event.target.value as EditMode); resetPreview(); }}><option value="fill_empty">Fill empty cells only</option><option value="replace">Replace existing values</option><option value="clear">Clear values</option></select></label>
      {mode !== "clear" && <label>New value{field.kind === "select" || field.kind === "boolean" ?
        <select value={value} onChange={(event) => { setValue(event.target.value); resetPreview(); }}><option value="">Choose a value</option>{(field.kind === "boolean" ? ["true","false"] : field.options ?? []).map((option) => <option key={option} value={option}>{field.kind === "boolean" ? option === "true" ? "Yes" : "No" : option}</option>)}</select> :
        field.id.endsWith("notes") ? <textarea value={value} maxLength={4000} onChange={(event) => { setValue(event.target.value); resetPreview(); }} /> :
        <input type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"} step="any" value={value} onChange={(event) => { setValue(event.target.value); resetPreview(); }} />}</label>}
    </fieldset>
    {field.shared && <p className="table-tools-notice">This edits shared profiles. The value will also appear in every other role using these candidates.</p>}
    {field.id === "rating" && <p className="table-tools-notice">Ratings meeting the role threshold move All profiles rows to Profile shortlisted.</p>}
    {field.id === "client_notes" && <p className="table-tools-notice">These notes are visible through existing client share links.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {preview && <section aria-label="Bulk edit preview">
      <p role="status"><strong>{preview.changed} rows will change</strong> · {preview.skipped} unchanged{preview.shared ? ` · ${preview.otherRoleMemberships} other role memberships use these profiles` : ""}</p>
      <div className="table-tools-preview"><table><thead><tr><th>Candidate</th><th>Before</th><th>After</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.id}><td>{row.name}</td><td>{displayEditValue(row.before)}</td><td>{displayEditValue(row.after)}</td></tr>)}</tbody></table></div>
      <p className="muted">Changes are saved together and recorded in Edit history. If a selected record changes after preview, you will be asked to preview again.</p>
    </section>}
    <div className="row table-tools-actions"><button disabled={busy} onClick={() => void submit(false)}>{busy ? "Working…" : "Preview changes"}</button>{preview && <button className="primary" disabled={busy || preview.changed === 0} onClick={() => void submit(true)}>Apply to {preview.changed} row{preview.changed === 1 ? "" : "s"}</button>}</div>
  </TableDialog>;
}
