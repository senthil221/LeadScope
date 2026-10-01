"use client";
import { useState } from "react";
import type { Role } from "@/lib/types";
import { act } from "@/lib/client/act";

export function RoleBrief({ role, onSaved }: { role: Role; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return <details className="role-brief">
    <summary>Role Brief <span className="muted">{role.jd_name ? `JD: ${role.jd_name}` : "Hiring context and job description"}</span></summary>
    <div className="role-brief-content">
      <form key={role.revision} onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        setBusy(true); setError(""); setMessage("");
        try {
          await act("role", { id: role.id, clientId: role.client_id, name: role.name, description: role.description, ratingThreshold: role.rating_threshold, status: role.status, expectedRevision: role.revision, recruiterNames: role.recruiter_names ?? [], ctc: role.ctc ?? "", roleBrief: String(data.get("brief")) });
          setMessage("Role brief saved."); onSaved();
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
      }}>
        <label>Role brief<textarea name="brief" rows={8} maxLength={50000} defaultValue={role.role_brief ?? ""} disabled={busy || role.archived} placeholder="Describe responsibilities, requirements, must-have skills and hiring context." /></label>
        <button className="primary" disabled={busy || role.archived}>{busy ? "Saving…" : "Save brief"}</button>
      </form>
      <div className="role-jd">
        <strong>Job description</strong>
        {role.jd_path && <a className="button small" href={`/api/role-jd?roleId=${role.id}`} target="_blank" rel="noreferrer">Open {role.jd_name || "JD"}</a>}
        <label>Attach or replace JD <span className="optional">PDF or Word, up to 10 MB</span>
          <input type="file" accept=".pdf,.doc,.docx" disabled={busy || role.archived} onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (!file || busy) return;
            setBusy(true); setError(""); setMessage("");
            try {
              const form = new FormData(); form.set("roleId", role.id); form.set("revision", String(role.revision)); form.set("file", file);
              const response = await fetch("/api/role-jd", { method: "POST", body: form });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error ?? "Could not attach JD.");
              setMessage("JD attached."); onSaved();
            } catch (e) { setError((e as Error).message); }
            finally { setBusy(false); }
          }} />
        </label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
