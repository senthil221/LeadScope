import { afterEach, describe, expect, it, vi } from "vitest";
import { buildXrayQuery, xrayResults } from "../src/lib/recruiting/xray";
import { apolloMobiles, bettercontactMobiles, directMobile, emptyMobileResultLabel, hasZeroMobileResult, mergeMobiles, signalhireMobiles, uniqueMobiles } from "../src/lib/recruiting/mobile-waterfall";
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
describe("Empty phone lookup results", () => {
  const cell = { candidate_id: "profile", identifier: "https://www.linkedin.com/in/person", status: "no_mobile", phone_count: 0, checked_at: "2026-10-03T12:12:39Z" };
  it("marks only a completed zero result for the same LinkedIn identity", () => {
    expect(hasZeroMobileResult(cell, cell.identifier)).toBe(true);
    expect(hasZeroMobileResult(cell, "https://www.linkedin.com/in/changed")).toBe(false);
    expect(hasZeroMobileResult(undefined, cell.identifier)).toBe(false);
    expect(hasZeroMobileResult({ ...cell, phone_count: 1 }, cell.identifier)).toBe(false);
    for (const status of ["queued", "running", "waiting", "waiting_setup", "needs_review", "failed", "cancelled", "complete"]) {
      expect(hasZeroMobileResult({ ...cell, status }, cell.identifier)).toBe(false);
    }
  });
  it("distinguishes empty completion from pending and failed lookups", () => {
    expect(emptyMobileResultLabel("no_mobile")).toBe("0 phones found");
    expect(emptyMobileResultLabel("running")).toBe("No mobiles returned yet");
    expect(emptyMobileResultLabel("failed")).toBe("Lookup incomplete");
    expect(emptyMobileResultLabel("cancelled")).toBe("Lookup incomplete");
  });
});
describe("Provider request contracts (mock transport only)", () => {
  function mockProvider(payload: unknown, status = 200) {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VITEST", ""); vi.stubEnv("APOLLO_API_KEY", "test-placeholder"); vi.stubEnv("BETTERCONTACT_API_KEY", "test-placeholder"); vi.stubEnv("SIGNALHIRE_API_KEY", "test-placeholder");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status })); vi.stubGlobal("fetch", fetcher); return fetcher;
  }
  it("explicitly disables both Apollo waterfalls and requests mobile polling", async () => {
    const fetcher = mockProvider({ request_id: "1039995589705121900" });
    const result = await dispatchMobile("apollo", { id: "job", identifier: "https://www.linkedin.com/in/person", candidate: { name: "Test Person", company: "Acme" } });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("run_waterfall_phone")).toBe("false"); expect(url.searchParams.get("run_waterfall_email")).toBe("false"); expect(url.searchParams.get("poll_only")).toBe("true");
    expect(url.searchParams.get("reveal_phone_number")).toBe("true"); expect(url.searchParams.get("reveal_personal_emails")).toBe("false");
    expect(url.searchParams.get("linkedin_url")).toBe("https://www.linkedin.com/in/person");
    expect(url.searchParams.get("name")).toBe("Test Person"); expect(url.searchParams.get("organization_name")).toBe("Acme");
    expect(result.requestId).toBe("1039995589705121900");
  });
  it("sends the exact LinkedIn identifier and secure callback to SignalHire", async () => {
    const fetcher = mockProvider({ requestId: "signal-request" });
    vi.stubEnv("APP_URL", "https://app.example.com"); vi.stubEnv("MOBILE_WORKER_SECRET", "test-worker-secret-with-32-characters");
    await dispatchMobile("signalhire", { id: "job", identifier: "https://www.linkedin.com/in/person", candidate: { name: "Test Person", company: "Acme" } });
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.items).toEqual(["https://www.linkedin.com/in/person"]);
    const callback = new URL(payload.callbackUrl);
    expect(callback.origin).toBe("https://app.example.com"); expect(callback.pathname).toBe("/api/mobile-callback"); expect(callback.searchParams.get("job")).toBe("job"); expect(callback.searchParams.get("token")).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(payload).sort()).toEqual(["callbackUrl", "items"]);
  });
  it("keeps a LinkedIn-only phone lookup valid without inventing a company", async () => {
    const fetcher = mockProvider({ request_id: "1039995589705121900" });
    await dispatchMobile("apollo", { id: "job", identifier: "https://www.linkedin.com/in/person", candidate: { name: "  Test Person  ", company: "  " } });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("name")).toBe("Test Person"); expect(url.searchParams.has("organization_name")).toBe(false);
  });
  it("requests only mobile enrichment from BetterContact with every optional enrichment disabled", async () => {
    const fetcher = mockProvider({ id: "mobile-request" });
    await dispatchMobile("bettercontact", { id: "job", identifier: "https://www.linkedin.com/in/person", candidate: { name: "Test Person", company: "Acme" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://app.bettercontact.rocks/api/v2/async");
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload).toEqual({
      data: [{ first_name: "Test", last_name: "Person", company: "Acme", linkedin_url: "https://www.linkedin.com/in/person", custom_fields: { job_id: "job" } }],
      enrich_email_address: false, enrich_phone_number: true, enrich_profile: false, verify_catch_all: false,
    });
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
