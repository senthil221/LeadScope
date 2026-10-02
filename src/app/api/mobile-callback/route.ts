import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { callbackToken, signalhireMobiles } from "@/lib/server/mobile-providers";
import { checked, integrationDb } from "@/lib/server/db";
import { boundedText, failure } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const url = new URL(request.url), job = z.uuid().parse(url.searchParams.get("job"));
    const token = url.searchParams.get("token") ?? "";
    const expected = callbackToken(job);
    if (!process.env.MOBILE_WORKER_SECRET || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return new Response(null, { status: 401 });
    const db = integrationDb();
    const row = checked(await db.from("mobile_waterfall_jobs").select("identifier").eq("id", job).single());
    const raw: unknown = JSON.parse(await boundedText(request, 1000000));
    const match = Array.isArray(raw) ? raw.find((item) => item?.item === row.identifier) : null;
    if (!match || !["success", "failed", "credits_are_over", "timeout_exceeded", "duplicate_query"].includes(match.status)) return new Response(null, { status: 400 });
    const code = ["success", "failed"].includes(match.status) ? null : match.status;
    checked(await db.rpc("save_mobile_callback", { p_id: job, p_results: signalhireMobiles(raw, row.identifier), p_code: code }));
    return Response.json({ received: true });
  } catch (error) { return failure(error); }
}
