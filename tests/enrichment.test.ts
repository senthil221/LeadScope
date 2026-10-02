import { afterEach, describe, expect, it, vi } from "vitest";
import { buildXrayQuery, xrayResults } from "../src/lib/recruiting/xray";
import { apolloMobiles, bettercontactMobiles, directMobile, mergeMobiles, signalhireMobiles, uniqueMobiles } from "../src/lib/recruiting/mobile-waterfall";
import { dispatchMobile, pollMobile } from "../src/lib/server/mobile-providers";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Google X-Ray", () => {
  it("builds the requested Boolean syntax without interpreting user terms as operators", () => {
    expect(buildXrayQuery({ titles: "cold email, cold call", keywords: "B2B", location: "Chennai", company: "", exclude: "" })).toBe('site:linkedin.com/in/ ("cold email" OR "cold call") "B2B" "Chennai"');
  });
  it("canonicalizes, deduplicates and excludes non-profile links", () => {
    const rows = xrayResults([{ link: "https://in.linkedin.com/in/test/?trk=x", title: "Test Name - SDR | LinkedIn", snippet: "Cold email", position: 1 }, { link: "https://www.linkedin.com/in/test", title: "Duplicate", snippet: "", position: 2 }, { link: "https://linkedin.com/company/acme", title: "Company", snippet: "", position: 3 }]);
    expect(rows).toEqual([{ url: "https://www.linkedin.com/in/test", name: "Test Name", title: "Test Name - SDR", snippet: "Cold email", position: 1 }]);
  });
});
describe("Direct mobile filtering", () => {
  it("normalizes India mobiles and preserves international mobiles", () => {
    expect(directMobile("+91 98765 43210")).toBe("9876543210");
    expect(directMobile("+1 (415) 555-0116")).toBe("+14155550116");
    expect(directMobile("0442345678")).toBeNull();
    expect(directMobile("call 9876543210")).toBeNull();
  });
  it("SignalHire accepts only the matching person's mobile subtype", () => {
    const numbers = signalhireMobiles([{ item: "https://www.linkedin.com/in/person", status: "success", candidate: { contacts: [{ type: "phone", subType: "mobile", value: "+919876543210" }, { type: "phone", subType: "work_phone", value: "+914423456789" }, { type: "phone", subType: null, value: "+919999999999" }] } }], "https://www.linkedin.com/in/person");
    expect(numbers).toEqual([{ number: "9876543210", provider: "signalhire" }]);
    expect(signalhireMobiles([{ item: "other", status: "success", candidate: {} }], "person")).toEqual([]);
  });
  it("Apollo returns multiple mobiles and never organization or work-direct phones", () => {
    const numbers = apolloMobiles({ organization: { phone: "+14155550100" }, people: [{ phone_numbers: [{ type_cd: "mobile", sanitized_number: "+919876543210" }, { type_cd: "mobile", raw_number: "+919876543211" }, { type_cd: "work_direct", sanitized_number: "+14155550101" }, { type_cd: "mobile", status_cd: "invalid_number", sanitized_number: "+14155550102" }] }] });
    expect(numbers.map((r) => r.number)).toEqual(["9876543210", "9876543211"]);
  });
  it("BetterContact ignores pending and on-hold payloads and company phone fields", () => {
    const data = [{ enriched: true, contact_linkedin_profile_url: "https://www.linkedin.com/in/person", contact_phone_number: "+919876543210", company_phone: "+919999999999" }];
    expect(bettercontactMobiles({ status: "processing", data }, "https://www.linkedin.com/in/person")).toEqual([]);
    expect(bettercontactMobiles({ status: "on_hold", data }, "https://www.linkedin.com/in/person")).toEqual([]);
    expect(bettercontactMobiles({ status: "terminated", data }, "https://www.linkedin.com/in/person")).toEqual([{ number: "9876543210", provider: "bettercontact" }]);
  });
  it("deduplicates across providers without replacing source attribution", () => {
    expect(mergeMobiles(uniqueMobiles(["9876543210"], "database"), uniqueMobiles(["+919876543210", "9876543211"], "apollo"))).toEqual([{ number: "9876543210", provider: "database" }, { number: "9876543211", provider: "apollo" }]);
  });
});
describe("Provider request contracts (mock transport only)", () => {
  function mockProvider(payload: unknown, status = 200) {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VITEST", ""); vi.stubEnv("APOLLO_API_KEY", "test-placeholder"); vi.stubEnv("BETTERCONTACT_API_KEY", "test-placeholder");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status })); vi.stubGlobal("fetch", fetcher); return fetcher;
  }
  it("explicitly disables both Apollo waterfalls and requests mobile polling", async () => {
    const fetcher = mockProvider({ request_id: "1039995589705121900" });
    const result = await dispatchMobile("apollo", { id: "job", identifier: "https://www.linkedin.com/in/person", candidate: { name: "Test Person", company: "Acme" } });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("run_waterfall_phone")).toBe("false"); expect(url.searchParams.get("run_waterfall_email")).toBe("false"); expect(url.searchParams.get("poll_only")).toBe("true");
    expect(result.requestId).toBe("1039995589705121900");
  });
  it("does not treat a pending Apollo 404 as no-mobile", async () => {
    mockProvider({ error_code: "result_pending", retry_after_seconds: 40 }, 404);
    expect(await pollMobile("apollo", "1039995589705121900", "person")).toMatchObject({ pending: true, delay: 40 });
  });
  it("does not treat BetterContact's 200 on-hold as finished", async () => {
    mockProvider({ status: "on_hold" });
    expect(await pollMobile("bettercontact", "id", "person")).toMatchObject({ pending: true, code: "provider_out_of_credits" });
  });
  it("never automatically retries an ambiguous paid POST", async () => {
    const fetcher = mockProvider({}); fetcher.mockRejectedValue(new Error("timeout"));
    await expect(dispatchMobile("apollo", { id: "job", identifier: "person", candidate: { name: "Test Person", company: "Acme" } })).rejects.toMatchObject({ kind: "uncertain" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
