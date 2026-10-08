import { z } from "zod";
import { admin, checked } from "@/lib/server/db";
import { failure } from "@/lib/server/http";
import { PROVIDER_IDS, providerBalance, providerBalances } from "@/lib/server/balances";
export const runtime = "nodejs";
// Balances for the Credits page, or one provider's for a dialog that spends it.
export async function GET(request: Request) {
  try {
    const { db } = await admin();
    const params = new URL(request.url).searchParams;
    // Which lookup source has found numbers, over the last N days or all time.
    const coverage = params.get("coverage");
    if (coverage) {
      const days = coverage === "all" ? null : z.coerce.number().int().min(1).max(3650).parse(coverage);
      return Response.json(checked(await db.rpc("mobile_coverage", { p_days: days })), { headers: { "Cache-Control": "no-store" } });
    }
    const fresh = params.get("fresh") === "1";
    const only = params.get("provider");
    const balances = only ? [await providerBalance(z.enum(PROVIDER_IDS as [string, ...string[]]).parse(only) as (typeof PROVIDER_IDS)[number], fresh)] : await providerBalances(fresh);
    return Response.json({ balances, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
