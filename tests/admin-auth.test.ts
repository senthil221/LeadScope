import { beforeEach, describe, expect, it, vi } from "vitest";

// admin() is the gate in front of every page and action. These pin what it
// accepts now that the token is checked locally rather than by the auth
// service: a signed, unexpired token for a signed-in user, whose profile is
// still approved - and nothing else.
const state = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  claimsError: null as Error | null,
  profile: { is_agency_admin: true, is_owner: false } as Record<string, boolean> | null,
  getUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: state.claims ? { claims: state.claims } : null,
        error: state.claimsError,
      }),
      getUser: state.getUser,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: state.profile, error: null }),
        }),
      }),
    }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://api.example.link";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-key";

const { admin } = await import("../src/lib/server/db");

beforeEach(() => {
  state.claims = { sub: "user-1", role: "authenticated", email: "ops@example.com" };
  state.claimsError = null;
  state.profile = { is_agency_admin: true, is_owner: false };
  state.getUser.mockReset();
});

describe("admin() with a locally checked token", () => {
  it("lets an approved, signed-in user through without asking the auth service", async () => {
    const result = await admin();
    expect(result.user).toEqual({ id: "user-1", email: "ops@example.com" });
    expect(result.isOwner).toBe(false);
    expect(state.getUser).not.toHaveBeenCalled();
  });

  it("refuses a token that failed its check", async () => {
    state.claims = null;
    state.claimsError = new Error("Invalid JWT signature");
    await expect(admin()).rejects.toMatchObject({ status: 401 });
  });

  it("refuses a token that is not a signed-in user's", async () => {
    state.claims = { role: "anon" };
    await expect(admin()).rejects.toMatchObject({ status: 401 });
    state.claims = { sub: "user-1", role: "service_role" };
    await expect(admin()).rejects.toMatchObject({ status: 401 });
  });

  // The part of the trade-off that does not wait for a token to expire.
  it("still shuts out somebody whose approval was removed, immediately", async () => {
    state.profile = { is_agency_admin: false, is_owner: false };
    await expect(admin()).rejects.toMatchObject({ status: 403 });
  });
});
