import { z } from "zod";
import { admin, checked, integrationDb, AppError } from "@/lib/server/db";
import { body, failure } from "@/lib/server/http";
import { setup } from "@/lib/server/config";
import { campaignSchema, configSchema, uuid } from "@/lib/domain";
import { generateQueries, normalizeQuery, signature } from "@/lib/queries";
import { canonicalLinkedIn } from "@/lib/urls";
import { parseExcludedUrls } from "@/lib/exclusions";
import { processNext } from "@/lib/server/process";
import { qualify, mergeAssessment } from "@/lib/qualification";
export const runtime = "nodejs";
export const maxDuration = 60;
const note = z.string().max(4000).default("");
export async function POST(request: Request) {
  try {
    const input = await body(request);
    const { action, payload } = z
      .object({ action: z.string(), payload: z.unknown() })
      .parse(input);
    const { db, user } = await admin();
    let result: unknown;
    switch (action) {
      case "generate":
        result = generateQueries(configSchema.parse(payload));
        break;
      case "client": {
        const p = z
          .object({
            id: uuid.optional(),
            name: z.string().trim().min(1).max(120),
            notes: note,
          })
          .parse(payload);
        result = {
          id: checked(
            await db.rpc("save_client", {
              p_id: p.id ?? null,
              p_name: p.name,
              p_notes: p.notes,
            }),
          ),
        };
        break;
      }
      case "campaign": {
        const p = campaignSchema.parse(payload);
        const qs = p.queries.map((q) => ({
          ...q,
          text: normalizeQuery(q.text),
          signature: signature(q.text, p.config.country, p.config.language),
        }));
        if (
          qs.filter((q) => q.strategy === "custom").length > 20 ||
          qs.filter((q) => q.strategy !== "custom").length > 20
        )
          throw new AppError("Use at most 20 generated and 20 custom queries.");
        if (new Set(qs.map((q) => q.signature)).size !== qs.length)
          throw new AppError("Remove duplicate queries before saving.");
        result = {
          id: checked(
            await db.rpc("save_campaign", {
              p_id: p.id ?? null,
              p_client: p.clientId,
              p_name: p.name,
              p_config: p.config,
              p_queries: qs,
              p_reset: p.reset,
              p_revision: p.expectedRevision ?? null,
            }),
          ),
        };
        break;
      }
      case "archive": {
        const p = z
          .object({
            kind: z.enum(["client", "campaign"]),
            id: uuid,
            archived: z.boolean(),
          })
          .parse(payload);
        checked(
          await db.rpc("archive_entity", {
            p_kind: p.kind,
            p_id: p.id,
            p_archived: p.archived,
          }),
        );
        break;
      }
      case "role": {
        const p = z
          .object({
            id: uuid.optional(),
            clientId: uuid,
            name: z.string().trim().min(1).max(120),
            description: z.string().max(4000).default(""),
            ratingThreshold: z.number().int().min(0).max(5),
            expectedRevision: z.number().int().min(1).optional(),
          })
          .parse(payload);
        result = {
          id: checked(
            await db.rpc("save_role", {
              p_id: p.id ?? null,
              p_client: p.clientId,
              p_name: p.name,
              p_description: p.description,
              p_threshold: p.ratingThreshold,
              p_revision: p.expectedRevision ?? null,
            }),
          ),
        };
        break;
      }
      case "archiveRole": {
        const p = z
          .object({ id: uuid, archived: z.boolean() })
          .parse(payload);
        checked(
          await db.rpc("archive_role", {
            p_id: p.id,
            p_archived: p.archived,
          }),
        );
        break;
      }
      case "importCandidates": {
        const identity = z.object({
          kind: z.enum(["linkedin", "naukri", "email", "phone", "external"]),
          value: z.string().min(1).max(500),
        });
        const p = z
          .object({
            clientId: uuid,
            roleId: uuid,
            source: z.enum([
              "linkedin",
              "naukri",
              "manual",
              "url_paste",
              "csv",
              "sourcing_import",
              "other",
            ]),
            rows: z
              .array(
                z.object({
                  name: z.string().trim().min(1).max(200),
                  identities: z.array(identity).min(1).max(10),
                  fields: z
                    .record(z.string(), z.union([z.string(), z.number()]))
                    .default({}),
                }),
              )
              .min(1)
              .max(200),
          })
          .parse(payload);
        result = checked(
          await db.rpc("import_candidates", {
            p_client: p.clientId,
            p_role: p.roleId,
            p_rows: p.rows,
            p_source: p.source,
          }),
        );
        break;
      }
      case "duplicate": {
        const p = z.object({ id: uuid }).parse(payload);
        const campaign = checked(
          await db.from("campaigns").select("*").eq("id", p.id).single(),
        );
        const queries = checked(
          await db
            .from("campaign_queries")
            .select("*")
            .eq("campaign_id", p.id)
            .eq("revision", campaign.revision)
            .order("ordinal"),
        );
        result = {
          id: checked(
            await db.rpc("save_campaign", {
              p_id: null,
              p_client: campaign.client_id,
              p_name: `${campaign.name.slice(0, 110)} (copy)`,
              p_config: campaign.config,
              p_queries: queries,
              p_reset: false,
              p_revision: null,
            }),
          ),
        };
        break;
      }
      case "preflight":
      case "start": {
        const p = z
          .object({
            campaignId: uuid,
            force: z.array(uuid).max(40).default([]),
            token: uuid,
            cap: z.number().int().min(1).max(50).optional(),
            revision: z.number().int().min(1).optional(),
          })
          .parse(payload);
        if (action === "start" && !setup().live)
          throw new AppError(
            "Search is not connected yet. Ask your workspace administrator to finish search setup in Settings.",
            503,
          );
        if (action === "start" && (!p.cap || !p.revision))
          throw new AppError(
            "Reload the campaign to use its latest search limit.",
          );
        result = checked(
          await integrationDb().rpc("prepare_run", {
            p_actor: user.id,
            p_campaign: p.campaignId,
            p_token: p.token,
            p_force: p.force,
            p_cap:
              action === "start"
                ? Math.min(setup().serverCap, p.cap!)
                : setup().serverCap,
            p_create: action === "start",
            p_revision: p.revision ?? null,
          }),
        );
        break;
      }
      case "process": {
        const p = z.object({ runId: uuid }).parse(payload);
        result = await processNext(p.runId);
        break;
      }
      case "control": {
        const p = z
          .object({
            runId: uuid,
            action: z.enum(["pause", "resume", "cancel"]),
          })
          .parse(payload);
        checked(
          await db.rpc("control_run", { p_run: p.runId, p_action: p.action }),
        );
        break;
      }
      case "review": {
        const p = z
          .object({
            clientId: uuid,
            ids: z.array(uuid).min(1).max(100),
            decision: z.enum(["accepted", "review", "rejected", "suppressed"]),
            note,
          })
          .parse(payload);
        checked(
          await db.rpc("review_leads", {
            p_client: p.clientId,
            p_ids: [...new Set(p.ids)],
            p_decision: p.decision,
            p_note: p.note,
          }),
        );
        break;
      }
      case "exclude": {
        const p = z
          .object({ clientId: uuid, text: z.string().min(1).max(50000) })
          .parse(payload);
        const parsed = parseExcludedUrls(p.text);
        if (parsed.invalid.length)
          throw new AppError(
            `Fix ${parsed.invalid.length} invalid entries before adding exclusions.`,
          );
        if (!parsed.urls.length || parsed.urls.length > 500)
          throw new AppError(
            "Paste between 1 and 500 LinkedIn profile URLs at a time.",
          );
        result = checked(
          await db.rpc("exclude_profiles", {
            p_client: p.clientId,
            p_urls: parsed.urls,
          }),
        );
        break;
      }
      case "suppression": {
        const p = z
          .object({
            clientId: uuid,
            url: z.string().max(2000),
            reason: z.string().trim().min(1).max(200),
            note,
            active: z.boolean(),
          })
          .parse(payload);
        const url = canonicalLinkedIn(p.url);
        if (!url)
          throw new AppError("Enter a valid LinkedIn /in/ profile URL.");
        checked(
          await db.rpc("set_suppression", {
            p_client: p.clientId,
            p_url: url,
            p_reason: p.reason,
            p_note: p.note,
            p_active: p.active,
          }),
        );
        break;
      }
      case "contact": {
        const p = z
          .object({
            clientId: uuid,
            profileId: uuid,
            status: z.enum([
              "not_contacted",
              "contacted",
              "replied",
              "follow_up",
              "not_interested",
            ]),
          })
          .parse(payload);
        checked(
          await db.rpc("save_contact_status", {
            p_client: p.clientId,
            p_profile: p.profileId,
            p_status: p.status,
          }),
        );
        break;
      }
      case "note": {
        const p = z
          .object({ clientId: uuid, profileId: uuid, note })
          .parse(payload);
        checked(
          await db.rpc("save_profile_note", {
            p_client: p.clientId,
            p_profile: p.profileId,
            p_note: p.note,
          }),
        );
        break;
      }
      case "time": {
        const p = z
          .object({
            campaignId: uuid,
            seconds: z.number().int().min(1).max(30),
            token: uuid,
          })
          .parse(payload);
        checked(
          await db.rpc("record_review_time", {
            p_campaign: p.campaignId,
            p_seconds: p.seconds,
            p_token: p.token,
          }),
        );
        break;
      }
      case "requalify": {
        const p = z.object({ id: uuid }).parse(payload);
        const lead = checked(
          await db
            .from("campaign_profiles")
            .select("*")
            .eq("id", p.id)
            .single(),
        );
        const campaign = checked(
          await db
            .from("campaigns")
            .select("*")
            .eq("id", lead.campaign_id)
            .single(),
        );
        const sources = checked(
          await db
            .from("discoveries")
            .select("title,snippet,observed_at")
            .eq("client_profile_id", lead.client_profile_id)
            .eq("campaign_id", lead.campaign_id)
            .order("observed_at", { ascending: false })
            .limit(100),
        );
        if (!sources.length)
          throw new AppError("No stored evidence is available to requalify.");
        const config = configSchema.parse(campaign.config);
        const assessments = sources
          .reverse()
          .map((s) => qualify(s.title, s.snippet, config, s.observed_at));
        const assessment = assessments.reduce(mergeAssessment);
        checked(
          await integrationDb().rpc("requalify_lead", {
            p_actor: user.id,
            p_id: p.id,
            p_version: campaign.criteria_version,
            p_assessment: assessment,
            p_prior: lead.assessment,
          }),
        );
        break;
      }
      case "cleanup":
        checked(await db.rpc("cleanup_raw_responses"));
        break;
      default:
        throw new AppError("Unknown action.");
    }
    return Response.json(result ?? { ok: true });
  } catch (error) {
    return failure(error);
  }
}
