import { z } from "zod";
import { sessionDb, AppError } from "@/lib/server/db";
import { setup } from "@/lib/server/config";
import { boundedText, failure, sameOrigin } from "@/lib/server/http";
const credentials = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  mode: z.enum(["signin", "signup"]),
});
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (
      !request.headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      throw new AppError("Expected a sign-in form.");
    const form = new URLSearchParams(await boundedText(request, 4096));
    const parsed = credentials.safeParse(Object.fromEntries(form));
    if (!parsed.success)
      return Response.redirect(
        new URL("/login?error=invalid", request.url),
        303,
      );
    const { email, password, mode } = parsed.data;
    const db = await sessionDb();
    if (mode === "signup") {
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${setup().appUrl}/auth/callback` },
      });
      if (error)
        return Response.redirect(
          new URL("/login?error=signup", request.url),
          303,
        );
      return Response.redirect(
        new URL(
          data.session ? "/clients" : "/login?message=confirm",
          request.url,
        ),
        303,
      );
    }
    const { error } = await db.auth.signInWithPassword({ email, password });
    return Response.redirect(
      new URL(error ? "/login?error=credentials" : "/clients", request.url),
      303,
    );
  } catch (error) {
    return failure(error);
  }
}
