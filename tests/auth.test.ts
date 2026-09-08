import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
}));
vi.mock("../src/lib/server/db", async (original) => ({
  ...(await original<object>()),
  sessionDb: vi.fn(async () => ({ auth })),
}));
import { POST } from "../src/app/auth/login/route";
function request(
  value: Record<string, string> = {},
  origin = "https://leadscope.test",
) {
  return new Request("https://leadscope.test/auth/login", {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email: "operator@example.test",
      password: "test-password-only",
      mode: "signin",
      ...value,
    }),
  });
}
beforeEach(() => {
  vi.stubEnv("APP_URL", "https://leadscope.test");
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());
describe("email/password authentication", () => {
  it("rejects cross-origin, invalid and oversized forms before calling Auth", async () => {
    expect((await POST(request({}, "https://other.test"))).status).toBe(403);
    expect(
      (await POST(request({ email: "invalid" }))).headers.get("location"),
    ).toContain("error=invalid");
    expect((await POST(request({ password: "x".repeat(5000) }))).status).toBe(
      413,
    );
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.signUp).not.toHaveBeenCalled();
  });
  it("signs in with a password and hides provider error details", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: null });
    expect((await POST(request())).headers.get("location")).toBe(
      "https://leadscope.test/clients",
    );
    auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: "private provider details" },
    });
    const result = await POST(request());
    expect(result.headers.get("location")).toBe(
      "https://leadscope.test/login?error=credentials",
    );
    expect(await result.text()).not.toContain("private provider details");
  });
  it("distinguishes unavailable auth service from invalid credentials", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({
      error: { name: "AuthRetryableFetchError", status: 0 },
    });
    expect((await POST(request())).headers.get("location")).toContain(
      "error=connection",
    );
    auth.signInWithPassword.mockResolvedValueOnce({
      error: { code: "email_not_confirmed", status: 400 },
    });
    expect((await POST(request())).headers.get("location")).toContain(
      "error=unconfirmed",
    );
  });
  it("uses the configured confirmation callback and waits for confirmation", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    expect(
      (await POST(request({ mode: "signup" }))).headers.get("location"),
    ).toContain("message=confirm");
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { emailRedirectTo: "https://leadscope.test/auth/callback" },
      }),
    );
  });
  it("handles signup failure and an immediately confirmed session", async () => {
    auth.signUp.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "restricted" },
    });
    expect(
      (await POST(request({ mode: "signup" }))).headers.get("location"),
    ).toContain("error=signup");
    auth.signUp.mockResolvedValueOnce({ data: { session: {} }, error: null });
    expect(
      (await POST(request({ mode: "signup" }))).headers.get("location"),
    ).toBe("https://leadscope.test/clients");
  });
});
