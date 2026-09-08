import { z } from "zod";
import { admin, checked } from "@/lib/server/db";
import { failure } from "@/lib/server/http";
import { uuid } from "@/lib/domain";
import { serializeExport } from "@/lib/export";
import type { Lead } from "@/lib/types";
import {
  prospectFilters,
  prospectCells,
  prospectColumns,
  type Prospect,
} from "@/lib/prospects";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { db } = await admin();
    const params = new URL(request.url).searchParams;
    const clientId = uuid.parse(params.get("client"));
    const campaignId = params.get("campaign")
      ? uuid.parse(params.get("campaign"))
      : undefined;
    const format = z.enum(["csv", "tsv"]).parse(params.get("format") ?? "csv");
    if (params.get("sheet") === "1") {
      const filters = prospectFilters(params);
      const rows = checked(
        await db.rpc("export_prospects", {
          p_client: clientId,
          p_contact: filters.contact,
          p_search: filters.q,
        }),
      ) as Prospect[];
      return new Response(
        serializeExport(rows.map(prospectCells), format, prospectColumns),
        {
          headers: {
            "Content-Type":
              format === "csv"
                ? "text/csv; charset=utf-8"
                : "text/tab-separated-values; charset=utf-8",
            "Content-Disposition": `attachment; filename="leadscope-prospects.${format}"`,
            "Cache-Control": "private, no-store",
          },
        },
      );
    }
    // One database statement returns a consistent, permission-checked export snapshot.
    const leads = checked(
      await db.rpc("export_accepted", {
        p_client: clientId,
        p_campaign: campaignId ?? null,
      }),
    ) as (Lead & { source_query: string })[];
    const seen = new Set<string>();
    const rows = leads
      .filter((row) => {
        if (seen.has(row.canonical_url)) return false;
        seen.add(row.canonical_url);
        return true;
      })
      .map((row) => [
        row.canonical_url,
        row.title,
        row.snippet,
        row.campaign_name,
        row.manual_decision,
        row.automatic_status,
        Object.values(row.assessment.criteria)
          .map((c) => c.reason)
          .join("; "),
        row.source_query,
        row.first_seen,
        row.last_seen,
        row.decided_at,
        [row.notes, row.decision_note].filter(Boolean).join(" | "),
      ]);
    return new Response(serializeExport(rows, format), {
      headers: {
        "Content-Type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": `attachment; filename="leadscope-accepted.${format}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
