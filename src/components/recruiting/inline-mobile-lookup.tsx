"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, LoaderCircle } from "lucide-react";
import { formatMobile } from "@/lib/recruiting/contact";
import { mobileProviderLabels, mobileProviders, type MobileJob } from "@/lib/recruiting/mobile-waterfall";

const pendingStatuses = new Set(["queued", "running", "waiting", "waiting_setup", "needs_review"]);
const labels: Record<string, string> = {
  queued: "Queued", running: "Looking up", waiting: "Waiting for provider",
  waiting_setup: "Setup or credits needed", needs_review: "Request needs review",
  complete: "Complete", no_mobile: "0 phones found", failed: "Lookup failed", cancelled: "Cancelled",
};
type Status = { jobs: MobileJob[]; workerOnline: boolean };

// Only mounted for the cell being used. The shared table poller keeps tracking
// queued work after this control closes; closing never cancels a server job.
export function InlineMobileLookup({ roleId, candidateId, linkedin, onQueued, onSaved }: {
  roleId: string; candidateId: string; linkedin?: string; onQueued: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [collectAll, setCollectAll] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [requestChecked, setRequestChecked] = useState(false);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  const submitting = useRef(false);
  const seen = useRef<string | null>(null);
  const callbacks = useRef({ onQueued, onSaved });
  useEffect(() => { callbacks.current = { onQueued, onSaved }; }, [onQueued, onSaved]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const params = new URLSearchParams({ role: roleId, candidate: candidateId });
        const response = await fetch(`/api/mobile-waterfall?${params}`, { signal: controller.signal });
        const result: Status & { error?: string } = await response.json();
        if (!response.ok) throw new Error(result.error || "Lookup status unavailable.");
        if (controller.signal.aborted) return;
        const latest = result.jobs[0];
        const stamp = latest ? `${latest.id}:${latest.updated_at}` : null;
        if (seen.current !== null && seen.current !== stamp) callbacks.current.onSaved();
        if (seen.current !== stamp) { setMessage(""); setRequestChecked(false); }
        seen.current = stamp;
        setStatus(result);
        setChecking(false);
        setLoadError("");
        if (latest && pendingStatuses.has(latest.status)) timer = setTimeout(() => void poll(), 5000);
      } catch (e) {
        if (controller.signal.aborted) return;
        setLoadError((e as Error).message);
        // An unknown status must not enable a second paid lookup.
        setChecking(true);
        timer = setTimeout(() => void poll(), 10000);
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [roleId, candidateId, version]);

  async function post(payload: Record<string, unknown>) {
    if (submitting.current || checking) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/mobile-waterfall", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: roleId, ...payload }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start lookup.");
      if (payload.candidates) setMessage(result.missingLinkedIn ? "Add a LinkedIn URL first." : result.alreadyRunning ? "Already running" : "Queued");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      // Read the persisted queue even after a lost POST response. Never retry
      // that request automatically: it may already have reached the server.
      callbacks.current.onQueued();
      setChecking(true);
      setVersion((previous) => previous + 1);
      setBusy(false);
      submitting.current = false;
    }
  }

  const job = status?.jobs[0];
  const pending = Boolean(job && pendingStatuses.has(job.status));
  const moving = Boolean(job && ["queued", "running", "waiting"].includes(job.status));
  return <div className="phone-inline-lookup" aria-label="Inline mobile enrichment" aria-busy={busy || checking || moving}>
    {(busy || checking) ? <span className="phone-inline-status" role="status"><LoaderCircle className="phone-lookup-spinner" size={11} />{busy ? "Queueing…" : "Checking…"}</span> : job && <>
      <span className={`phone-inline-status${job.status === "no_mobile" ? " phone-empty-result" : ""}`} role="status" title={`Last lookup: ${new Date(job.updated_at).toLocaleString()}`}>
        {moving && <LoaderCircle className="phone-lookup-spinner" size={11} />}{labels[job.status] ?? "Lookup incomplete"}
      </span>
      {pending && job.provider_index < mobileProviders.length && <small>{mobileProviderLabels[mobileProviders[job.provider_index]]}</small>}
      {job.status === "needs_review" && <>
        <small>Retrying may use credits. Check the previous request in your provider account first.</small>
        <label className="phone-inline-mode"><input type="checkbox" checked={requestChecked} onChange={(event) => setRequestChecked(event.target.checked)} />Request checked</label>
        <button type="button" className="phone-inline-enrich" disabled={busy || checking || !requestChecked} onClick={() => void post({ action: "retry", job: job.id })}>Retry request</button>
      </>}
      {job.status === "waiting_setup" && <small>The lookup resumes after the provider is ready.</small>}
      {job.status === "no_mobile" && <small>All sources checked</small>}
      {job.results.map((result) => <div className="phone-inline-result" key={result.number}>
        <span>{formatMobile(result.number)}<small>{mobileProviderLabels[result.provider]}</small></span>
        <button type="button" aria-label={`Copy ${result.number}`} title="Copy mobile number" onClick={() => void navigator.clipboard.writeText(result.number).then(() => setMessage("Copied")).catch(() => setError("Copy failed. Select the number to copy it."))}><Copy size={11} /></button>
      </div>)}
    </>}
    {!pending && <>
      <label className="phone-inline-mode" title="Continue through every source for additional direct mobiles"><input type="checkbox" checked={collectAll} disabled={busy || checking} onChange={(event) => setCollectAll(event.target.checked)} />Find more numbers</label>
      <button type="button" className="phone-inline-enrich" title="Direct mobiles only. Our database → SignalHire → Apollo → BetterContact." disabled={busy || checking || !linkedin} onClick={() => void post({ candidates: [candidateId], collectAll })}>{job ? "Enrich again" : "Enrich"}</button>
    </>}
    {!linkedin && <small>Add a LinkedIn URL first.</small>}
    {status && !status.workerOnline && <small>Worker offline. Queued work will resume.</small>}
    {loadError && <small className="phone-inline-error" role="alert">{loadError}</small>}
    {error && <small className="phone-inline-error" role="alert">{error}</small>}
    {message && <small role="status">{message}</small>}
    {pending && <><small>Continues if you close this.</small><button type="button" className="phone-inline-stop" disabled={busy || checking} onClick={() => void post({ action: "cancel", job: job!.id })}>Stop lookup</button></>}
  </div>;
}
