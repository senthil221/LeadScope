import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn() }));
vi.mock("../src/lib/server/db", async (original) => ({
  ...(await original<object>()),
  admin: mocks.admin,
  integrationDb: () => ({ rpc: mocks.rpc }),
}));
import { POST } from "../src/app/api/action/route";
import { AppError } from "../src/lib/server/db";
const actor = "b5d1f811-557a-420d-a2c0-c85e42c66050";
const campaign = "f96c146b-0058-4bb5-972b-2e85b8d2e90a";
const token = "0cbb8edc-76cb-41db-baa4-43c9f19e6972";
function request(
  payload = { campaignId: campaign, token, cap: 4, revision: 1 },
) {
  return new Request("https://leadscope.test/api/action", {
    method: "POST",
    headers: {
      origin: "https://leadscope.test",
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "start", payload }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({
    APP_URL: "https://leadscope.test",
    SERPER_LIVE_ENABLED: "true",
    SERPER_API_KEY: "test-only",
    SUPABASE_SECRET_KEY: "test-only",
    SERPER_MAX_REQUESTS_PER_RUN: "2",
  }))
    vi.stubEnv(key, value);
  mocks.admin.mockResolvedValue({ user: { id: actor }, db: {} });
  mocks.rpc.mockResolvedValue({
    data: { runId: "saved-run", cap: 2 },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("single-action search start", () => {
  it("starts without a preview call and clamps the displayed budget on the server", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("prepare_run", {
      p_actor: actor,
      p_campaign: campaign,
      p_token: token,
      p_force: [],
      p_cap: 2,
      p_create: true,
      p_revision: 1,
    });
  });
  it("retains the Start token when a client retries", async () => {
    await POST(request());
    await POST(request());
    expect(mocks.rpc.mock.calls.map((call) => call[1].p_token)).toEqual([
      token,
      token,
    ]);
  });
  it("cannot start with disabled search, absent revision, or no authorization", async () => {
    vi.stubEnv("SERPER_LIVE_ENABLED", "false");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("SERPER_LIVE_ENABLED", "true");
    expect(
      (
        await POST(
          request({
            campaignId: campaign,
            token,
            cap: 4,
            revision: undefined as unknown as number,
          }),
        )
      ).status,
    ).toBe(400);
    mocks.admin.mockRejectedValue(new AppError("Sign in", 401));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
