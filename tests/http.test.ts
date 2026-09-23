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
  // A domain rename leaves the previous hostname serving share links clients
  // already hold. Every action posted from it was refused as cross-origin,
  // which locked people out of signing in there entirely.
  it("accepts an additional hostname the deployment still answers to", () => {
    vi.stubEnv("APP_URL", "https://new.test");
    vi.stubEnv("ADDITIONAL_APP_ORIGINS", "https://old.test");
    expect(sameOrigin(request("https://new.test"))).toBe("https://new.test");
    expect(sameOrigin(request("https://old.test"))).toBe("https://old.test");
    // Still nothing else, and the allowance does not leak in from nowhere.
    expect(() => sameOrigin(request("https://other.test"))).toThrow("application");
    vi.stubEnv("ADDITIONAL_APP_ORIGINS", "");
    expect(() => sameOrigin(request("https://old.test"))).toThrow("application");
  });

  it("ignores blank and malformed entries rather than trusting them", () => {
    vi.stubEnv("APP_URL", "https://new.test");
    vi.stubEnv("ADDITIONAL_APP_ORIGINS", " , not-a-url , https://old.test ,");
    expect(setup().appOrigins).toEqual(["https://new.test", "https://old.test"]);
    expect(() => sameOrigin(request("not-a-url"))).toThrow("application");
  });

  it("returns the caller's own origin, so a redirect keeps their session", () => {
    vi.stubEnv("APP_URL", "https://new.test");
    vi.stubEnv("ADDITIONAL_APP_ORIGINS", "https://old.test");
    // The value is the hostname that was used, never the canonical one: the
    // session cookie belongs to whichever name set it.
    expect(sameOrigin(request("https://old.test"))).not.toBe("https://new.test");
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
