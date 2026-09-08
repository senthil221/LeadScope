"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { parseExcludedUrls } from "@/lib/exclusions";
import type { PageData, Suppression } from "@/lib/types";

async function action<T>(name: string, payload: unknown): Promise<T> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: name, payload }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "Could not save exclusions. Try again.");
  return result;
}
export function ExcludedProfiles({ data }: { data: PageData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const parsed = parseExcludedUrls(text);
  const client = data.client!;
  const path = `/clients/${client.id}/excluded`;
  const page = data.page ?? 1;
  const total = data.total ?? 0;
  const pageUrl = (n: number) => {
    const p = new URLSearchParams(params);
    p.set("page", String(n));
    return `${path}?${p}`;
  };
  async function add() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action<{ added: number; alreadyExcluded: number }>(
        "exclude",
        { clientId: client.id, text },
      );
      setMessage(
        `${result.added} profiles excluded. ${result.alreadyExcluded} were already on this client’s list.`,
      );
      setText("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(row: Suppression) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action("suppression", {
        clientId: client.id,
        url: row.canonical_url,
        reason: row.reason,
        note: row.note,
        active: false,
      });
      setMessage(
        "Exclusion removed. Existing profiles return to Review; accept them again to include them in the sheet.",
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">{client.name}</div>
          <h1>Excluded</h1>
          <p className="muted">
            Block LinkedIn profiles you already have. Matches stay out of this
            client’s Prospect sheet and exports.
          </p>
        </div>
        <Link className="button" href={`/clients/${client.id}/prospects`}>
          Open prospect sheet
        </Link>
      </header>
      <form
        className="card form-card"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label>
          Paste LinkedIn URLs
          <textarea
            aria-label="Excluded LinkedIn URLs"
            rows={5}
            value={text}
            maxLength={50000}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your LinkedIn URL column here, one profile per line."
          />
        </label>
        <p className="muted">
          Up to 500 profiles per paste. Links with tracking parameters or
          country subdomains are matched automatically. This also hides profiles
          already accepted for this client.
        </p>
        {text.trim() && (
          <p>
            {parsed.urls.length} unique URLs · {parsed.duplicates} duplicates
            skipped · {parsed.invalid.length} invalid entries
          </p>
        )}
        {parsed.invalid.length > 0 && (
          <div className="error" role="alert">
            Fix these entries before saving:{" "}
            <span>
              {parsed.invalid
                .slice(0, 3)
                .map((t) => t.slice(0, 100))
                .join(", ")}
              {parsed.invalid.length > 3 ? " …" : ""}
            </span>
          </div>
        )}
        {parsed.urls.length > 500 && (
          <p className="error" role="alert">
            Paste up to 500 URLs at a time.
          </p>
        )}
        <div className="row">
          <button
            className="primary"
            disabled={
              busy ||
              !parsed.urls.length ||
              parsed.urls.length > 500 ||
              !!parsed.invalid.length
            }
          >
            {busy ? "Saving…" : "Add to Excluded"}
          </button>
          <small>Applies only to {client.name}.</small>
        </div>
      </form>
      {message && (
        <p className="toast success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="toast error" role="alert">
          {error}
        </p>
      )}
      <div className="section-heading">
        <h2>
          Excluded profiles <span className="count">{total}</span>
        </h2>
      </div>
      <form
        className="sheet-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const q = String(f.get("q") ?? "").trim();
          router.push(`${path}?${new URLSearchParams(q ? { q } : {})}`);
        }}
      >
        <input
          name="q"
          aria-label="Search excluded URLs"
          placeholder="Find an excluded LinkedIn URL…"
          defaultValue={params.get("q") ?? ""}
        />
        <button>Search</button>
        <Link href={path}>Clear</Link>
      </form>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>LinkedIn URL</th>
              <th>Reason</th>
              <th>Added / updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.suppressions?.map((row) => (
              <tr key={row.id}>
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
                <td>{row.reason}</td>
                <td>{new Date(row.updated_at).toLocaleDateString()}</td>
                <td>
                  <button
                    className="small"
                    disabled={busy}
                    onClick={() => void remove(row)}
                  >
                    Remove exclusion
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.suppressions?.length && (
          <div className="empty">
            <h3>
              {params.get("q")
                ? "No matching exclusions"
                : "No excluded profiles yet"}
            </h3>
            <p>
              Paste LinkedIn URLs above to keep old prospects out of new lists.
            </p>
          </div>
        )}
      </div>
      <div className="sheet-footer">
        <span>{total} matching exclusions</span>
        <div className="row">
          {page > 1 && (
            <Link className="button small" href={pageUrl(page - 1)}>
              Previous
            </Link>
          )}
          {page * 50 < total && (
            <Link className="button small" href={pageUrl(page + 1)}>
              Next
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
