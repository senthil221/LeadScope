"use client";
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { act } from "@/lib/client/act";
import { TableDialog } from "./table-dialog";

export type Recruiter = { id: string; name: string; archived: boolean };

// One copy of the list for the whole page. Every dropdown reads it, so
// adding a name from any of them shows up in all of them at once, and a table
// of roles asks the server for it once rather than once a row.
const store = {
  list: null as Recruiter[] | null,
  listeners: new Set<() => void>(),
  loading: null as Promise<void> | null,
};
function emit() {
  store.listeners.forEach((listener) => listener());
}
export async function reloadRecruiters() {
  store.list = await act<Recruiter[]>("recruiters");
  emit();
}
function subscribe(listener: () => void) {
  store.listeners.add(listener);
  if (!store.list && !store.loading)
    store.loading = reloadRecruiters()
      .catch(() => {
        // Leave the list empty; each dropdown still shows its current value.
      })
      .finally(() => {
        store.loading = null;
      });
  return () => store.listeners.delete(listener);
}
export function useRecruiters() {
  return useSyncExternalStore(
    subscribe,
    () => store.list,
    () => null,
  );
}

const MANAGE = "__manage";

// The dropdown itself. It shows the current choice even before the list has
// arrived, and even if that person has since been removed from the list - a
// role keeps who worked it.
export function RecruiterSelect({
  value,
  onChoose,
  disabled = false,
  label,
  className = "",
}: {
  value: string;
  onChoose: (name: string) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const list = useRecruiters();
  const [managing, setManaging] = useState(false);
  const active = (list ?? []).filter((recruiter) => !recruiter.archived);
  const offered = active.some((recruiter) => recruiter.name === value);
  return (
    <>
      <select
        className={`recruiter-select ${className}`.trim()}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          if (next === MANAGE) {
            setManaging(true);
            return;
          }
          if (next !== value) onChoose(next);
        }}
      >
        <option value="">Unassigned</option>
        {active.map((recruiter) => (
          <option key={recruiter.id} value={recruiter.name}>
            {recruiter.name}
          </option>
        ))}
        {value && !offered && (
          <option value={value}>{list ? `${value} (removed)` : value}</option>
        )}
        <option disabled>──────────</option>
        <option value={MANAGE}>Edit names…</option>
      </select>
      {/* Out of whatever the dropdown sits in - a label inside the role form,
          a table cell - so the dialog is not nested in either. */}
      {managing &&
        createPortal(
          <ManageRecruitersDialog onClose={() => setManaging(false)} />,
          document.body,
        )}
    </>
  );
}

// Adding and removing names. Removing only stops a name being offered; the
// roles already assigned to that person keep it.
export function ManageRecruitersDialog({ onClose }: { onClose: () => void }) {
  const list = useRecruiters();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await reloadRecruiters();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function add() {
    const next = name.trim();
    if (!next || busy) return;
    void run(async () => {
      await act("saveRecruiter", { name: next });
      setName("");
    });
  }
  const active = (list ?? []).filter((recruiter) => !recruiter.archived);
  return (
    <TableDialog titleId="recruiters-title" busy={busy} onClose={onClose} className="recruiters-dialog">
      <div className="modal-heading">
        <h2 id="recruiters-title">Recruiters</h2>
        <button type="button" aria-label="Close" disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        The names offered in every role&rsquo;s recruiter dropdown. Removing a
        name stops it being offered; roles already assigned keep it.
      </p>
      <ul className="recruiters-list">
        {active.map((recruiter) => (
          <li key={recruiter.id}>
            <span>{recruiter.name}</span>
            <button
              type="button"
              className="small"
              disabled={busy}
              onClick={() => void run(() => act("archiveRecruiter", { id: recruiter.id }))}
            >
              Remove
            </button>
          </li>
        ))}
        {list && !active.length && <li className="muted">No names yet.</li>}
        {!list && <li className="muted">Loading…</li>}
      </ul>
      {/* Not a form: this dialog can open from inside the role form, and a
          submit here must never become a submit there. */}
      <div className="recruiters-add">
        <input
          data-dialog-autofocus
          aria-label="New recruiter name"
          placeholder="Add a name"
          maxLength={120}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <button className="primary" type="button" disabled={busy || !name.trim()} onClick={add}>
          Add
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </TableDialog>
  );
}
