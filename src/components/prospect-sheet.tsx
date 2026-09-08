"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import {
  contactStatuses,
  type Prospect,
  type ContactStatus,
} from "@/lib/prospects";

async function save(action: string, payload: unknown) {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  if (!response.ok)
    throw new Error(
      (await response.json()).error ?? "Could not save. Try again.",
    );
}
function ProspectRow({ row, number }: { row: Prospect; number: number }) {
  const [status, setStatus] = useState(row.contact_status);
  const [notes, setNotes] = useState(row.notes);
  const [savedNotes, setSavedNotes] = useState(row.notes);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function update(next?: ContactStatus) {
    if (saving || (next === undefined && notes === savedNotes)) return;
    setSaving(true);
    setError("");
    setMessage("");
    const previous = status;
    if (next) setStatus(next);
    try {
      await save(next ? "contact" : "note", {
        clientId: row.client_id,
        profileId: row.id,
        ...(next ? { status: next } : { note: notes }),
      });
      if (!next) setSavedNotes(notes);
      setMessage("Saved");
    } catch (e) {
      if (next) setStatus(previous);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <tr>
      <td className="sheet-number">{number}</td>
      <td>
        <div className="sheet-text sheet-title">
          {row.title || "Untitled profile"}
        </div>
      </td>
      <td>
        <a
          className="sheet-url"
          href={row.canonical_url}
          target="_blank"
          rel="noreferrer"
        >
          {row.canonical_url}
        </a>
      </td>
      <td>
        <div className="sheet-text">{row.snippet || "—"}</div>
      </td>
      <td>
        <select
          aria-label={`Contact status for ${row.title}`}
          value={status}
          disabled={saving}
          onChange={(e) => void update(e.target.value as ContactStatus)}
        >
          {Object.entries(contactStatuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <textarea
          aria-label={`Notes for ${row.title}`}
          value={notes}
          maxLength={4000}
          disabled={saving}
          placeholder="Add a note…"
          rows={2}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => void update()}
        />
        <div className="sheet-save" aria-live="polite">
          {saving ? (
            "Saving…"
          ) : error ? (
            <span role="alert">{error}</span>
          ) : notes !== savedNotes ? (
            <button onClick={() => void update()}>Save note</button>
          ) : (
            message
          )}
        </div>
      </td>
      <td>
        <div className="sheet-text">
          <code>{row.source_query || "—"}</code>
          <small>{row.campaign_name}</small>
        </div>
      </td>
      <td>
        <time dateTime={row.date_added}>
          {new Date(row.date_added).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </time>
      </td>
    </tr>
  );
}
export function ProspectSheet({
  rows,
  total,
  page,
  clientId,
  clientName,
}: {
  rows: Prospect[];
  total: number;
  page: number;
  clientId: string;
  clientName: string;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const path = `/clients/${clientId}/prospects`;
  const url = (changes: Record<string, string>) => {
    const p = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) =>
      v ? p.set(k, v) : p.delete(k),
    );
    return `${path}?${p}`;
  };
  async function exportRows(format: "csv" | "tsv") {
    setExporting(true);
    setError("");
    setMessage("");
    try {
      const p = new URLSearchParams(params);
      p.set("sheet", "1");
      p.set("client", clientId);
      p.set("format", format);
      const response = await fetch(`/api/export?${p}`);
      if (!response.ok) throw new Error((await response.json()).error);
      const text = await response.text();
      if (format === "tsv") {
        await navigator.clipboard.writeText(text);
        setMessage("Copied. Paste into Google Sheets.");
      } else {
        const blob = URL.createObjectURL(
          new Blob([text], { type: "text/csv;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = blob;
        a.download = "leadscope-prospects.csv";
        a.click();
        URL.revokeObjectURL(blob);
        setMessage("Exported all matching prospects.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <section aria-busy={pending}>
      <header className="page-header">
        <div>
          <div className="eyebrow">{clientName}</div>
          <h1>
            Prospect sheet <span className="count">{total}</span>
          </h1>
          <p className="muted">
            Accepted profiles across all campaigns. One row per LinkedIn URL.
          </p>
        </div>
        <div className="header-actions">
          <button disabled={exporting} onClick={() => void exportRows("tsv")}>
            Copy for Sheets
          </button>
          <button
            className="primary"
            disabled={exporting}
            onClick={() => void exportRows("csv")}
          >
            {exporting ? "Preparing…" : "Export CSV"}
          </button>
        </div>
      </header>
      <form
        className="sheet-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          startTransition(() =>
            router.push(
              url({
                q: String(f.get("q") ?? ""),
                contact: String(f.get("contact") ?? ""),
                page: "",
              }),
            ),
          );
        }}
      >
        <input
          name="q"
          aria-label="Search prospects"
          placeholder="Search title, URL, snippet or notes…"
          defaultValue={params.get("q") ?? ""}
        />
        <select
          name="contact"
          aria-label="Filter contact status"
          defaultValue={params.get("contact") ?? ""}
        >
          <option value="">All contact statuses</option>
          {Object.entries(contactStatuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button disabled={pending}>{pending ? "Loading…" : "Filter"}</button>
        <Link href={path}>Clear</Link>
      </form>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="card sheet-wrap">
        <table className="prospect-sheet">
          <caption className="sr-only">
            Accepted prospects for {clientName}
          </caption>
          <thead>
            <tr>
              {[
                "#",
                "Title",
                "LinkedIn URL",
                "Snippet",
                "Prospect contacted",
                "Notes",
                "Query info",
                "Date added",
              ].map((label) => (
                <th scope="col" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <ProspectRow
                key={`${row.id}:${row.notes}:${row.contact_status}`}
                row={row}
                number={(page - 1) * 50 + i + 1}
              />
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">
            <h3>
              {total
                ? "No prospects on this page"
                : "No matching accepted prospects"}
            </h3>
            <p>Accept profiles in Leads & review to add them here.</p>
            <Link href={`/leads?client=${clientId}`}>Open Leads & review</Link>
          </div>
        )}
      </div>
      <div className="sheet-footer">
        <span>
          {total
            ? `${(page - 1) * 50 + 1}–${Math.min(page * 50, total)} of ${total}`
            : "0 prospects"}{" "}
          · Changes save automatically · Export includes all filtered pages
        </span>
        <div className="row">
          {page > 1 && (
            <Link
              className="button small"
              href={url({ page: String(page - 1) })}
            >
              Previous
            </Link>
          )}
          {page * 50 < total && (
            <Link
              className="button small"
              href={url({ page: String(page + 1) })}
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
