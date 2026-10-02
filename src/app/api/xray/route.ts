import { z } from "zod";
import { admin, AppError, checked, integrationDb } from "@/lib/server/db";
import { body, failure } from "@/lib/server/http";
import { searchSerper, ProviderError } from "@/lib/server/serper";
import { xrayResults, type XrayResult } from "@/lib/recruiting/xray";
import { normalizeQuery } from "@/lib/queries";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const { db } = await admin();
    const role = z.uuid().parse(new URL(request.url).searchParams.get("role"));
    const searches = checked(await db.from("role_xray_searches").select("id,query,country,page,results,status,created_at").eq("role_id", role).eq("status", "complete").order("created_at", { ascending: false }).limit(5));
    return Response.json({ configured: Boolean(process.env.SERPER_API_KEY?.trim() && process.env.SERPER_LIVE_ENABLED === "true"), searches }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const input = await body(request), { db } = await admin();
    if (input.action === "import") {
      const p = z.object({ role: z.uuid(), search: z.uuid(), urls: z.array(z.url().max(500)).min(1).max(100) }).parse(input);
      return Response.json(checked(await db.rpc("import_role_xray", { p_role: p.role, p_search: p.search, p_urls: [...new Set(p.urls)] })));
    }
    const p = z.object({ role: z.uuid(), query: z.string().trim().min(1).max(500), country: z.string().regex(/^[a-z]{2}$/), page: z.number().int().min(1).max(5), token: z.uuid() }).parse(input);
    try { p.query = normalizeQuery(p.query); } catch (error) { throw new AppError((error as Error).message); }
    if (!process.env.SERPER_API_KEY?.trim() || process.env.SERPER_LIVE_ENABLED !== "true") throw new AppError("Add SERPER_API_KEY and enable SERPER_LIVE_ENABLED on the server to start X-Ray search.", 503);
    const reserved = checked(await db.rpc("reserve_role_xray", { p_role: p.role, p_query: p.query, p_country: p.country, p_page: p.page, p_token: p.token })) as { id: string; existing: boolean; status?: string; results?: XrayResult[] };
    if (reserved.existing) {
      if (reserved.status !== "complete") throw new AppError("This search was already submitted. Start a new search to try again.", 409);
      return Response.json({ id: reserved.id, results: reserved.results });
    }
    const service = integrationDb();
    try {
      const raw = await searchSerper(p.query, p.country, "en", p.page);
      const results = xrayResults(raw.organic);
      checked(await service.from("role_xray_searches").update({ results, status: "complete" }).eq("id", reserved.id));
      return Response.json({ id: reserved.id, results });
    } catch (error) {
      await service.from("role_xray_searches").update({ status: "failed" }).eq("id", reserved.id);
      if (error instanceof ProviderError) throw new AppError(`Google search could not complete (${error.code}). Check the Serper account and try again.`, 502);
      throw error;
    }
  } catch (error) { return failure(error); }
}
