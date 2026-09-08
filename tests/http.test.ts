import { afterEach, describe, expect, it, vi } from "vitest";
import { body, sameOrigin } from "../src/lib/server/http";
import { setup } from "../src/lib/server/config";
afterEach(() => vi.unstubAllEnvs());
describe("server request boundaries", () => {
  const request = (
    origin: string | null,
    value = "{}",
    contentType = "application/json",
  ) =>
    new Request("https://leadscope.test/api/action", {
      method: "POST",
      headers: { ...(origin ? { origin } : {}), "Content-Type": contentType },
      body: value,
    });
  it("rejects cross-origin and absent origins", () => {
    vi.stubEnv("APP_URL", "https://leadscope.test");
    expect(() => sameOrigin(request("https://other.test"))).toThrow(
      "application",
    );
    expect(() => sameOrigin(request(null))).toThrow("application");
    expect(() => sameOrigin(request("https://leadscope.test"))).not.toThrow();
  });
  it("requires setup and JSON and caps body bytes", async () => {
    vi.stubEnv("APP_URL", "");
    expect(() => sameOrigin(request("https://leadscope.test"))).toThrow(
      "APP_URL",
    );
    vi.stubEnv("APP_URL", "https://leadscope.test");
    await expect(
      body(request("https://leadscope.test", "{}", "text/plain")),
    ).rejects.toThrow("JSON");
    await expect(
      body(request("https://leadscope.test", "x".repeat(64001))),
    ).rejects.toThrow("too large");
    await expect(
      body(request("https://leadscope.test", "not json")),
    ).rejects.toThrow("Invalid JSON");
  });
  it("reports configuration presence without dispatch or exposing secrets", () => {
    vi.stubEnv("SERPER_API_KEY", "test-only-private-value");
    vi.stubEnv("SERPER_LIVE_ENABLED", "false");
    expect(setup().live).toBe(false);
    expect(JSON.stringify(setup().checks)).not.toContain(
      "test-only-private-value",
    );
  });
});
