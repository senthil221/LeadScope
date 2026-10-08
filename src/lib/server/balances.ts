import "server-only";

// What is left on each paid account the workspace draws on. Every call here is
// a provider's own account or balance endpoint, which none of them charge for.
export type ProviderId = "serper" | "signalhire" | "apollo" | "bettercontact";
export type Balance = {
  id: ProviderId;
  name: string;
  usedFor: string;
  dashboard: string;
  // ok: balance read. restricted: the key works but may not read its balance.
  status: "ok" | "missing" | "restricted" | "error";
  credits: number | null;
  lowAt: number;
  lines: { label: string; left: number; limit?: number }[];
  note?: string;
};
const providers: Record<ProviderId, Omit<Balance, "status" | "credits" | "lines" | "note"> & { env: string }> = {
  serper: { id: "serper", name: "Serper", usedFor: "Google X-Ray search, 1 credit a page", dashboard: "https://serper.dev/dashboard", lowAt: 200, env: "SERPER_API_KEY" },
  signalhire: { id: "signalhire", name: "SignalHire", usedFor: "Mobile lookup, first in the waterfall", dashboard: "https://www.signalhire.com/", lowAt: 100, env: "SIGNALHIRE_API_KEY" },
  apollo: { id: "apollo", name: "Apollo", usedFor: "Mobile lookup, second in the waterfall", dashboard: "https://app.apollo.io/", lowAt: 100, env: "APOLLO_API_KEY" },
  bettercontact: { id: "bettercontact", name: "BetterContact", usedFor: "Mobile lookup, last in the waterfall", dashboard: "https://app.bettercontact.rocks/", lowAt: 50, env: "BETTERCONTACT_API_KEY" },
};
export const PROVIDER_IDS = Object.keys(providers) as ProviderId[];

async function get(url: string, headers: Record<string, string>, method = "GET") {
  const response = await fetch(url, { method, headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "error" });
  const text = await response.text();
  let json: unknown = null;
  try { json = JSON.parse(text.slice(0, 200000)); } catch { /* not JSON */ }
  return { status: response.status, json: json as Record<string, unknown> | null };
}
const count = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const words = (key: string) => key.replace(/_credits?$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

type Read = Pick<Balance, "status" | "credits" | "lines" | "note">;
const readers: Record<ProviderId, (key: string) => Promise<Read>> = {
  async serper(key) {
    const r = await get("https://google.serper.dev/account", { "X-API-KEY": key });
    const credits = count(r.json?.balance);
    if (r.status !== 200 || credits === null) return failed(r.status);
    return { status: "ok", credits, lines: [], note: r.json?.rateLimit ? `Up to ${r.json.rateLimit} searches a second` : undefined };
  },
  async signalhire(key) {
    const r = await get("https://www.signalhire.com/api/v1/credits", { apikey: key });
    const credits = count(r.json?.credits);
    if (r.status !== 200 || credits === null) return failed(r.status);
    return { status: "ok", credits, lines: [] };
  },
  async bettercontact(key) {
    const r = await get("https://app.bettercontact.rocks/api/v2/account", { "X-API-Key": key });
    const credits = count(r.json?.credits_left);
    if (r.status !== 200 || credits === null) return failed(r.status);
    return { status: "ok", credits, lines: [] };
  },
  // Apollo shows the balance only to a master key or one scoped for it. A
  // narrower key still works for lookups, so say that instead of failing.
  async apollo(key) {
    const r = await get("https://api.apollo.io/api/v1/usage_stats/credit_usage_stats", { "x-api-key": key, "Content-Type": "application/json" }, "POST");
    const stats = r.json?.credit_usage_stats;
    if (r.status === 200 && stats && typeof stats === "object") {
      const lines = Object.entries(stats as Record<string, { limit?: unknown; left_over?: unknown }>)
        .filter(([type]) => type !== "dialer")
        .map(([type, s]) => ({ label: words(type), left: count(s?.left_over), limit: count(s?.limit) ?? undefined }))
        .filter((line): line is { label: string; left: number; limit: number | undefined } => line.left !== null);
      const mobile = lines.find((l) => /mobile|direct dial/i.test(l.label)) ?? lines[0];
      return { status: "ok", credits: mobile?.left ?? null, lines };
    }
    if (r.status === 403 || r.status === 401) {
      const health = await get("https://api.apollo.io/api/v1/auth/health", { "x-api-key": key });
      if (health.status === 200 && health.json?.healthy)
        return { status: "restricted", credits: null, lines: [], note: "The key works for lookups, but Apollo only shows the balance to a master API key. Use a master key, or check Settings › Plans in Apollo." };
    }
    return failed(r.status);
  },
};
function failed(status: number): Read {
  return { status: "error", credits: null, lines: [], note: status === 401 || status === 403 ? "The provider rejected the API key. Check it in the server settings." : `Could not read the balance (${status || "no response"}). Try again shortly.` };
}

// Balances move slowly; a minute's cache keeps page loads from re-asking.
const cache = new Map<ProviderId, { at: number; value: Balance }>();
export async function providerBalance(id: ProviderId, fresh = false): Promise<Balance> {
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.value;
  const { env, ...meta } = providers[id];
  const key = process.env[env]?.trim();
  let read: Read;
  if (!key) read = { status: "missing", credits: null, lines: [], note: `Add ${env} on the server to use ${meta.name}.` };
  else {
    try { read = await readers[id](key); } catch { read = failed(0); }
  }
  const value = { ...meta, ...read };
  if (read.status !== "error") cache.set(id, { at: Date.now(), value });
  return value;
}
export const providerBalances = (fresh = false) => Promise.all(PROVIDER_IDS.map((id) => providerBalance(id, fresh)));
