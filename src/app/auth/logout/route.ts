import { sessionDb } from "@/lib/server/db";
import { sameOrigin, failure } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await (await sessionDb()).auth.signOut();
    return Response.redirect(new URL("/login", request.url), 303);
  } catch (e) {
    return failure(e);
  }
}
