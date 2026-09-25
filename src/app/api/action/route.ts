import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { admin, checked, integrationDb, AppError } from "@/lib/server/db";
import { body, failure } from "@/lib/server/http";
import { setup } from "@/lib/server/config";
import { campaignSchema, configSchema, uuid } from "@/lib/domain";
import { generateQueries, normalizeQuery, signature } from "@/lib/queries";
import { canonicalLinkedIn } from "@/lib/urls";
import { parseExcludedUrls } from "@/lib/exclusions";
import {
  isMobileNumber,
  mobileDigits,
  normalizeCandidateEmail,
} from "@/lib/recruiting/contact";
import { candidateSources, stages } from "@/lib/recruiting/stages";
import {
  roleCandidateListFilters,
  roleCandidateListQuery,
} from "@/lib/server/recruiting";
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
            ratingThreshold: z
              .number()
              .min(0)
              .max(5)
              .refine((value) => Math.round(value * 10) === value * 10),
            status: z.enum(["open", "on_hold", "closed"]),
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
              p_status: p.status,
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
            source: z.enum(candidateSources),
            // Rejected is not importable: that stage needs a rejection type
            // and reason, which a spreadsheet row cannot carry.
            stage: z
              .enum([
                "all_profiles",
                "profile_shortlisted",
                "recruiter_shortlisted",
                "client_shortlisted",
                "offer_sent",
              ])
              .default("all_profiles"),
            rows: z
              .array(
                z.object({
                  name: z.string().trim().min(1).max(200),
                  identities: z.array(identity).min(1).max(10),
                  fields: z
                    .record(z.string(), z.union([z.string(), z.number()]))
                    .default({}),
                  // A Source cell in the file, already resolved to one of the
                  // six before it left the browser.
                  source: z.enum(candidateSources).optional(),
                  custom: z
                    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
                    .default({}),
                }),
              )
              .min(1)
              .max(200),
          })
          .parse(payload);
        const rows = p.rows.map((row, index) => {
          const fields = { ...row.fields };
          const rawEmail = fields.email;
          if (rawEmail != null) {
            const normalized =
              typeof rawEmail === "string"
                ? normalizeCandidateEmail(rawEmail)
                : null;
            if (!normalized)
              throw new AppError(
                `Candidate row ${index + 1} has an invalid email address.`,
              );
            fields.email = normalized;
          }
          for (const key of ["phone", "alternatePhone"] as const) {
            const raw = fields[key];
            if (raw == null) continue;
            if (typeof raw !== "string" || !isMobileNumber(mobileDigits(raw)))
              throw new AppError(
                `Candidate row ${index + 1} needs a 10 digit mobile number.`,
              );
            fields[key] = mobileDigits(raw);
          }
          if (fields.alternatePhone != null && fields.alternatePhone === fields.phone)
            throw new AppError(
              `Candidate row ${index + 1} repeats the same mobile number twice.`,
            );
          // A rating can move a candidate into Profile shortlisted, so it is
          // checked here on the same scale the grid and the database use
          // rather than trusted from the sheet.
          const rawRating = fields.rating;
          if (
            rawRating != null &&
            (typeof rawRating !== "number" ||
              !Number.isFinite(rawRating) ||
              rawRating < 0 ||
              rawRating > 5 ||
              Math.round(rawRating * 10) !== rawRating * 10)
          )
            throw new AppError(
              `Candidate row ${index + 1} needs a rating from 0.0 to 5.0, to one decimal place.`,
            );
          const identities = row.identities.map((entry) => {
            if (entry.kind === "phone") {
              const digits = mobileDigits(entry.value);
              if (!isMobileNumber(digits))
                throw new AppError(
                  `Candidate row ${index + 1} needs a 10 digit mobile number.`,
                );
              return { ...entry, value: digits };
            }
            if (entry.kind === "email") {
              const normalized = normalizeCandidateEmail(entry.value);
              if (!normalized)
                throw new AppError(
                  `Candidate row ${index + 1} has an invalid email address.`,
                );
              return { ...entry, value: normalized };
            }
            return entry;
          });
          return { ...row, fields, identities };
        });
        result = checked(
          await db.rpc("import_candidates", {
            p_client: p.clientId,
            p_role: p.roleId,
            p_rows: rows,
            p_source: p.source,
            p_stage: p.stage,
          }),
        );
        break;
      }
      // Both are owner-only, enforced inside the RPC rather than here: the
      // route is reachable by any approved operator.
      case "operators": {
        result = checked(await db.rpc("list_operators"));
        break;
      }
      case "setOperatorAccess": {
        const p = z
          .object({ id: uuid, approved: z.boolean() })
          .parse(payload);
        checked(
          await db.rpc("set_operator_access", {
            p_id: p.id,
            p_approved: p.approved,
          }),
        );
        break;
      }
      case "sourcingProspects": {
        const p = z
          .object({ clientId: uuid, roleId: uuid })
          .parse(payload);
        // Resolve the role through the same client before exposing the
        // client's sourcing queue. This keeps the lazy dialog request scoped
        // to the role the recruiter is currently working in.
        checked(
          await db
            .from("roles")
            .select("id")
            .eq("id", p.roleId)
            .eq("client_id", p.clientId)
            .single(),
        );
        result = checked(
          await db
            .from("accepted_prospect_rows")
            .select("id,canonical_url,title")
            .eq("client_id", p.clientId)
            .order("date_added", { ascending: false })
            .limit(200),
        );
        break;
      }
      case "addExistingCandidates": {
        const p = z
          .object({
            clientId: uuid,
            roleId: uuid,
            candidateIds: z.array(uuid).min(1).max(200),
          })
          .parse(payload);
        result = checked(
          await db.rpc("add_candidates_to_role", {
            p_client: p.clientId,
            p_role: p.roleId,
            p_candidate_ids: [...new Set(p.candidateIds)],
            p_source: "master_db",
          }),
        );
        break;
      }
      case "rate": {
        const p = z
          .object({
            clientId: uuid,
            id: uuid,
            rating: z
              .number()
              .min(0)
              .max(5)
              .refine((value) => Math.round(value * 10) === value * 10)
              .nullable(),
          })
          .parse(payload);
        checked(
          await db.rpc("rate_candidate", {
            p_client: p.clientId,
            p_id: p.id,
            p_rating: p.rating,
          }),
        );
        break;
      }
      case "moveStage": {
        const p = z
          .object({
            clientId: uuid,
            ids: z.array(uuid).min(1).max(200),
            toStage: z.enum([
              "all_profiles",
              "profile_shortlisted",
              "recruiter_shortlisted",
              "client_shortlisted",
              "offer_sent",
            ]),
            reason: z.string().max(4000).default(""),
          })
          .parse(payload);
        checked(
          await db.rpc("move_stage", {
            p_client: p.clientId,
            p_ids: [...new Set(p.ids)],
            p_to_stage: p.toStage,
            p_reason: p.reason,
          }),
        );
        break;
      }
      case "rejectCandidates": {
        const p = z
          .object({
            clientId: uuid,
            ids: z.array(uuid).min(1).max(200),
            type: z.enum(["recruiter", "client"]),
            reason: z.string().trim().min(1).max(4000),
          })
          .parse(payload);
        checked(
          await db.rpc("reject_candidate", {
            p_client: p.clientId,
            p_ids: [...new Set(p.ids)],
            p_type: p.type,
            p_reason: p.reason,
          }),
        );
        break;
      }
      case "recordOutcome": {
        const p = z
          .object({
            clientId: uuid,
            ids: z.array(uuid).min(1).max(200),
            outcome: z.enum(["offer_sent", "offer_accepted", "offer_declined", "joined"]),
          })
          .parse(payload);
        checked(
          await db.rpc("record_outcome", {
            p_client: p.clientId,
            p_ids: [...new Set(p.ids)],
            p_outcome: p.outcome,
          }),
        );
        break;
      }
      case "applyThreshold": {
        const p = z
          .object({ clientId: uuid, roleId: uuid })
          .parse(payload);
        result = checked(
          await db.rpc("apply_threshold", {
            p_client: p.clientId,
            p_role: p.roleId,
          }),
        );
        break;
      }
      case "offerDetails": {
        const p = z
          .object({
            clientId: uuid,
            id: uuid,
            amount: z.number().min(0).max(999999999999.99).nullable().default(null),
            currency: z.string().trim().regex(/^[a-zA-Z]{0,10}$/).default(""),
            sentOn: z.string().date().nullable().default(null),
            responseDueAt: z.string().date().nullable().default(null),
            expectedStartAt: z.string().date().nullable().default(null),
            notes: z.string().max(4000).default(""),
          })
          .parse(payload);
        checked(
          await db.rpc("save_offer_details", {
            p_client: p.clientId,
            p_id: p.id,
            p_amount: p.amount,
            p_currency: p.currency,
            p_sent_on: p.sentOn,
            p_response_due_at: p.responseDueAt,
            p_expected_start_at: p.expectedStartAt,
            p_notes: p.notes,
          }),
        );
        break;
      }
      case "screening": {
        const p = z
          .object({
            clientId: uuid,
            id: uuid,
            screening: z.record(z.string(), z.unknown()).default({}),
            internalNotes: z.string().max(4000).default(""),
          })
          .parse(payload);
        checked(
          await db.rpc("save_screening", {
            p_client: p.clientId,
            p_id: p.id,
            p_screening: p.screening,
            p_internal_notes: p.internalNotes,
          }),
        );
        break;
      }
      case "clientNote": {
        const p = z
          .object({
            clientId: uuid,
            id: uuid,
            note: z.string().max(4000).default(""),
          })
          .parse(payload);
        checked(
          await db.rpc("save_client_note", {
            p_client: p.clientId,
            p_id: p.id,
            p_note: p.note,
          }),
        );
        break;
      }
      case "candidateActivity": {
        const p = z
          .object({ clientId: uuid, roleCandidateId: uuid })
          .parse(payload);
        result = checked(
          await db
            .from("role_candidate_events")
            .select("id,kind,from_stage,to_stage,reason,detail,created_at")
            .eq("client_id", p.clientId)
            .eq("role_candidate_id", p.roleCandidateId)
            .order("created_at", { ascending: false })
            .limit(100),
        );
        break;
      }
      case "candidateDetails": {
        const p = z
          .object({
            id: uuid,
            fullName: z.string().trim().min(1).max(200),
            headline: z.string().max(300).default(""),
            currentCompany: z.string().max(200).default(""),
            currentDesignation: z.string().max(200).default(""),
            location: z.string().max(200).default(""),
            totalExperienceYears: z.number().min(0).max(70).nullable().default(null),
            phone: z.string().max(24).nullable().default(null),
            alternatePhone: z.string().max(24).nullable().default(null),
            email: z.string().max(254).nullable().default(null),
            linkedin: z.string().url().max(500),
          })
          .parse(payload);
        const phone = p.phone ? mobileDigits(p.phone) : null;
        const alternatePhone = p.alternatePhone ? mobileDigits(p.alternatePhone) : null;
        if (phone && !isMobileNumber(phone))
          throw new AppError("Enter a 10 digit mobile number.");
        if (alternatePhone && !isMobileNumber(alternatePhone))
          throw new AppError("Enter a 10 digit alternate mobile number.");
        if (alternatePhone && alternatePhone === phone)
          throw new AppError(
            "The alternate mobile is the same as the primary one.",
          );
        const normalizedEmail = p.email
          ? normalizeCandidateEmail(p.email)
          : null;
        if (p.email && !normalizedEmail)
          throw new AppError(
            "Enter a valid email address, such as name@company.com.",
          );
        checked(
          await db.rpc("update_candidate_details", {
            p_id: p.id,
            p_full_name: p.fullName,
            p_headline: p.headline,
            p_current_company: p.currentCompany,
            p_current_designation: p.currentDesignation,
            p_location: p.location,
            p_total_experience_years: p.totalExperienceYears,
            p_phone: phone,
            p_alternate_phone: alternatePhone,
            p_email: normalizedEmail,
          }),
        );
        checked(
          await db.rpc("set_candidate_linkedin", {
            p_id: p.id,
            p_linkedin: p.linkedin,
          }),
        );
        break;
      }
      case "candidateLinkedIn": {
        const p = z.object({ id: uuid, value: z.string().max(500) }).parse(payload);
        const url = canonicalLinkedIn(p.value);
        if (!url) throw new AppError("Enter a valid LinkedIn /in/ profile URL.");
        checked(await db.rpc("set_candidate_linkedin", { p_id: p.id, p_linkedin: url }));
        break;
      }
      case "removeRoleCandidates": {
        const p = z.object({ clientId: uuid, roleId: uuid, ids: z.array(uuid).min(1).max(2000), stage: z.string().max(50).nullable() }).parse(payload);
        result = { batchId: checked(await db.rpc("remove_role_candidates", { p_client: p.clientId, p_role: p.roleId, p_ids: p.ids, p_stage: p.stage })) };
        break;
      }
      case "restoreRoleCandidates": {
        const p = z.object({ clientId: uuid, roleId: uuid, batchId: uuid }).parse(payload);
        result = { count: checked(await db.rpc("restore_role_candidates", { p_client: p.clientId, p_role: p.roleId, p_batch: p.batchId })) };
        break;
      }
      case "deletedRoleCandidates": {
        const p = z.object({ clientId: uuid, roleId: uuid }).parse(payload);
        result = checked(await db.rpc("deleted_role_candidate_batches", { p_client: p.clientId, p_role: p.roleId }));
        break;
      }
      case "candidateEditHistory": {
        const p = z.object({ clientId: uuid, roleId: uuid, candidateId: uuid.nullable().default(null), before: z.string().regex(/^\d+$/).max(19).nullable().default(null) }).parse(payload);
        result = checked(await db.rpc("candidate_edit_history_page", { p_client: p.clientId, p_role: p.roleId, p_candidate: p.candidateId, p_before: p.before }));
        break;
      }
      case "bulkEditCandidates": {
        const p = z.object({ clientId: uuid, roleId: uuid, ids: z.array(uuid).min(1).max(50), stage: z.string().max(50).nullable(), field: z.string().min(1).max(100), value: z.union([z.string().max(4000),z.number().finite(),z.boolean()]).nullable(), mode: z.enum(["replace","fill_empty","clear"]), expected: z.string().regex(/^[a-f0-9]{32}$/).nullable().default(null) }).parse(payload);
        result = checked(await db.rpc("bulk_edit_role_candidates", { p_client: p.clientId, p_role: p.roleId, p_ids: p.ids, p_stage: p.stage, p_field: p.field, p_value: p.value, p_mode: p.mode, p_expected: p.expected }));
        break;
      }
      // The ids behind the list a recruiter is looking at, so "select all"
      // can mean the whole filtered view rather than the page of it on
      // screen. Read-only, and bounded by the same limit the bulk edit takes.
      case "roleCandidateIds": {
        const p = z
          .object({
            clientId: uuid,
            roleId: uuid,
            stage: z.enum(stages),
            filters: z.record(z.string(), z.string().max(200)).default({}),
          })
          .parse(payload);
        const role = checked(
          await db
            .from("roles")
            .select("id,rating_threshold")
            .eq("id", p.roleId)
            .eq("client_id", p.clientId)
            .single(),
        ) as { rating_threshold: number };
        const rows = checked(
          await roleCandidateListQuery(
            db,
            p.roleId,
            p.stage,
            role.rating_threshold,
            roleCandidateListFilters(p.filters),
            false,
            "id,candidates!inner(id)",
          ).range(0, 1999),
        ) as unknown as { id: string }[];
        result = rows.map((row) => row.id);
        break;
      }
      case "duplicateReview": {
        const p = z.object({ clientId: uuid, roleId: uuid, status: z.enum(["pending","confirmed","separate"]), after: z.string().max(73).nullable().default(null) }).parse(payload);
        result = checked(await db.rpc("duplicate_review_page", { p_client: p.clientId, p_role: p.roleId, p_status: p.status, p_after: p.after }));
        break;
      }
      case "reviewDuplicate": {
        const p = z.object({ clientId: uuid, roleId: uuid, firstId: uuid, secondId: uuid, fingerprint: z.string().regex(/^[a-f0-9]{32}$/), revision: z.number().int().min(0), status: z.enum(["pending","confirmed","separate"]), note: z.string().max(2000) }).parse(payload);
        checked(await db.rpc("review_candidate_duplicate", { p_client: p.clientId, p_role: p.roleId, p_first: p.firstId, p_second: p.secondId, p_fingerprint: p.fingerprint, p_revision: p.revision, p_status: p.status, p_note: p.note }));
        break;
      }
      case "candidateField": {
        // One grid cell, saved on its own. The drawer's candidateDetails
        // replaces every column at once, which a single-cell edit cannot do
        // without clobbering whatever another operator changed meanwhile.
        const p = z
          .object({
            id: uuid,
            field: z.enum([
              "full_name",
              "headline",
              "current_company",
              "current_designation",
              "location",
              "current_ctc",
              "highest_qualification",
              "total_experience_years",
              "phone",
              "alternate_phone",
              "email",
            ]),
            value: z.string().max(400).nullable().default(null),
          })
          .parse(payload);
        let value = p.value?.trim() ? p.value.trim() : null;
        if (p.field === "email" && value) {
          const normalized = normalizeCandidateEmail(value);
          if (!normalized)
            throw new AppError(
              "Enter a valid email address, such as name@company.com.",
            );
          value = normalized;
        }
        if ((p.field === "phone" || p.field === "alternate_phone") && value) {
          value = mobileDigits(value);
          if (!isMobileNumber(value))
            throw new AppError("Enter a 10 digit mobile number.");
        }
        checked(
          await db.rpc("save_candidate_field", {
            p_id: p.id,
            p_field: p.field,
            p_value: value,
          }),
        );
        break;
      }
      case "addRoleField": {
        const p = z
          .object({
            clientId: uuid,
            roleId: uuid,
            label: z.string().trim().min(1).max(80),
            kind: z.enum(["text", "number", "date", "select", "boolean"]),
            options: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
          })
          .parse(payload);
        result = {
          id: checked(
            await db.rpc("add_role_field", {
              p_client: p.clientId,
              p_role: p.roleId,
              p_label: p.label,
              p_kind: p.kind,
              p_options: p.options,
            }),
          ),
        };
        break;
      }
      case "archiveRoleField": {
        const p = z
          .object({ id: uuid, archived: z.boolean() })
          .parse(payload);
        checked(
          await db.rpc("archive_role_field", {
            p_id: p.id,
            p_archived: p.archived,
          }),
        );
        break;
      }
      case "customField": {
        const p = z
          .object({
            clientId: uuid,
            id: uuid,
            key: z.string().min(1).max(50),
            value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
          })
          .parse(payload);
        checked(
          await db.rpc("save_custom_field", {
            p_client: p.clientId,
            p_id: p.id,
            p_key: p.key,
            p_value: p.value,
          }),
        );
        break;
      }
      case "createShareLink": {
        const p = z
          .object({
            clientId: uuid,
            roleId: uuid,
            visibleColumns: z.array(z.string().min(1).max(50)).min(1).max(30),
            expiresAt: z.string().datetime().nullable().default(null),
          })
          .parse(payload);
        // Generated and hashed here, matching signature() in queries.ts: the
        // raw token never touches SQL and is returned to the browser exactly
        // once, by this response.
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const id = checked(
          await db.rpc("create_share_link", {
            p_client: p.clientId,
            p_role: p.roleId,
            p_stage: "recruiter_shortlisted",
            p_visible_columns: p.visibleColumns,
            p_editable_columns: ["client_notes"],
            p_expires_at: p.expiresAt,
            p_token_hash: tokenHash,
            p_token_prefix: token.slice(0, 8),
            p_allow_decisions: false,
          }),
        );
        result = { id, token };
        break;
      }
      case "revokeShareLink": {
        const p = z.object({ id: uuid }).parse(payload);
        checked(await db.rpc("revoke_share_link", { p_id: p.id }));
        break;
      }
      case "regenerateShareLink": {
        const p = z.object({ id: uuid }).parse(payload);
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        checked(
          await db.rpc("regenerate_share_link", {
            p_id: p.id,
            p_token_hash: tokenHash,
            p_token_prefix: token.slice(0, 8),
          }),
        );
        result = { token };
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
