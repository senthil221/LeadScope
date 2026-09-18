import { sessionDb } from "@/lib/server/db";
import { setup } from "@/lib/server/config";
import { sameOrigin, failure } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    const origin = setup().appUrl ?? new URL(request.url).origin;
    sameOrigin(request);
    await (await sessionDb()).auth.signOut();
    return Response.redirect(new URL("/login", origin), 303);
  } catch (e) {
    return failure(e);
  }
}
