import "server-only";
import { createHash } from "node:crypto";
import { admin, checked, integrationDb, AppError } from "./db";
import { setup } from "./config";
import { ProviderError, searchSerper, providerGuard } from "./serper";
import { canonicalLinkedIn } from "../urls";
import { qualify } from "../qualification";
import type { CampaignConfig, OrganicResult } from "../domain";
type Claim = {
  state: string;
  nextRetryAt?: string;
  job?: {
    id: string;
    token: string;
    page_number: number;
    raw_response: { organic?: OrganicResult[] } | null;
    response_saved_at: string;
  };
  query?: { text: string };
  run?: { id: string; snapshot: CampaignConfig };
};
export async function processNext(runId: string) {
  const { user } = await admin();
  if (!setup().live)
    throw new AppError(
      "Enable Serper and configure the server integration key to process searches.",
      503,
    );
  const db = integrationDb();
  const claim = checked(
    await db.rpc("claim_job", { p_actor: user.id, p_run: runId }),
  ) as Claim;
  if (!claim.job || !claim.run || !claim.query) return claim;
  const { job, run, query } = claim;
  const started = Date.now();
  let raw = job.raw_response;
  if (claim.state === "dispatch") {
    try {
      providerGuard();
      const marked = checked(
        await db.rpc("mark_dispatch", {
          p_actor: user.id,
          p_job: job.id,
          p_token: job.token,
        }),
      );
      if (!marked) return { state: "paused" };
      raw = await searchSerper(
        query.text,
        run.snapshot.country,
        run.snapshot.language,
        job.page_number,
      );
    } catch (error) {
      const failure =
        error instanceof ProviderError
          ? error
          : new ProviderError("dispatch_failed", false);
      checked(
        await db.rpc("fail_job", {
          p_actor: user.id,
          p_job: job.id,
          p_token: job.token,
          p_code: failure.code,
          p_retry: failure.retryable,
          p_stop: failure.stopRun,
        }),
      );
      console.info(
        JSON.stringify({
          event: "search_failed",
          runId,
          jobId: job.id,
          code: failure.code,
          durationMs: Date.now() - started,
        }),
      );
      return {
        state: failure.stopRun ? "failed" : "retry_or_continue",
        code: failure.code,
      };
    }
    // Never turn a failed database save into a second HTTP request in this call.
    const saved = checked(
      await db.rpc("save_response", {
        p_actor: user.id,
        p_job: job.id,
        p_token: job.token,
        p_raw: raw,
      }),
    );
    if (!saved) return { state: "lease_expired" };
  }
  const entries = new Map<string, OrganicResult>();
  let occurrences = 0;
  for (const result of raw?.organic ?? []) {
    const url = canonicalLinkedIn(result.link);
    if (url) {
      occurrences++;
      if (!entries.has(url)) entries.set(url, result);
    }
  }
  const observedAt =
    claim.state === "recover"
      ? job.response_saved_at
      : new Date().toISOString();
  const items = [...entries].map(([canonicalUrl, item]) => ({
    canonicalUrl,
    title: item.title,
    snippet: item.snippet,
    originalUrl: item.link,
    position: item.position,
    assessment: qualify(item.title, item.snippet, run.snapshot, observedAt),
  }));
  const fingerprint = createHash("sha256")
    .update([...entries.keys()].sort().join("\n"))
    .digest("hex");
  const metrics = checked(
    await db.rpc("commit_job", {
      p_actor: user.id,
      p_job: job.id,
      p_token: job.token,
      p_items: items,
      p_fingerprint: fingerprint,
      p_occurrences: occurrences,
    }),
  );
  console.info(
    JSON.stringify({
      event: "search_committed",
      runId,
      jobId: job.id,
      durationMs: Date.now() - started,
    }),
  );
  return { state: "processed", metrics };
}
