import { z } from "zod";
import { admin } from "@/lib/server/db";
import { failure } from "@/lib/server/http";
import { PROVIDER_IDS, providerBalance, providerBalances } from "@/lib/server/balances";
export const runtime = "nodejs";
// Balances for the Credits page, or one provider's for a dialog that spends it.
export async function GET(request: Request) {
  try {
    await admin();
    const params = new URL(request.url).searchParams;
    const fresh = params.get("fresh") === "1";
    const only = params.get("provider");
    const balances = only ? [await providerBalance(z.enum(PROVIDER_IDS as [string, ...string[]]).parse(only) as (typeof PROVIDER_IDS)[number], fresh)] : await providerBalances(fresh);
    return Response.json({ balances, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
