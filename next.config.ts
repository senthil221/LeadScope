import type { NextConfig } from "next";
const config: NextConfig = {
  // The VPS image needs only Next's traced runtime files, not a full source
  // checkout or development dependencies.
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // Without this the client cache holds a dynamic route for zero seconds, so
    // moving between stages threw the whole workspace away and put the loading
    // skeleton up while the server answered again — even though the rows had
    // already been prefetched. A prefetched page lands in the `static` bucket,
    // whose default of five minutes is too long to sit on somebody else's
    // change; a minute is not. Your own changes do not depend on either
    // number: the stage rail versions its links so a page you have altered is
    // asked for at a URL nothing has cached.
    staleTimes: { dynamic: 30, static: 60 },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      // Pages hold candidate data and must never be stored. Build output is
      // the opposite: its filename contains a hash of its contents, so a given
      // URL can never change. Sweeping it into no-store made every visit
      // re-download the whole bundle; left out, it keeps the immutable caching
      // Next already gives it.
      {
        source: "/((?!_next/static).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};
export default config;
