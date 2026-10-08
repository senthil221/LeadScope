import { z } from "zod";
import { admin, AppError, checked, integrationDb } from "@/lib/server/db";
import { body, failure } from "@/lib/server/http";
import { searchSerper, ProviderError } from "@/lib/server/serper";
import { xrayResults, type XrayResult } from "@/lib/recruiting/xray";
import { normalizeQuery } from "@/lib/queries";
export const runtime = "nodejs";
export const maxDuration = 60;
type Db = Awaited<ReturnType<typeof admin>>["db"];
// Who in these results the role already has, and who the blocklist keeps out.
async function known(db: Db, role: string, urls: string[]) {
  if (!urls.length) return { inRole: [] as string[], blocked: [] as string[] };
  return checked(await db.rpc("role_xray_known", { p_role: role, p_urls: [...new Set(urls)].slice(0, 500) })) as { inRole: string[]; blocked: string[] };
}
export async function GET(request: Request) {
  try {
    const { db } = await admin();
    const role = z.uuid().parse(new URL(request.url).searchParams.get("role"));
    const searches = checked(await db.from("role_xray_searches").select("id,query,country,page,results,status,created_at").eq("role_id", role).eq("status", "complete").order("created_at", { ascending: false }).limit(40)) as { results: XrayResult[] }[];
    return Response.json({ configured: Boolean(process.env.SERPER_API_KEY?.trim() && process.env.SERPER_LIVE_ENABLED === "true"), searches, known: await known(db, role, searches.flatMap((s) => s.results.map((r) => r.url))) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const input = await body(request), { db } = await admin();
    if (input.action === "import") {
      const p = z.object({ role: z.uuid(), searches: z.array(z.uuid()).min(1).max(20), urls: z.array(z.url().max(500)).min(1).max(200) }).parse(input);
      return Response.json(checked(await db.rpc("import_role_xray_runs", { p_role: p.role, p_searches: [...new Set(p.searches)], p_urls: [...new Set(p.urls)] })));
    }
    const p = z.object({ role: z.uuid(), query: z.string().trim().min(1).max(500), country: z.string().regex(/^[a-z]{2}$/), page: z.number().int().min(1).max(10), token: z.uuid() }).parse(input);
    try { p.query = normalizeQuery(p.query); } catch (error) { throw new AppError((error as Error).message); }
    if (!process.env.SERPER_API_KEY?.trim() || process.env.SERPER_LIVE_ENABLED !== "true") throw new AppError("Add SERPER_API_KEY and enable SERPER_LIVE_ENABLED on the server to start X-Ray search.", 503);
    const reserved = checked(await db.rpc("reserve_role_xray", { p_role: p.role, p_query: p.query, p_country: p.country, p_page: p.page, p_token: p.token })) as { id: string; existing: boolean; status?: string; results?: XrayResult[] };
    if (reserved.existing) {
      if (reserved.status !== "complete") throw new AppError("This search was already submitted. Start a new search to try again.", 409);
      const results = reserved.results ?? [];
      return Response.json({ id: reserved.id, results, reused: true, known: await known(db, p.role, results.map((r) => r.url)) });
    }
    const service = integrationDb();
    let results: XrayResult[];
    try {
      const raw = await searchSerper(p.query, p.country, "en", p.page);
      results = xrayResults(raw.organic);
      checked(await service.from("role_xray_searches").update({ results, status: "complete" }).eq("id", reserved.id));
    } catch (error) {
      await service.from("role_xray_searches").update({ status: "failed" }).eq("id", reserved.id);
      if (error instanceof ProviderError) throw new AppError(`Google search could not complete (${error.code}). Check the Serper account and try again.`, 502);
      throw error;
    }
    return Response.json({ id: reserved.id, results, reused: false, known: await known(db, p.role, results.map((r) => r.url)) });
  } catch (error) { return failure(error); }
}
