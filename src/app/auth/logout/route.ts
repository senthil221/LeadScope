import { sessionDb } from "@/lib/server/db";
import { sameOrigin, failure } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    // Stay on whichever hostname the person is actually using; their session
    // cookie was set there.
    const origin = sameOrigin(request);
    await (await sessionDb()).auth.signOut();
    return Response.redirect(new URL("/login", origin), 303);
  } catch (e) {
    return failure(e);
  }
}
