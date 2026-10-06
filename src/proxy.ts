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
  await db.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
