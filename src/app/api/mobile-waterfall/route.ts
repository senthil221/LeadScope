import { z } from "zod";
import { admin, AppError, checked } from "@/lib/server/db";
import { body, failure } from "@/lib/server/http";
import { mobileSetup } from "@/lib/server/mobile-providers";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { db } = await admin(); const params = new URL(request.url).searchParams;
    if (params.get("summary") === "1") {
      const p_role = z.uuid().parse(params.get("role"));
      const candidates = params.get("candidates");
      const result = candidates === null
        ? await db.rpc("mobile_waterfall_summary", { p_role })
        : await db.rpc("mobile_waterfall_table_status", { p_role, p_ids: [...new Set(z.array(z.uuid()).min(1).max(200).parse(candidates.split(",")))] });
      return Response.json(checked(result), { headers: { "Cache-Control": "no-store" } });
    }
    const p = z.object({ role: z.uuid(), candidate: z.uuid().nullable(), page: z.coerce.number().int().min(1).max(10000) }).parse({ role: params.get("role"), candidate: params.get("candidate"), page: params.get("page") ?? 1 });
    const result = checked(await db.rpc("mobile_waterfall_status", { p_role: p.role, p_candidate: p.candidate, p_page: p.page }));
    return Response.json({ ...result, providers: mobileSetup() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const input = await body(request), { db } = await admin();
    if (input.action === "cancel" || input.action === "retry") {
      const p = z.object({ role: z.uuid(), job: z.uuid(), action: z.enum(["cancel", "retry"]) }).parse(input);
      checked(await db.rpc("control_mobile_waterfall", { p_role: p.role, p_id: p.job, p_action: p.action }));
      return Response.json({ saved: true });
    }
    if (!process.env.MOBILE_WORKER_SECRET || process.env.MOBILE_WORKER_SECRET.length < 32) throw new AppError("Configure the mobile worker before starting lookups.", 503);
    const p = z.object({ role: z.uuid(), candidates: z.array(z.uuid()).min(1).max(200).optional(), memberships: z.array(z.uuid()).min(1).max(200).optional(), collectAll: z.boolean().default(false) }).parse(input);
    let ids = p.candidates;
    if (p.memberships) {
      const rows = checked(await db.from("role_candidates").select("id,candidate_id").eq("role_id", p.role).in("id", [...new Set(p.memberships)]));
      if (rows.length !== new Set(p.memberships).size) throw new AppError("Some selected profiles are no longer on this role. Refresh the table.");
      ids = rows.map((row) => row.candidate_id);
    }
    if (!ids?.length) throw new AppError("Select profiles for the lookup.");
    return Response.json(checked(await db.rpc("start_mobile_waterfall", { p_role: p.role, p_ids: [...new Set(ids)], p_all: p.collectAll })));
  } catch (error) { return failure(error); }
}
