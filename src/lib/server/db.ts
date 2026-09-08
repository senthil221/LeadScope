import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { setup } from "./config";
export async function sessionDb() {
  const env = setup();
  if (!env.url || !env.key)
    throw new AppError("Configure Supabase URL and publishable key.", 503);
  const jar = await cookies();
  return createServerClient(env.url, env.key, {
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
  return createClient(env.url, env.secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
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
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) throw new AppError("Sign in to continue.", 401);
  const { data: profile, error: profileError } = await db
    .from("user_profiles")
    .select("is_agency_admin")
    .eq("id", user.id)
    .single();
  if (profileError)
    throw new AppError(
      "Database setup is incomplete or unavailable. Apply the LeadScope migration and check the connection.",
      503,
    );
  if (!profile?.is_agency_admin)
    throw new AppError(
      "Your account has not been approved by the agency administrator.",
      403,
    );
  return { db, user };
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
