import "server-only";
export function setup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.APP_URL;
  const cap = Number(process.env.SERPER_MAX_REQUESTS_PER_RUN || 50);
  const database = Boolean(url && key);
  const live =
    process.env.SERPER_LIVE_ENABLED === "true" &&
    Boolean(process.env.SERPER_API_KEY) &&
    Boolean(secret) &&
    Boolean(appUrl);
  return {
    url,
    key,
    secret,
    appUrl,
    database,
    live,
    serverCap: Number.isInteger(cap) && cap > 0 ? Math.min(cap, 50) : 50,
    checks: {
      "App URL": Boolean(appUrl),
      "Supabase URL": Boolean(url),
      "Supabase publishable key": Boolean(key),
      "Server integration key": Boolean(secret),
      "Serper API key": Boolean(process.env.SERPER_API_KEY),
      "Live searches enabled": process.env.SERPER_LIVE_ENABLED === "true",
    },
  };
}
