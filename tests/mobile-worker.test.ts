import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), dispatch: vi.fn(), poll: vi.fn(), setup: vi.fn() }));
vi.mock("../src/lib/server/db", () => ({ integrationDb: () => ({ rpc: mocks.rpc }), checked: (result: { data: unknown; error: unknown }) => { if (result.error) throw new Error("database failure"); return result.data; } }));
vi.mock("../src/lib/server/mobile-providers", () => ({ dispatchMobile: mocks.dispatch, pollMobile: mocks.poll, mobileSetup: mocks.setup, MobileProviderError: class extends Error { constructor(public code: string, public kind: string) { super(code); } } }));
import { processMobileJob } from "../src/lib/server/mobile-worker";
import { MobileProviderError } from "../src/lib/server/mobile-providers";
const base = { id: "job", lease_token: "lease", identifier: "https://www.linkedin.com/in/person", provider_index: 0, attempt_state: "idle", request_id: null, callback_result: null, retries: 0, collect_all: false, results: [], steps: [], candidate: { name: "Test Person", company: "Acme", phone: null, alternate_phone: null }, cached: [] };
function claim(changes: Record<string, unknown> = {}) {
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_mobile_waterfall" ? { ...base, ...changes } : true, error: null }));
}
const patches = () => mocks.rpc.mock.calls.filter((call) => call[0] === "save_mobile_waterfall").map((call) => call[1].p_patch);
beforeEach(() => { vi.clearAllMocks(); mocks.setup.mockReturnValue({ signalhire: true, apollo: true, bettercontact: true }); });
describe("server waterfall processing", () => {
  it("stops on existing database mobiles without making paid requests", async () => {
    claim({ candidate: { ...base.candidate, phone: "9876543210", alternate_phone: "9876543211" } });
    await processMobileJob();
    expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.poll).not.toHaveBeenCalled();
    expect(patches()[0]).toMatchObject({ status: "complete", provider_index: 1 }); expect(patches()[0].results).toHaveLength(2);
  });
  it("continues in source order when collect-all is requested", async () => {
    claim({ collect_all: true, cached: [{ number: "9876543210", provider: "database" }] }); await processMobileJob();
    expect(patches()[0]).toMatchObject({ status: "queued", provider_index: 1 });
  });
  it("waits at a missing provider without skipping it or losing progress", async () => {
    claim({ provider_index: 1 }); mocks.setup.mockReturnValue({ signalhire: false }); await processMobileJob();
    expect(patches()[0]).toMatchObject({ status: "waiting_setup", delay: 300 }); expect(patches()[0].provider_index).toBeUndefined(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("commits intent then persists the asynchronous provider request ID", async () => {
    claim({ provider_index: 2 }); mocks.dispatch.mockResolvedValue({ numbers: [], requestId: "1039995589705121900", pending: true, delay: 30 }); await processMobileJob();
    expect(patches()[0]).toMatchObject({ status: "running", attempt_state: "dispatching" });
    expect(patches()[1]).toMatchObject({ status: "waiting", attempt_state: "pending", request_id: "1039995589705121900" });
    expect(mocks.dispatch.mock.calls[0][0]).toBe("apollo");
  });
  it("uses the saved request ID instead of resubmitting a pending Apollo request", async () => {
    claim({ provider_index: 2, attempt_state: "pending", request_id: "saved-id" }); mocks.poll.mockResolvedValue({ numbers: [], pending: true, delay: 30 }); await processMobileJob();
    expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.poll).toHaveBeenCalledWith("apollo", "saved-id", base.identifier); expect(patches()[0]).toMatchObject({ status: "waiting" });
  });
  it("applies a saved SignalHire callback and retains all mobiles", async () => {
    claim({ provider_index: 1, callback_result: { results: [{ number: "9876543210", provider: "signalhire" }, { number: "9876543211", provider: "signalhire" }] } }); await processMobileJob();
    expect(mocks.dispatch).not.toHaveBeenCalled(); expect(patches()[0]).toMatchObject({ status: "complete" }); expect(patches()[0].results).toHaveLength(2);
  });
  it("requires review after an ambiguous paid request", async () => {
    claim({ provider_index: 3 }); mocks.dispatch.mockRejectedValue(new MobileProviderError("network_or_timeout", "uncertain")); await processMobileJob();
    expect(patches()[1]).toMatchObject({ status: "needs_review", error_code: "network_or_timeout" }); expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });
  it("never dispatches after losing the lease", async () => {
    claim({ provider_index: 1 }); mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_mobile_waterfall" ? { ...base, provider_index: 1 } : false, error: null })); await processMobileJob();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("marks zero mobiles only after the final source completes without errors", async () => {
    claim({ provider_index: 3, attempt_state: "pending", request_id: "saved-id", steps: ["database", "signalhire", "apollo"].map((provider) => ({ provider, outcome: "checked", count: 0 })) });
    mocks.poll.mockResolvedValue({ numbers: [] });
    await processMobileJob();
    expect(patches()[0]).toMatchObject({ status: "no_mobile", provider_index: 4, results: [] });
    expect(patches()[0].steps).toHaveLength(4); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("keeps an empty result with a provider error distinguishable from zero phones", async () => {
    claim({ provider_index: 3, attempt_state: "pending", request_id: "saved-id", steps: [{ provider: "signalhire", outcome: "error", count: 0 }] });
    mocks.poll.mockResolvedValue({ numbers: [] }); await processMobileJob();
    expect(patches()[0]).toMatchObject({ status: "failed", results: [] });
  });
});
