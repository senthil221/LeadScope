"use client";
import { useEffect, useState } from "react";
import { X, Copy, ExternalLink } from "lucide-react";
import { act } from "@/lib/client/act";
export function ShareDialog({ clientId, roleId, onClose }: {
  clientId: string; roleId: string; onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    act<{ token: string }>("getRoleShareLink", { clientId, roleId })
      .then((result) => { if (active) setUrl(window.location.origin + "/share/" + result.token); })
      .catch((reason) => { if (active) setError((reason as Error).message); });
    return () => { active = false; };
  }, [clientId, roleId]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { setError("Select the link below and copy it manually."); }
  }
  return <dialog open className="modal" aria-labelledby="share-title">
    <div className="modal-heading"><h2 id="share-title">Share with client</h2><button aria-label="Close" onClick={onClose}><X size={18} /></button></div>
    <p className="muted">One permanent link for this role. Recruiter shortlisted, client shortlisted and offer sent profiles stay in the live sheet. All candidate and custom columns are visible. Internal notes remain private.</p>
    <p className="muted">Clients can add feedback. Profile details, ratings and new custom columns update automatically.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {url ? <><label>Role&apos;s client link<input readOnly value={url} onFocus={(event) => event.currentTarget.select()} /></label>
      <div className="row"><button className="primary" onClick={() => void copy()}><Copy size={15} />{copied ? "Copied" : "Copy link"}</button>
      <a className="button" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open client sheet</a></div>
    </> : !error && <p role="status">Loading role link…</p>}
  </dialog>;
}
