// Where Supabase is, from each side.
//
// The browser reaches it at its public address. The server can use a closer
// one: in production the app and Supabase run on the same machine, and going
// out through the public hostname cost a DNS lookup, a TLS handshake and a
// trip through the reverse proxy on every query - 17 to 118ms each, measured,
// against 2 to 6ms on the internal network. A page makes several. Without
// SUPABASE_INTERNAL_URL both sides use the public address, as before.
export function supabaseAddresses() {
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serverUrl = process.env.SUPABASE_INTERNAL_URL?.trim() || publicUrl;
  return { publicUrl, serverUrl };
}

// The session cookie is named after the public hostname, because that is what
// the browser's client names it after. A server client pointed at the internal
// address would otherwise derive a different name, look for that cookie, and
// find nobody signed in.
export function authCookieName(publicUrl: string) {
  return `sb-${new URL(publicUrl).hostname.split(".")[0]}-auth-token`;
}

// A link minted on the server - a signed storage URL - carries the address the
// server used to ask for it. Anything handed to a browser needs the public one;
// the signature covers the path and token, not the host, so swapping the
// origin keeps it valid.
export function forBrowser(url: string) {
  const { publicUrl, serverUrl } = supabaseAddresses();
  if (!publicUrl || !serverUrl || publicUrl === serverUrl) return url;
  const server = new URL(serverUrl);
  const target = new URL(url);
  if (target.origin !== server.origin) return url;
  const browser = new URL(publicUrl);
  const serverPath = server.pathname.replace(/\/+$/, "");
  const browserPath = browser.pathname.replace(/\/+$/, "");
  const path = target.pathname.startsWith(serverPath)
    ? browserPath + target.pathname.slice(serverPath.length)
    : target.pathname;
  return `${browser.origin}${path}${target.search}${target.hash}`;
}
