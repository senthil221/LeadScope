import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { setup } from "./config";
import { authCookieName, forBrowser, supabaseAddresses } from "../supabase-address";
export async function sessionDb() {
  const env = setup();
  if (!env.url || !env.key)
    throw new AppError("Configure Supabase URL and publishable key.", 503);
  const jar = await cookies();
  return createServerClient(supabaseAddresses().serverUrl!, env.key, {
    cookieOptions: { name: authCookieName(env.url) },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Proxy refreshes cookies for server components. */
        }
      },
    },
  });
}
export function integrationDb() {
  const env = setup();
  if (!env.url || !env.secret)
    throw new AppError(
      "Set SUPABASE_SECRET_KEY on the server to enable search processing.",
      503,
    );
  return createClient(supabaseAddresses().serverUrl!, env.secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
// For a signed storage link about to be handed to a browser.
export const browserUrl = forBrowser;
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function admin() {
  const db = await sessionDb();
  // The token is checked here, against the auth service's published public
  // key (fetched once and cached), instead of by asking the auth service -
  // which spent 70 to 120ms of its own time on that, on every page and every
  // action. The session is refreshed first if it has expired.
  //
  // The trade-off, chosen deliberately: a token from a session that has since
  // been signed out keeps working until it expires - an hour at most - rather
  // than stopping at once. Removing someone's approval is still immediate,
  // because that is the user_profiles check below, made on every request; and
  // every query carries the same token to the database, which verifies it
  // again. A token signed the old symmetric way still goes to the auth service.
  const { data, error } = await db.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || claims.role !== "authenticated")
    throw new AppError("Sign in to continue.", 401);
  const user = {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
  };
  const { data: profile, error: profileError } = await db
    .from("user_profiles")
    .select("is_agency_admin,is_owner")
    .eq("id", user.id)
    .single();
  if (profileError)
    throw new AppError(
      "Database setup is incomplete or unavailable. Apply the database migrations and check the connection.",
      503,
    );
  if (!profile?.is_agency_admin)
    throw new AppError(
      "Your account has not been approved by the agency administrator.",
      403,
    );
  // The owner flag decides whether the access screen exists for this person.
  // It is carried here for rendering only; the RPCs behind that screen check
  // it again for themselves, so hiding the link is never the protection.
  return { db, user, isOwner: Boolean(profile?.is_owner) };
}
export function checked<T>(result: {
  data: T;
  error: { message: string; code?: string } | null;
}): NonNullable<T> {
  if (result.error) {
    const message = result.error.message;
    let safe = /^(LS:)/.test(message)
      ? message.slice(3).trim()
      : "The database could not complete this action. Check configuration and try again.";
    if (safe.startsWith("No eligible queries"))
      safe =
        "No new searches are available. Enable a query, or open More options and choose to search recent queries again.";
    if (safe.startsWith("Campaign changed. Preview"))
      safe = "This campaign changed. Reload it before starting the search.";
    console.error(
      JSON.stringify({
        event: "database_error",
        code: result.error.code ?? "unknown",
      }),
    );
    throw new AppError(safe, 409);
  }
  return result.data as NonNullable<T>;
}
