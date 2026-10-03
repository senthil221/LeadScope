"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, Sparkles } from "lucide-react";
import { formatMobile } from "@/lib/recruiting/contact";
import { directMobile, mobileProviderLabels, mobileProviders, type MobileJob } from "@/lib/recruiting/mobile-waterfall";

const pendingStatuses = new Set(["queued", "running", "waiting", "waiting_setup", "needs_review"]);
type Status = { jobs: MobileJob[]; workerOnline: boolean };

// Only mounted for the cell being used. The shared table poller keeps tracking
// queued work after this control closes; closing never cancels a server job.
export function InlineMobileLookup({ roleId, candidateId, linkedin, currentValue = "", zeroShownInCell = false, onQueued, onSaved }: {
  roleId: string; candidateId: string; linkedin?: string; currentValue?: string; zeroShownInCell?: boolean; onQueued: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  const submitting = useRef(false);
  const awaitingJob = useRef(false);
  const seen = useRef<string | null | undefined>(undefined);
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
        if (latest) awaitingJob.current = false;
        const stamp = latest ? `${latest.id}:${latest.updated_at}` : null;
        if (seen.current !== undefined && seen.current !== stamp && latest && (latest.results.length || latest.status === "no_mobile")) callbacks.current.onSaved();
        if (seen.current !== stamp) setMessage("");
        seen.current = stamp;
        setStatus(result);
        setChecking(false);
        setLoadError("");
        if ((latest && pendingStatuses.has(latest.status)) || (!latest && awaitingJob.current)) timer = setTimeout(() => void poll(), 5000);
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

  async function enrich() {
    if (submitting.current || checking || status?.jobs.length || !linkedin || message) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/mobile-waterfall", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // Each source already returns all its direct mobiles. Stop on success
        // rather than buying additional lookups from the remaining providers.
        body: JSON.stringify({ role: roleId, candidates: [candidateId], collectAll: false }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start lookup.");
      if (result.queued || result.alreadyRunning) {
        awaitingJob.current = true;
        setMessage(result.alreadyRunning ? "Lookup already running" : "Queued");
      } else setError(result.missingLinkedIn ? "Add a LinkedIn URL first." : "No lookup was queued.");
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
  const provider = mobileProviders[Math.max(0, Math.min(3, job?.provider_index ?? 0))];
  const providerName = provider === "database" ? "database" : mobileProviderLabels[provider];
  const progressLabel = busy ? "Starting lookup…" : job?.status === "queued" ? "In queue" : job?.status === "waiting_setup" ? `Paused at ${providerName}` : job?.status === "needs_review" ? `Review ${providerName}` : moving ? `Checking ${providerName}` : message;
  const completed = new Set(job?.steps.map((step) => step.provider));
  const matchedNumber = job?.results.find((result) => directMobile(result.number) === directMobile(currentValue));
  const otherNumbers = job?.results.filter((result) => result !== matchedNumber) ?? [];
  const checkedTitle = job ? `Checked ${new Date(job.updated_at).toLocaleString()}` : undefined;
  function copyButton(number: string, source: string) {
    return <button type="button" className="phone-inline-copy" aria-label={`Copy ${number}`} title={`Copy mobile · ${source}`} onClick={() => void navigator.clipboard.writeText(number).then(() => setMessage("Copied")).catch(() => setError("Copy failed. Select the number to copy it."))}><Copy size={11} /></button>;
  }

  return <div className="phone-inline-lookup" aria-label="Inline mobile enrichment" aria-busy={busy || checking || moving}>
    {checking && !busy && !job && <span className="phone-inline-state" role="status"><LoaderCircle className="phone-lookup-spinner" size={11} />Loading lookup…</span>}
    {!job && !message && !busy && <button type="button" className="phone-inline-enrich" title="Find direct mobiles. Our database → SignalHire → Apollo → BetterContact." disabled={checking || !linkedin} onClick={() => void enrich()}><Sparkles size={12} />Enrich</button>}
    {(busy || pending || (!job && ["Queued", "Lookup already running"].includes(message))) && <div className={`phone-inline-progress${job?.status === "waiting_setup" || job?.status === "needs_review" ? " is-paused" : ""}`}>
      <span className="phone-inline-state" role="status" title={job?.status === "needs_review" ? "Review the previous provider request in Actions → Mobile waterfall before retrying." : job?.status === "waiting_setup" ? "Provider setup or credits needed. The lookup resumes when available." : "The lookup continues if you close the cell or browser."}><i aria-hidden="true" />{progressLabel}</span>
      <div className="phone-inline-track" role="progressbar" aria-label="Mobile lookup progress" aria-valuemin={0} aria-valuemax={4} aria-valuenow={completed.size} aria-valuetext={progressLabel}>
        {mobileProviders.map((source) => <span key={source} title={mobileProviderLabels[source]} className={completed.has(source) ? "is-done" : source === provider && (pending || busy) ? "is-current" : ""} />)}
      </div>
    </div>}
    {job && !checking && !busy && <>
      {job.results.length > 0 && <>
        <div className="phone-inline-outcome" title={checkedTitle}><span><Check size={12} />{job.results.length === 1 ? "Mobile found" : `${job.results.length} mobiles`}</span>{matchedNumber && copyButton(matchedNumber.number, mobileProviderLabels[matchedNumber.provider])}</div>
        {otherNumbers.length > 0 && <ul className="phone-inline-numbers" aria-label="Returned direct mobiles">{otherNumbers.map((result) => <li key={result.number} title={`${mobileProviderLabels[result.provider]} · ${checkedTitle}`}><span>{formatMobile(result.number)}</span>{copyButton(result.number, mobileProviderLabels[result.provider])}</li>)}</ul>}
      </>}
      {job.status === "no_mobile" && <span className="phone-inline-empty" role="status" title={checkedTitle}>{zeroShownInCell ? "All sources checked" : "0 phones found"}</span>}
      {["failed", "cancelled"].includes(job.status) && <span className="phone-inline-error" role="status" title="See lookup details in Actions → Mobile waterfall.">{job.status === "cancelled" ? "Lookup stopped" : "Lookup incomplete"}</span>}
    </>}
    {!linkedin && <small>Add a LinkedIn URL first.</small>}
    {status && !status.workerOnline && pending && <small>Queued until the worker is online.</small>}
    {loadError && <small className="phone-inline-error" role="alert">{loadError}</small>}
    {error && <small className="phone-inline-error" role="alert">{error}</small>}
    {message === "Copied" && <small role="status">Copied</small>}
  </div>;
}
