import { z } from "zod";
import { admin, AppError, checked } from "@/lib/server/db";
import { failure } from "@/lib/server/http";
import { uuid } from "@/lib/domain";
import { serializeExport } from "@/lib/export";
import type { Lead, RoleCandidate } from "@/lib/types";
import {
  prospectFilters,
  prospectCells,
  prospectColumns,
  type Prospect,
} from "@/lib/prospects";
import { isStage } from "@/lib/recruiting/stages";
import { roleCandidateExportCells, roleCandidateExportColumns } from "@/lib/recruiting/export";
import { roleCandidateListFilters, roleCandidateListQuery } from "@/lib/server/recruiting";
export const runtime = "nodejs";

function contentHeaders(filename: string, format: "csv" | "tsv") {
  return {
    "Content-Type":
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "text/tab-separated-values; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}.${format}"`,
    "Cache-Control": "private, no-store",
  };
}

function exportFilename(name: string) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `leadscope-${slug || "role"}-candidates`;
}

export async function GET(request: Request) {
  try {
    const { db } = await admin();
    const params = new URL(request.url).searchParams;
    const clientId = uuid.parse(params.get("client"));
    const campaignId = params.get("campaign")
      ? uuid.parse(params.get("campaign"))
      : undefined;
    const format = z.enum(["csv", "tsv"]).parse(params.get("format") ?? "csv");
    const roleId = params.get("role");
    if (roleId) {
      const stage = params.get("stage");
      if (!isStage(stage)) throw new AppError("Choose a valid candidate stage.");
      const role = checked(
        await db
          .from("roles")
          .select("id,name,rating_threshold")
          .eq("id", uuid.parse(roleId))
          .eq("client_id", clientId)
          .single(),
      );
      const result = await roleCandidateListQuery(
        db,
        role.id,
        stage,
        role.rating_threshold,
        roleCandidateListFilters({
          q: params.get("q") ?? undefined,
          source: params.get("source") ?? undefined,
          rating: params.get("rating") ?? undefined,
          sort: params.get("sort") ?? undefined,
        }),
      ).range(0, 9999);
      const rows = checked(result) as unknown as RoleCandidate[];
      if ((result.count ?? 0) > 10_000)
        throw new AppError(
          "Export fewer than 10,000 candidates at a time. Narrow the filters and try again.",
        );
      return new Response(
        serializeExport(
          rows.map(roleCandidateExportCells),
          format,
          roleCandidateExportColumns,
        ),
        { headers: contentHeaders(exportFilename(role.name), format) },
      );
    }
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
          headers: contentHeaders("leadscope-prospects", format),
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
      headers: contentHeaders("leadscope-accepted", format),
    });
  } catch (e) {
    return failure(e);
  }
}
