import { sessionDb } from "@/lib/server/db";
import { setup } from "@/lib/server/config";
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  const origin = setup().appUrl ?? new URL(request.url).origin;
  if (code) {
    const db = await sessionDb();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return Response.redirect(`${origin}/clients`, 303);
  }
  return Response.redirect(`${origin}/login?error=confirmation`, 303);
}
