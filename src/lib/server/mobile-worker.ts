import "server-only";
import { checked, integrationDb } from "./db";
import { dispatchMobile, mobileSetup, MobileProviderError, pollMobile } from "./mobile-providers";
import { mergeMobiles, mobileProviders, uniqueMobiles, type MobileResult, type MobileProvider } from "../recruiting/mobile-waterfall";

type Claim = { id: string; lease_token: string; identifier: string; provider_index: number; attempt_state: string; request_id: string | null; callback_result: { results: MobileResult[]; code?: string } | null; retries: number; collect_all: boolean; results: MobileResult[]; steps: { provider: MobileProvider; outcome: string; count: number }[]; candidate: { name: string; company: string; email?: string | null; phone: string | null; alternate_phone: string | null }; cached: MobileResult[] };
export async function processMobileJob() {
  const db = integrationDb();
  const job = checked(await db.rpc("claim_mobile_waterfall")) as Claim | null;
  if (!job) return { state: "idle" };
  const save = async (patch: Record<string, unknown>) => checked(await db.rpc("save_mobile_waterfall", { p_id: job.id, p_token: job.lease_token, p_patch: patch }));
  const provider = mobileProviders[job.provider_index];
  const finish = async (added: MobileResult[], outcome: string) => {
    const results = mergeMobiles(job.results, added);
    const steps = [...job.steps, { provider, outcome, count: added.length }];
    const done = (results.length > 0 && !job.collect_all) || job.provider_index === 3;
    const failed = steps.some((step) => step.outcome === "error");
    await save({ results, steps, provider_index: job.provider_index + 1, attempt_state: "idle", request_id: null, retries: 0, status: done ? results.length ? "complete" : failed ? "failed" : "no_mobile" : "queued" });
  };
  try {
    if (provider === "database") {
      await finish(mergeMobiles(uniqueMobiles([job.candidate.phone, job.candidate.alternate_phone], "database"), job.cached), "checked");
    } else if (provider) {
      if (!mobileSetup()[provider]) { await save({ status: "waiting_setup", error_code: "provider_not_configured", delay: 300 }); return { state: "waiting_setup" }; }
      if (provider === "signalhire" && job.callback_result) {
        await finish(job.callback_result.results, job.callback_result.code ? "error" : "checked");
      } else if (job.attempt_state === "pending" && job.request_id) {
        if (provider === "signalhire") { await save({ status: "waiting", delay: 30 }); return { state: "waiting" }; }
        const reply = await pollMobile(provider, job.request_id, job.identifier);
        if (reply.pending) await save({ status: "waiting", error_code: reply.code ?? null, delay: reply.delay ?? 30 });
        else await finish(reply.numbers, "checked");
      } else {
        // Commit intent before the non-idempotent external request.
        if (!await save({ status: "running", attempt_state: "dispatching" })) return { state: "lease_lost" };
        const reply = await dispatchMobile(provider, job);
        if (reply.pending) await save({ results: mergeMobiles(job.results, reply.numbers), status: "waiting", attempt_state: "pending", request_id: reply.requestId, delay: reply.delay ?? 30 });
        else await finish(reply.numbers, "checked");
      }
    }
  } catch (error) {
    const failure = error instanceof MobileProviderError ? error : null;
    if (!failure) throw error; // Keep lease intact; recovery handles uncertain dispatches.
    if (failure.kind === "terminal") await finish([], "error");
    else await save({ status: failure.kind === "uncertain" ? "needs_review" : failure.kind === "setup" ? "waiting_setup" : "waiting", attempt_state: job.request_id ? "pending" : "idle", error_code: failure.code, retries: job.retries + 1, delay: failure.kind === "setup" ? 300 : Math.min(900, 30 * 2 ** Math.min(job.retries, 5)) });
    console.info(JSON.stringify({ event: "mobile_provider_status", jobId: job.id, provider, code: failure.code }));
  }
  return { state: "processed" };
}
