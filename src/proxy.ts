import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieName, supabaseAddresses } from "./lib/supabase-address";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { publicUrl: url, serverUrl } = supabaseAddresses();
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  // This runs before every request, so the hop it makes is paid on every
  // page, prefetch and action. It goes the short way.
  const db = createServerClient(serverUrl!, key, {
    cookieOptions: { name: authCookieName(url) },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  // Only here to keep the session cookie fresh, never to decide anything:
  // admin() makes the authoritative check against the auth service on every
  // page and action. getUser() here made that same check a second time -
  // 70 to 120ms of the auth service's own time, on every request, measured in
  // its logs. getSession() reads the cookie and only calls out when the token
  // has actually expired and needs refreshing.
  await db.auth.getSession();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
