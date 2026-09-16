"use client";

import { useState } from "react";
import { CircleHelp, X } from "lucide-react";
import type { RoleField, ShareLink } from "@/lib/types";

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

const shareColumns = [
  "stage_entered_at",
  "full_name",
  "headline",
  "current_designation",
  "current_company",
  "location",
  "total_experience_years",
  "rating",
  "client_notes",
];

function status(link: ShareLink): { label: string; badge: string } {
  if (link.revoked_at) return { label: "Revoked", badge: "rejected" };
  if (link.expires_at && new Date(link.expires_at) <= new Date())
    return { label: "Expired", badge: "suppressed" };
  return { label: "Active", badge: "accepted" };
}

const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

function defaultExpiry() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 14);
  return [
    expiry.getFullYear(),
    String(expiry.getMonth() + 1).padStart(2, "0"),
    String(expiry.getDate()).padStart(2, "0"),
  ].join("-");
}

export function ShareDialog({
  clientId,
  roleId,
  links,
  fields,
  onClose,
  onChanged,
}: {
  clientId: string;
  roleId: string;
  links: ShareLink[];
  fields: RoleField[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justCreated, setJustCreated] = useState<{ url: string; copied: boolean } | null>(null);

  function shareUrl(token: string) {
    return `${window.location.origin}/share/${token}`;
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setJustCreated((current) => (current ? { ...current, copied: true } : current));
    } catch {
      // The full URL remains visible for browsers that block clipboard access.
    }
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await act<{ token: string }>("createShareLink", {
        clientId,
        roleId,
        visibleColumns: [...shareColumns, ...fields.map((field) => field.key)],
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
      });
      setJustCreated({ url: shareUrl(result.token), copied: false });
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
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
    } catch (reason) {
      setError((reason as Error).message);
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
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog open className="modal">
      <div className="modal-heading">
        <h2>Share with client</h2>
        <button aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {justCreated ? (
        <div className="notice">
          <CircleHelp size={18} />
          <div>
            <strong>Copy this link now — it will not be shown again.</strong>
            <p className="muted">
              Your client can view Recruiter Shortlisted candidates and their custom columns.
              They can edit Notes only.
            </p>
            <div className="row">
              <input readOnly value={justCreated.url} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={() => void copy(justCreated.url)}>
                {justCreated.copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button type="button" onClick={() => setJustCreated(null)}>Done</button>
          </div>
        </div>
      ) : (
        <>
          <p className="muted">
            This link shares every available recruiter-shortlist column, including custom
            columns. It never shows pipeline actions, rejection controls, or other tabs.
          </p>
          <label>
            Expires <span className="optional">optional</span>
            <input
              type="date"
              disabled={busy}
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <button className="primary wide" disabled={busy} onClick={() => void create()}>
            {busy ? "Creating…" : "Create client link"}
          </button>
        </>
      )}
      {links.length > 0 && (
        <>
          <h3>Existing client links</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Link</th><th>Access</th><th>State</th><th>Last viewed</th><th /></tr>
              </thead>
              <tbody>
                {links.map((link) => {
                  const current = status(link);
                  return (
                    <tr key={link.id}>
                      <td><code>{link.token_prefix}…</code><small>Created {date(link.created_at)}</small></td>
                      <td>View candidates · edit Notes</td>
                      <td><span className={`badge ${current.badge}`}>{current.label}</span></td>
                      <td>{date(link.last_viewed_at)}</td>
                      <td>
                        <div className="row">
                          {!link.revoked_at && <button className="small" disabled={busy} onClick={() => void revoke(link.id)}>Revoke</button>}
                          <button className="small" disabled={busy} onClick={() => void regenerate(link.id)}>Regenerate</button>
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
    </dialog>
  );
}
