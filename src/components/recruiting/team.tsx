"use client";

import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { act as sharedAct } from "@/lib/client/act";

export type Operator = {
  id: string;
  email: string;
  approved: boolean;
  owner: boolean;
  confirmed: boolean;
  createdAt: string;
  lastSignInAt: string | null;
};

function act<T = void>(action: string, payload: unknown = {}): Promise<T> {
  return sharedAct<T>(action, payload, "Could not save. Try again.");
}

const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Never";

export function TeamPage({
  operators,
  currentEmail,
}: {
  operators: Operator[];
  currentEmail: string;
}) {
  const [rows, setRows] = useState(operators);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState<Operator | null>(null);

  async function setAccess(operator: Operator, approved: boolean) {
    setBusyId(operator.id);
    setError("");
    try {
      await act("setOperatorAccess", { id: operator.id, approved });
      setRows((current) =>
        current.map((row) => (row.id === operator.id ? { ...row, approved } : row)),
      );
      setMessage(
        approved
          ? `${operator.email} now has access.`
          : `${operator.email} no longer has access.`,
      );
      setTimeout(() => setMessage(""), 4000);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  const waiting = rows.filter((row) => !row.approved && !row.owner);

  return (
    <section className="team-page">
      <div className="page-header">
        <div>
          <h1>Access</h1>
          <p className="muted">
            Everyone who has created an account. Approving someone gives them the
            same access you have: every client, role and candidate.
          </p>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{message}</span>
        </p>
      )}

      {/* Deliberately not "waiting for approval": an account you revoked is
          not waiting for anything, and saying so invites approving it again. */}
      {waiting.length > 0 && (
        <p className="team-waiting">
          {waiting.length} {waiting.length === 1 ? "account has" : "accounts have"} no
          access.
        </p>
      )}

      <div className="card table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Access</th>
              <th scope="col">Signed up</th>
              <th scope="col">Last signed in</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((operator) => {
              const isYou = operator.email === currentEmail;
              return (
                <tr key={operator.id}>
                  <th scope="row">
                    {operator.email}
                    {isYou && <span className="team-you">you</span>}
                  </th>
                  <td>
                    {operator.owner ? (
                      <span className="badge accepted">Owner</span>
                    ) : operator.approved ? (
                      <span className="badge accepted">Full access</span>
                    ) : (
                      <span className="badge">No access</span>
                    )}
                  </td>
                  <td>{when(operator.createdAt)}</td>
                  <td>{when(operator.lastSignInAt)}</td>
                  <td>
                    {/* The owner row has no control: revoking it is what would
                        leave nobody able to grant access again. */}
                    {operator.owner ? (
                      <span className="muted">—</span>
                    ) : operator.approved ? (
                      <button
                        className="small"
                        disabled={busyId === operator.id}
                        onClick={() => setConfirming(operator)}
                      >
                        {busyId === operator.id ? "Removing…" : "Remove access"}
                      </button>
                    ) : (
                      <button
                        className="small primary"
                        disabled={busyId === operator.id}
                        onClick={() => void setAccess(operator, true)}
                      >
                        {busyId === operator.id ? "Approving…" : "Approve"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">
            <h3>No accounts yet</h3>
          </div>
        )}
      </div>

      {confirming && (
        <dialog open className="modal">
          <div className="modal-heading">
            <h2>Remove access for {confirming.email}?</h2>
            <button aria-label="Close" onClick={() => setConfirming(null)}>
              <X size={18} />
            </button>
          </div>
          <p>
            They keep their account and can sign in, but every client, role and
            candidate stops loading for them. You can approve them again at any
            time.
          </p>
          <div className="row">
            <button
              className="primary"
              disabled={busyId === confirming.id}
              onClick={() => void setAccess(confirming, false)}
            >
              {busyId === confirming.id ? "Removing…" : "Remove access"}
            </button>
            <button disabled={busyId === confirming.id} onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
