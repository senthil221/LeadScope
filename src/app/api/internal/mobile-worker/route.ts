import { timingSafeEqual } from "node:crypto";
import { processMobileJob } from "@/lib/server/mobile-worker";
import { failure } from "@/lib/server/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const expected = process.env.MOBILE_WORKER_SECRET;
  const received = request.headers.get("x-worker-secret") ?? "";
  if (!expected || expected.length < 32 || Buffer.byteLength(received) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return new Response(null, { status: 401 });
  try { return Response.json(await processMobileJob(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
