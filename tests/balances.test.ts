import { afterEach, describe, expect, it, vi } from "vitest";
import { providerBalance } from "../src/lib/server/balances";

// Each provider reports its balance differently; the Credits page needs one shape.
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("provider balances", () => {
  it("reads Serper, SignalHire and BetterContact balances", async () => {
    vi.stubEnv("SERPER_API_KEY", "s"); vi.stubEnv("SIGNALHIRE_API_KEY", "h"); vi.stubEnv("BETTERCONTACT_API_KEY", "b");
    const fetch = vi.fn(async (url: string) => url.includes("serper") ? reply(200, { balance: 2489, rateLimit: 5 }) : url.includes("signalhire") ? reply(200, { credits: 1962 }) : reply(200, { success: true, credits_left: "20.0", email: "x" }));
    vi.stubGlobal("fetch", fetch);
    expect(await providerBalance("serper", true)).toMatchObject({ status: "ok", credits: 2489 });
    expect(await providerBalance("signalhire", true)).toMatchObject({ status: "ok", credits: 1962 });
    expect(await providerBalance("bettercontact", true)).toMatchObject({ status: "ok", credits: 20 });
    const headers = fetch.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1].headers);
    expect(headers).toEqual([expect.objectContaining({ "X-API-KEY": "s" }), expect.objectContaining({ apikey: "h" }), expect.objectContaining({ "X-API-Key": "b" })]);
  });
  it("says Apollo is connected when its key may not read the balance", async () => {
    vi.stubEnv("APOLLO_API_KEY", "a");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("credit_usage_stats") ? reply(403, { error_code: "API_INACCESSIBLE" }) : reply(200, { healthy: true, is_logged_in: true })));
    expect(await providerBalance("apollo", true)).toMatchObject({ status: "restricted", credits: null });
  });
  it("lists Apollo credit types when the key can read them", async () => {
    vi.stubEnv("APOLLO_API_KEY", "a");
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { credit_usage_stats: { lead_credit: { limit: 1000, consumed: 10, left_over: 990 }, mobile_credit: { limit: 100, consumed: 40, left_over: 60 }, dialer: { limit: 5, consumed: 0, left_over: 5 } } })));
    const apollo = await providerBalance("apollo", true);
    expect(apollo).toMatchObject({ status: "ok", credits: 60 });
    expect(apollo.lines.map((l) => l.label)).toEqual(["Lead", "Mobile"]);
  });
  it("reports a missing key or a rejected one without throwing", async () => {
    vi.stubEnv("SIGNALHIRE_API_KEY", "");
    expect(await providerBalance("signalhire", true)).toMatchObject({ status: "missing" });
    vi.stubEnv("SERPER_API_KEY", "bad");
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, { message: "Unauthorized" })));
    expect(await providerBalance("serper", true)).toMatchObject({ status: "error", credits: null });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await providerBalance("serper", true)).toMatchObject({ status: "error" });
  });
});
