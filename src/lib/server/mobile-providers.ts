import "server-only";
import { createHmac } from "node:crypto";
import { apolloMobiles, bettercontactMobiles, signalhireMobiles, type MobileResult, type MobileProvider } from "../recruiting/mobile-waterfall";

export class MobileProviderError extends Error {
  constructor(public code: string, public kind: "setup" | "retry" | "uncertain" | "terminal") { super(code); }
}
export function mobileSetup() {
  return { database: true, signalhire: Boolean(process.env.SIGNALHIRE_API_KEY?.trim()), apollo: Boolean(process.env.APOLLO_API_KEY?.trim()), bettercontact: Boolean(process.env.BETTERCONTACT_API_KEY?.trim()) };
}
export function callbackToken(job: string) {
  return createHmac("sha256", process.env.MOBILE_WORKER_SECRET ?? "").update(`signalhire:${job}`).digest("hex");
}
async function providerFetch(url: string, key: string, header: string, payload?: unknown, apolloPoll = false) {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) throw new MobileProviderError("test_dispatch_forbidden", "terminal");
  let response: Response;
  try {
    response = await fetch(url, { method: payload ? "POST" : "GET", headers: { [header]: key, "Content-Type": "application/json", accept: "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(25000), cache: "no-store", redirect: "error" });
  } catch { throw new MobileProviderError("network_or_timeout", payload ? "uncertain" : "retry"); }
  if ([401, 402, 403].includes(response.status)) throw new MobileProviderError(`provider_${response.status}`, "setup");
  if (response.status === 429) throw new MobileProviderError("provider_rate_limited", "retry");
  if (response.status >= 500) throw new MobileProviderError(`provider_${response.status}`, payload ? "uncertain" : "retry");
  const reader = response.body?.getReader();
  if (!reader) throw new MobileProviderError("empty_response", payload ? "uncertain" : "retry");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 1000000) { await reader.cancel(); throw new Error("large"); }
      chunks.push(value);
    }
    // Apollo request IDs are int64; preserve precision before JSON.parse.
    const text = Buffer.concat(chunks).toString("utf8").replace(/("request_id"\s*:\s*)(-?\d{16,})(\s*[,}])/g, '$1"$2"$3');
    const raw = JSON.parse(text);
    if (apolloPoll && response.status === 404 && raw.error_code === "result_pending") return { pending: true, retryAfter: Math.min(300, Math.max(15, Number(raw.retry_after_seconds) || 30)) };
    if (!response.ok) throw new MobileProviderError(`provider_${response.status}`, "terminal");
    return raw;
  } catch (error) {
    if (error instanceof MobileProviderError) throw error;
    throw new MobileProviderError("invalid_provider_response", payload ? "uncertain" : "retry");
  }
}
export type ProviderReply = { numbers: MobileResult[]; requestId?: string; pending?: boolean; delay?: number; code?: string };
export async function dispatchMobile(provider: Exclude<MobileProvider, "database">, job: { id: string; identifier: string; candidate: { name: string; company: string } }): Promise<ProviderReply> {
  const key = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim();
  if (!key) throw new MobileProviderError("provider_not_configured", "setup");
  if (provider === "signalhire") {
    if (!process.env.APP_URL || !process.env.MOBILE_WORKER_SECRET) throw new MobileProviderError("callback_not_configured", "setup");
    const callback = new URL("/api/mobile-callback", process.env.APP_URL);
    callback.searchParams.set("job", job.id); callback.searchParams.set("token", callbackToken(job.id));
    const raw = await providerFetch("https://www.signalhire.com/api/v1/candidate/search", key, "apikey", { items: [job.identifier], callbackUrl: callback.toString() });
    if (!raw.requestId) throw new MobileProviderError("missing_request_id", "uncertain");
    return { numbers: [], requestId: String(raw.requestId), pending: true, delay: 30 };
  }
  if (provider === "apollo") {
    const url = new URL("https://api.apollo.io/api/v1/people/match");
    url.searchParams.set("linkedin_url", job.identifier);
    // Send the stored matching context too, without requesting more enrichment.
    if (job.candidate.name.trim()) url.searchParams.set("name", job.candidate.name.trim());
    if (job.candidate.company.trim()) url.searchParams.set("organization_name", job.candidate.company.trim());
    url.searchParams.set("reveal_phone_number", "true");
    url.searchParams.set("reveal_personal_emails", "false");
    url.searchParams.set("run_waterfall_phone", "false");
    url.searchParams.set("run_waterfall_email", "false");
    url.searchParams.set("poll_only", "true");
    const raw = await providerFetch(url.toString(), key, "X-Api-Key", {});
    if (raw.request_id != null) return { numbers: apolloMobiles(raw), requestId: String(raw.request_id), pending: true, delay: 30 };
    if (raw.person == null) return { numbers: [], code: "not_found" };
    throw new MobileProviderError("missing_request_id", "uncertain");
  }
  const [first_name, ...last] = job.candidate.name.trim().split(/\s+/);
  const raw = await providerFetch("https://app.bettercontact.rocks/api/v2/async", key, "X-API-Key", { data: [{ first_name, last_name: last.join(" "), company: job.candidate.company, linkedin_url: job.identifier, custom_fields: { job_id: job.id } }], enrich_email_address: false, enrich_phone_number: true, enrich_profile: false, verify_catch_all: false });
  if (!raw.id) throw new MobileProviderError("missing_request_id", "uncertain");
  return { numbers: [], requestId: String(raw.id), pending: true, delay: 30 };
}
export async function pollMobile(provider: "apollo" | "bettercontact", requestId: string, identifier: string): Promise<ProviderReply> {
  const key = process.env[`${provider.toUpperCase()}_API_KEY`]?.trim();
  if (!key) throw new MobileProviderError("provider_not_configured", "setup");
  const raw = provider === "apollo"
    ? await providerFetch(`https://api.apollo.io/api/v1/webhook_result/${encodeURIComponent(requestId)}`, key, "X-Api-Key", undefined, true)
    : await providerFetch(`https://app.bettercontact.rocks/api/v2/async/${encodeURIComponent(requestId)}`, key, "X-API-Key");
  if (raw.pending) return { numbers: [], pending: true, delay: raw.retryAfter };
  if (provider === "bettercontact" && raw.status !== "terminated") return { numbers: [], pending: true, delay: raw.status === "on_hold" ? 300 : 30, code: raw.status === "on_hold" ? "provider_out_of_credits" : undefined };
  return { numbers: provider === "apollo" ? apolloMobiles(raw) : bettercontactMobiles(raw, identifier) };
}
export { signalhireMobiles };
