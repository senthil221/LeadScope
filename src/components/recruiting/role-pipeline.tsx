"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Archive, CircleHelp } from "lucide-react";
import type { Client, MasterCandidate, Role, RoleCandidate } from "@/lib/types";
import {
  stages,
  stageLabels,
  isStage,
  rejectionTypes,
  type Stage,
} from "@/lib/recruiting/stages";
import { RoleFormDialog } from "./role-form";

async function act<T = { id: string }>(
  action: string,
  payload: unknown = {},
): Promise<T> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "The action failed. Try again.");
  return result;
}

type Tab = Stage | "master_db";
const tabs: { key: Tab; label: string }[] = [
  ...stages
    .filter((s) => s !== "rejected")
    .map((s) => ({ key: s as Tab, label: stageLabels[s] })),
  { key: "rejected", label: "Rejects" },
  { key: "master_db", label: "Master DB" },
];

const date = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

function candidateEmptyMessage(tab: Tab) {
  if (tab === "master_db") return "No candidates in the master database yet.";
  if (tab === "rejected") return "No candidates rejected yet.";
  if (tab === "all_profiles")
    return "No candidates yet. Add candidates from LinkedIn, Naukri, manual entry, or a CSV import.";
  return `No candidates in ${stageLabels[tab as Stage].toLowerCase()} yet.`;
}

export function RolePipeline({
  client,
  role,
  roleCandidates,
  counts,
  masterCandidates,
  total,
  page,
}: {
  client: Client;
  role: Role;
  roleCandidates: RoleCandidate[];
  counts: Record<string, number>;
  masterCandidates: MasterCandidate[];
  total: number;
  page: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = isStage(params.get("stage") ?? "")
    ? (params.get("stage") as Tab)
    : params.get("stage") === "master_db"
      ? "master_db"
      : "all_profiles";
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `/roles/${role.id}`;
  const pipelineTotal = Object.entries(counts)
    .filter(([stage]) => stage !== "rejected")
    .reduce((sum, [, n]) => sum + n, 0);

  const tabUrl = (key: Tab) => {
    const p = new URLSearchParams();
    p.set("stage", key);
    return `${path}?${p}`;
  };
  const masterDbUrl = (changes: Record<string, string>) => {
    const p = new URLSearchParams(params);
    p.set("stage", "master_db");
    Object.entries(changes).forEach(([k, v]) =>
      v ? p.set(k, v) : p.delete(k),
    );
    return `${path}?${p}`;
  };

  async function toggleArchive() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await act("archiveRole", { id: role.id, archived: !role.archived });
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
          <h1>{role.name}</h1>
          <p className="muted">
            {role.description || "Track this role's candidate pipeline."}
          </p>
        </div>
        <div className="header-actions">
          <button onClick={() => setEditing(true)}>Edit role</button>
          <button disabled={busy} onClick={() => void toggleArchive()}>
            <Archive size={16} />
            {role.archived ? "Restore" : "Archive"}
          </button>
        </div>
      </header>
      {error && (
        <p className="toast error" role="alert">
          {error}
        </p>
      )}
      {role.archived && (
        <div className="notice">
          <CircleHelp size={18} />
          <div>
            This role is archived. Restore it to continue moving candidates
            through the pipeline.
          </div>
        </div>
      )}
      <div className="metrics">
        {[
          ["In pipeline", pipelineTotal, "Not yet rejected"],
          [
            "All profiles",
            counts.all_profiles ?? 0,
            "Awaiting a rating",
          ],
          ["Rejected", counts.rejected ?? 0, "Kept for history"],
          ["Rating threshold", `${role.rating_threshold} / 5`, "To advance"],
        ].map(([label, value, hint]) => (
          <div className="metric" key={label as string}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="tabs">
        {tabs.map(({ key, label }) => (
          <Link
            key={key}
            className={tab === key ? "selected" : ""}
            href={tabUrl(key)}
          >
            {label}
            <span>
              {key === "master_db" ? total : (counts[key] ?? 0)}
            </span>
          </Link>
        ))}
      </div>
      {tab === "master_db" ? (
        <>
          <form
            className="sheet-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              router.push(masterDbUrl({ q: String(f.get("q") ?? "") }));
            }}
          >
            <input
              name="q"
              aria-label="Search the master candidate database"
              placeholder="Search name, headline, company or email…"
              defaultValue={params.get("q") ?? ""}
            />
            <button>Search</button>
            <Link href={masterDbUrl({ q: "" })}>Clear</Link>
          </form>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Full name</th>
                  <th>Headline</th>
                  <th>Company</th>
                  <th>Location</th>
                  <th>Experience</th>
                  <th>Contact</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {masterCandidates.map((c) => (
                  <tr key={c.id}>
                    <td className="strong">{c.full_name}</td>
                    <td>{c.headline || "—"}</td>
                    <td>{c.current_company || "—"}</td>
                    <td>{c.location || "—"}</td>
                    <td>
                      {c.total_experience_years != null
                        ? `${c.total_experience_years} yrs`
                        : "—"}
                    </td>
                    <td>
                      {c.phone || c.email ? (
                        <span className="badge accepted">Available</span>
                      ) : (
                        <span className="badge">None yet</span>
                      )}
                    </td>
                    <td>{date(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!masterCandidates.length && (
              <div className="empty">
                <h3>{candidateEmptyMessage(tab)}</h3>
              </div>
            )}
          </div>
          <div className="sheet-footer">
            <span>
              {total
                ? `${(page - 1) * 50 + 1}–${Math.min(page * 50, total)} of ${total}`
                : "0 candidates"}
            </span>
            <div className="row">
              {page > 1 && (
                <Link
                  className="button small"
                  href={masterDbUrl({ page: String(page - 1) })}
                >
                  Previous
                </Link>
              )}
              {page * 50 < total && (
                <Link
                  className="button small"
                  href={masterDbUrl({ page: String(page + 1) })}
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date added</th>
                <th>Full name</th>
                <th>Designation</th>
                <th>Company</th>
                <th>Experience</th>
                {tab === "rejected" ? (
                  <>
                    <th>Reject type</th>
                    <th>Reason</th>
                  </>
                ) : (
                  <th>Rating</th>
                )}
              </tr>
            </thead>
            <tbody>
              {roleCandidates.map((rc) => (
                <tr key={rc.id}>
                  <td>{date(rc.stage_entered_at)}</td>
                  <td className="strong">{rc.candidates.full_name}</td>
                  <td>{rc.candidates.current_designation || "—"}</td>
                  <td>{rc.candidates.current_company || "—"}</td>
                  <td>
                    {rc.candidates.total_experience_years != null
                      ? `${rc.candidates.total_experience_years} yrs`
                      : "—"}
                  </td>
                  {tab === "rejected" ? (
                    <>
                      <td>
                        {rc.rejection_type
                          ? rejectionTypes[rc.rejection_type as "recruiter" | "client"]
                          : "—"}
                      </td>
                      <td>{rc.rejection_reason || "—"}</td>
                    </>
                  ) : (
                    <td>{rc.rating != null ? `${rc.rating} / 5` : "Not rated"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!roleCandidates.length && (
            <div className="empty">
              <h3>{candidateEmptyMessage(tab)}</h3>
            </div>
          )}
        </div>
      )}
      {editing && (
        <RoleFormDialog
          clientId={client.id}
          role={role}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
