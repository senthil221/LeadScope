import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  authCookieName,
  forBrowser,
  supabaseAddresses,
} from "../src/lib/supabase-address";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
function addresses(publicUrl: string, internal?: string) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = publicUrl;
  if (internal) process.env.SUPABASE_INTERNAL_URL = internal;
  else delete process.env.SUPABASE_INTERNAL_URL;
}

describe("where the server reaches Supabase", () => {
  it("uses the internal address when one is set, and the public one otherwise", () => {
    addresses("https://api.example.link", "http://supabase-envoy:8000");
    expect(supabaseAddresses()).toEqual({
      publicUrl: "https://api.example.link",
      serverUrl: "http://supabase-envoy:8000",
    });
    addresses("https://api.example.link");
    expect(supabaseAddresses().serverUrl).toBe("https://api.example.link");
  });

  // If this ever disagrees with the library, every server request would look
  // for a cookie the browser never wrote, and everybody would be signed out.
  it("names the session cookie exactly as the browser's client does", () => {
    const url = "https://api.example.link";
    const client = createClient(url, "public-key", {
      auth: { persistSession: false },
    }) as unknown as { storageKey: string };
    expect(authCookieName(url)).toBe(client.storageKey);
    expect(authCookieName(url)).toBe("sb-api-auth-token");
  });
});

describe("a signed link on its way to a browser", () => {
  const signed =
    "http://supabase-envoy:8000/storage/v1/object/sign/resumes/a/b.pdf?token=abc.def";

  it("swaps the internal origin for the public one and keeps the signature", () => {
    addresses("https://api.example.link", "http://supabase-envoy:8000");
    expect(forBrowser(signed)).toBe(
      "https://api.example.link/storage/v1/object/sign/resumes/a/b.pdf?token=abc.def",
    );
  });

  it("leaves a link alone when there is no internal address", () => {
    addresses("https://api.example.link");
    const publicLink = "https://api.example.link/storage/v1/object/sign/x?token=1";
    expect(forBrowser(publicLink)).toBe(publicLink);
  });

  it("leaves a link that never pointed at the internal address alone", () => {
    addresses("https://api.example.link", "http://supabase-envoy:8000");
    const elsewhere = "https://cdn.example.com/file.pdf?x=1";
    expect(forBrowser(elsewhere)).toBe(elsewhere);
  });
});
