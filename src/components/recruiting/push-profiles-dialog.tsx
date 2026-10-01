"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { act } from "@/lib/client/act";

type Target = { id: string; name: string; clientName: string };
export type PushResult = { added: number; alreadyInRole: number; matched: number };
export function PushProfilesDialog({ sourceRoleId, candidateIds, membershipIds, onClose, onPushed }: {
  sourceRoleId?: string; candidateIds?: string[]; membershipIds?: string[]; onClose: () => void;
  onPushed: (result: PushResult, roleId: string) => void;
}) {
  const [roles, setRoles] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState("");
  const [above, setAbove] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    act<Target[]>("profilePushTargets", { sourceRoleId })
      .then((rows) => { if (active) setRoles(rows); })
      .catch((reason) => { if (active) setError((reason as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sourceRoleId]);
  async function push(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !target) return;
    setBusy(true); setError("");
    try {
      const result = await act<PushResult>("pushProfiles", {
        targetRoleId: target, sourceRoleId, candidateIds, membershipIds,
        aboveRating: above === "" ? null : Number(above),
      });
      onPushed(result, target);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <dialog open className="modal" aria-labelledby="push-title">
    <div className="modal-heading"><h2 id="push-title">Push profiles to a role</h2><button aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button></div>
    <p className="muted">{candidateIds || membershipIds ? `${(candidateIds ?? membershipIds)!.length} selected profiles` : "Profiles across every stage of this role"}. New entries start in All profiles with a blank role rating. Existing entries are skipped.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <form onSubmit={(event) => void push(event)}>
      <label>Target role<select required value={target} disabled={busy || loading} onChange={(event) => setTarget(event.target.value)}>
        <option value="">{loading ? "Loading roles…" : "Choose an open role"}</option>
        {roles.map((role) => <option key={role.id} value={role.id}>{role.clientName} / {role.name}</option>)}
      </select></label>
      {!loading && !roles.length && <p className="muted">Create another open role to push profiles.</p>}
      {sourceRoleId && <label>Only push profiles rated above <span className="optional">optional</span>
        <input aria-label="Above rating" type="number" min="0" max="5" step="0.1" value={above} disabled={busy} placeholder="Any rating, including blank" onChange={(event) => setAbove(event.target.value)} />
        <small>Uses this source role&apos;s rating. A threshold excludes blank ratings and profiles equal to the threshold.</small>
      </label>}
      <button className="primary wide" disabled={busy || !target} type="submit">{busy ? "Pushing…" : "Push profiles"}</button>
    </form>
  </dialog>;
}
