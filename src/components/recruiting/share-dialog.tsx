"use client";
import { useState } from "react";
import { CircleHelp, X } from "lucide-react";
import type { RoleField, ShareLink } from "@/lib/types";
import { stageLabels, type Stage } from "@/lib/recruiting/stages";

async function act<T>(action: string, payload: unknown): Promise<T> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not save. Try again.");
  return result;
}

// Every static field this stage could share, read-only. rating and every
// candidate detail can only ever be viewed; client_decision gets its own
// guided action in a later phase instead of a raw field edit, so it has no
// Editable checkbox either, even though it can be shared.
const staticColumns: { key: string; label: string }[] = [
  { key: "stage_entered_at", label: "Date added" },
  { key: "full_name", label: "Full name" },
  { key: "headline", label: "Headline" },
  { key: "current_designation", label: "Designation" },
  { key: "current_company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "total_experience_years", label: "Experience" },
  { key: "rating", label: "Rating" },
  { key: "client_notes", label: "Client notes" },
  { key: "client_decision", label: "Decision" },
  { key: "interview_at", label: "Interview date" },
];
// Only these static columns, plus any active custom field, can ever be made
// editable — enforced again on the server, since a client only ever gets as
// much write access as create_share_link actually allows.
const editableEligibleStatic = new Set(["client_notes", "interview_at"]);

function status(link: ShareLink): { label: string; badge: string } {
  if (link.revoked_at) return { label: "Revoked", badge: "rejected" };
  if (link.expires_at && new Date(link.expires_at) <= new Date())
    return { label: "Expired", badge: "suppressed" };
  return { label: "Active", badge: "accepted" };
}
const date = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

export function ShareDialog({
  clientId,
  roleId,
  stage,
  links,
  fields,
  onClose,
  onChanged,
}: {
  clientId: string;
  roleId: string;
  stage: Stage;
  links: ShareLink[];
  fields: RoleField[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [editableColumns, setEditableColumns] = useState<string[]>([]);
  const [allowDecisions, setAllowDecisions] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justCreated, setJustCreated] = useState<{ url: string; copied: boolean } | null>(null);

  function toggleVisible(key: string) {
    const wasVisible = selectedColumns.includes(key);
    setSelectedColumns((old) => (wasVisible ? old.filter((k) => k !== key) : [...old, key]));
    // A column that stops being visible cannot stay editable either.
    if (wasVisible) setEditableColumns((old) => old.filter((k) => k !== key));
  }
  function toggleEditable(key: string) {
    setEditableColumns((old) =>
      old.includes(key) ? old.filter((k) => k !== key) : [...old, key],
    );
  }
  function shareUrl(token: string) {
    return `${window.location.origin}/share/${token}`;
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setJustCreated((cur) => (cur ? { ...cur, copied: true } : cur));
    } catch {
      // Clipboard access can be denied by the browser; the link is still on
      // screen to select and copy by hand.
    }
  }

  async function create() {
    if (busy || !selectedColumns.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await act<{ token: string }>("createShareLink", {
        clientId,
        roleId,
        stage,
        visibleColumns: selectedColumns,
        editableColumns,
        allowDecisions,
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
      });
      setJustCreated({ url: shareUrl(result.token), copied: false });
      setSelectedColumns([]);
      setEditableColumns([]);
      setAllowDecisions(false);
      setExpiresAt("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await act("revokeShareLink", { id });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function regenerate(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await act<{ token: string }>("regenerateShareLink", { id });
      setJustCreated({ url: shareUrl(result.token), copied: false });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pickerRows = staticColumns.concat(
    fields.map((f) => ({ key: f.key, label: f.label })),
  );

  return (
    <dialog open className="modal">
      <div className="modal-heading">
        <h2>Share {stageLabels[stage]}</h2>
        <button aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {justCreated && (
        <div className="notice">
          <CircleHelp size={18} />
          <div>
            <strong>Copy this link now — it won&rsquo;t be shown again.</strong>
            <p className="muted">
              Anyone with this link can view {stageLabels[stage]} for this
              role, with no login. It stays live until you revoke it.
            </p>
            <div className="row">
              <input readOnly value={justCreated.url} onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => void copy(justCreated.url)}>
                {justCreated.copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button type="button" onClick={() => setJustCreated(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      {links.length > 0 && (
        <>
          <h3>Existing links for this stage</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Columns</th>
                  <th>State</th>
                  <th>Last viewed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {links.map((link) => {
                  const s = status(link);
                  const revoked = Boolean(link.revoked_at);
                  return (
                    <tr key={link.id}>
                      <td>
                        <code>{link.token_prefix}…</code>
                        <small>Created {date(link.created_at)}</small>
                      </td>
                      <td>
                        {link.visible_columns.length} columns
                        {link.allow_decisions && (
                          <>
                            <br />
                            <small className="muted">Decisions on</small>
                          </>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${s.badge}`}>{s.label}</span>
                      </td>
                      <td>{date(link.last_viewed_at)}</td>
                      <td>
                        <div className="row">
                          {!revoked && (
                            <button
                              className="small"
                              disabled={busy}
                              onClick={() => void revoke(link.id)}
                            >
                              Revoke
                            </button>
                          )}
                          <button
                            className="small"
                            disabled={busy}
                            onClick={() => void regenerate(link.id)}
                          >
                            Regenerate
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h3>Create a new link</h3>
      <p className="muted">
        Choose exactly what this link shows, and which of those the client
        can edit. Nothing is visible until you select it here.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Column</th>
              <th>Visible</th>
              <th>Editable</th>
            </tr>
          </thead>
          <tbody>
            {pickerRows.map((c) => {
              const field = fields.find((f) => f.key === c.key);
              const canEdit = field ? true : editableEligibleStatic.has(c.key);
              const visible = selectedColumns.includes(c.key);
              return (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${c.label} visible`}
                      disabled={busy}
                      checked={visible}
                      onChange={() => toggleVisible(c.key)}
                    />
                  </td>
                  <td>
                    {canEdit && (
                      <input
                        type="checkbox"
                        aria-label={`${c.label} editable`}
                        disabled={busy || !visible}
                        checked={editableColumns.includes(c.key)}
                        onChange={() => toggleEditable(c.key)}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          disabled={busy}
          checked={allowDecisions}
          onChange={(e) => setAllowDecisions(e.target.checked)}
        />
        Let the client Shortlist, Hold, or Reject candidates from this link
      </label>
      <label>
        Expires <span className="optional">optional</span>
        <input
          type="date"
          disabled={busy}
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
      </label>
      <button
        className="primary wide"
        disabled={busy || !selectedColumns.length}
        onClick={() => void create()}
      >
        {busy ? "Creating…" : "Create link"}
      </button>
    </dialog>
  );
}
