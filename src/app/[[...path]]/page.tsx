import { redirect, notFound } from "next/navigation";
import { admin, AppError, checked } from "@/lib/server/db";
import { setup } from "@/lib/server/config";
import { SetupPage, AccessPage } from "@/components/setup";
import { Workspace } from "@/components/workspace";
import { ClientsWorkspace } from "@/components/clients-workspace";
import { RoleWorkspace } from "@/components/recruiting/role-workspace";
import { RolesWorkspace } from "@/components/recruiting/roles-workspace";
import { prospectFilters } from "@/lib/prospects";
import { prospectQuery } from "@/lib/server/prospects";
import { uuid } from "@/lib/domain";
import type {
  PageData,
  Discovery,
  Lead,
  RoleCandidate,
  RoleDashboardCount,
  Client,
  ClientNavigationItem,
  Role,
} from "@/lib/types";
import { isStage } from "@/lib/recruiting/stages";
import {
  hasRoleCandidateListFilters,
  roleCandidateListFilters,
  roleCandidateListQuery,
} from "@/lib/server/recruiting";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function optionalDashboardData<T>(
  result: { data: T; error: { code?: string } | null } | null,
  query: string,
): NonNullable<T> | [] {
  if (!result?.error) return (result?.data ?? []) as NonNullable<T>;
  // The client directory is still useful when a summary RPC is temporarily
  // unavailable. Keep the primary workspace available and log only a safe,
  // query-level signal for diagnosis.
  console.error(
    JSON.stringify({
      event: "optional_dashboard_query_error",
      query,
      code: result.error.code ?? "unknown",
    }),
  );
  return [];
}

type RoleWorkspaceCount = Omit<RoleDashboardCount, "role_id">;

const emptyRoleWorkspaceCount: RoleWorkspaceCount = {
  all_profiles: 0,
  profile_shortlisted: 0,
  recruiter_shortlisted: 0,
  client_shortlisted: 0,
  offer_sent: 0,
  rejected: 0,
  due_follow_ups: 0,
  offers_in_progress: 0,
};

function roleCountRecord(summary: RoleWorkspaceCount) {
  return {
    all_profiles: summary.all_profiles,
    profile_shortlisted: summary.profile_shortlisted,
    recruiter_shortlisted: summary.recruiter_shortlisted,
    client_shortlisted: summary.client_shortlisted,
    offer_sent: summary.offer_sent,
    rejected: summary.rejected,
  };
}

async function loadRoleWorkspaceCounts(
  db: Awaited<ReturnType<typeof admin>>["db"],
  roleId: string,
  clientId: string,
) {
  const compact = await db.rpc("role_workspace_counts", { p_role: roleId });
  if (!compact.error) {
    const summary =
      ((compact.data as RoleWorkspaceCount[] | null)?.[0] ??
        emptyRoleWorkspaceCount);
    return {
      counts: roleCountRecord(summary),
      dashboard: { role_id: roleId, ...summary },
    };
  }
  // A deployment can reach Vercel just before its matching migration is
  // applied. Preserve the workspace in that short window and use the older,
  // broader aggregates until the scoped function is available.
  if (compact.error.code !== "PGRST202") checked(compact);
  const [stageCounts, dashboardCounts] = await Promise.all([
    db.rpc("role_candidate_stage_counts", { p_role: roleId }),
    db.rpc("role_dashboard_counts", { p_client: clientId }),
  ]);
  const counts: Record<string, number> = {};
  for (const row of checked(stageCounts) as {
    stage: string;
    candidate_count: number;
  }[])
    counts[row.stage] = row.candidate_count;
  const dashboard =
    (checked(dashboardCounts) as RoleDashboardCount[]).find(
      (item) => item.role_id === roleId,
    ) ?? { role_id: roleId, ...emptyRoleWorkspaceCount };
  return { counts, dashboard };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const env = setup();
  if (!env.database) return <SetupPage checks={env.checks} />;
  let auth: Awaited<ReturnType<typeof admin>>;
  try {
    auth = await admin();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login");
    return (
      <AccessPage
        title={
          error instanceof AppError && error.status === 403
            ? "Your account needs approval"
            : "Workspace unavailable"
        }
        message={
          error instanceof AppError
            ? error.message
            : "Check database configuration and try again."
        }
      />
    );
  }
  const { db, user } = auth;
  const { path = [] } = await params;
  if (!path.length) redirect("/clients");
  const filter = await searchParams;
  const needsActiveRuns =
    path[0] === "campaigns" ||
    path[0] === "runs" ||
    path[0] === "leads" ||
    (path[0] === "clients" && path[2] === "campaigns");
  const needsAgencyWorkQueue = path[0] === "clients" && !path[1];
  const roleId = path[0] === "roles" && path[1] ? uuid.parse(path[1]) : null;
  const [
    clients,
    navigationClients,
    initialRole,
    activeRuns,
    agencyWorkQueue,
    clientDirectoryCounts,
  ] = await Promise.all([
    roleId
      ? null
      : db
          .from("clients")
          .select("id,name,notes,archived,created_at")
          .order("name"),
    roleId
      ? db.from("clients").select("id,name,archived").order("name")
      : null,
    roleId
      ? db
          .from("roles")
          .select("*,clients!inner(*)")
          .eq("id", roleId)
          .single()
      : null,
    needsActiveRuns
      ? db
          .from("campaign_runs")
          .select("id,client_id,campaign_id,status,reserved,budget,new_candidates")
          .in("status", ["running", "paused"])
          .order("created_at")
          .limit(100)
      : null,
    needsAgencyWorkQueue ? db.rpc("agency_today_work_queue") : null,
    needsAgencyWorkQueue ? db.rpc("client_directory_counts") : null,
  ]);
  const data: PageData = {
    view: path[0],
    clients: clients ? checked(clients) : [],
    navigationClients: navigationClients
      ? (checked(navigationClients) as ClientNavigationItem[])
      : undefined,
    campaigns: [],
    live: env.live,
    serverCap: env.serverCap,
    activeRuns: activeRuns ? checked(activeRuns) : [],
    agencyWorkQueue: optionalDashboardData(agencyWorkQueue, "agency_today_work_queue"),
    clientDirectoryCounts: optionalDashboardData(clientDirectoryCounts, "client_directory_counts"),
    dashboardSummaryUnavailable: Boolean(
      agencyWorkQueue?.error || clientDirectoryCounts?.error,
    ),
    email: user.email ?? "Agency operator",
  };
  try {
    const loads: (() => Promise<void>)[] = [];
    let clientId = filter.client;
    if (path[0] === "clients" && path[1]) {
      clientId = uuid.parse(path[1]);
      data.view =
        path[2] === "excluded"
          ? "excluded"
          : path[2] === "prospects"
            ? "prospects"
            : path[2] === "roles"
              ? "roles"
              : path[2] === "campaigns"
                ? "client"
                : "roles";
    }
    if (path[0] === "campaigns") {
      data.view =
        path[1] === "new" || path[2] === "edit" ? "builder" : "campaign";
      if (path[1] !== "new") {
        data.campaign = checked(
          await db
            .from("campaigns")
            .select("*")
            .eq("id", uuid.parse(path[1]))
            .single(),
        );
        clientId = data.campaign!.client_id;
        loads.push(async () => {
          data.queries = checked(
            await db
              .from("campaign_queries")
              .select("*")
              .eq("campaign_id", data.campaign!.id)
              .eq("revision", data.campaign!.revision)
              .order("ordinal"),
          );
          data.runs = checked(
            await db
              .from("campaign_runs")
              .select("*")
              .eq("campaign_id", data.campaign!.id)
              .order("created_at", { ascending: false })
              .limit(50),
          );
        });
      }
    }
    if (path[0] === "runs") {
      data.run = checked(
        await db
          .from("campaign_runs")
          .select("*")
          .eq("id", uuid.parse(path[1]))
          .single(),
      );
      clientId = data.run!.client_id;
      const [jobs, queries, campaign] = await Promise.all([
        db
          .from("search_jobs")
          .select(
            "id,run_query_id,page_number,attempts,status,retry_at,failure_code,metrics",
          )
          .eq("run_id", data.run!.id)
          .order("page_number"),
        db
          .from("run_queries")
          .select("*")
          .eq("run_id", data.run!.id)
          .order("ordinal"),
        db
          .from("campaigns")
          .select("*")
          .eq("id", data.run!.campaign_id)
          .single(),
      ]);
      data.jobs = checked(jobs);
      data.runQueries = checked(queries);
      data.campaign = checked(campaign);
    }
    if (path[0] === "roles" && path[1]) {
      data.view = "role";
      const roleWithClient = checked(initialRole!) as Role & { clients: Client };
      data.role = roleWithClient;
      data.client = roleWithClient.clients;
      clientId = data.role!.client_id;
      loads.push(async () => {
        const workspaceCounts = loadRoleWorkspaceCounts(
          db,
          data.role!.id,
          data.role!.client_id,
        );
        const stageParam = filter.stage ?? "all_profiles";
        if (stageParam === "master_db") {
          const page = Math.max(
            1,
            Math.min(100000, Math.floor(Number(filter.page) || 1)),
          );
          data.page = page;
          let q = db.from("candidates").select("*", { count: "exact" });
          if (filter.q?.trim()) {
            const term = filter.q
              .trim()
              .slice(0, 200)
              .replace(/[\\%_,]/g, "\\$&");
            q = q.or(
              [
                `full_name.ilike.%${term}%`,
                `headline.ilike.%${term}%`,
                `current_company.ilike.%${term}%`,
                `email.ilike.%${term}%`,
              ].join(","),
            );
          }
          q = q.not("master_qualified_at", "is", null);
          const [result, roleCounts] = await Promise.all([
            q
              .order("created_at", { ascending: false })
              .order("id")
              .range((page - 1) * 50, page * 50 - 1),
            workspaceCounts,
          ]);
          data.masterCandidates = checked(result);
          data.total = result.count ?? 0;
          data.roleCandidateCounts = roleCounts.counts;
          data.roleDashboardCounts = [roleCounts.dashboard];
          const candidateIds = data.masterCandidates.map((candidate) => candidate.id);
          data.masterRoleCandidateIds = candidateIds.length
            ? checked(
                await db
                  .from("role_candidates")
                  .select("candidate_id")
                  .eq("role_id", data.role!.id)
                  .in("candidate_id", candidateIds),
              ).map((membership) => membership.candidate_id)
            : [];
        } else if (stageParam === "analytics") {
          const [funnel, durations, roleCounts, sourcePerformance] = await Promise.all([
            db
              .from("role_stage_funnel")
              .select("*")
              .eq("role_id", data.role!.id),
            db
              .from("role_stage_durations")
              .select("*")
              .eq("role_id", data.role!.id),
            workspaceCounts,
            db.rpc("role_source_performance", { p_role: data.role!.id }),
          ]);
          data.roleStageFunnel = checked(funnel);
          data.roleStageDurations = checked(durations);
          data.roleCandidateCounts = roleCounts.counts;
          data.roleDashboardCounts = [roleCounts.dashboard];
          data.roleSourcePerformance = checked(sourcePerformance);
        } else if (stageParam === "follow_ups") {
          const page = Math.max(
            1,
            Math.min(100000, Math.floor(Number(filter.page) || 1)),
          );
          data.page = page;
          const [rows, roleCounts] = await Promise.all([
            db
              .from("role_candidates")
              .select("*,candidates!inner(*,candidate_identities(kind,normalized_value))", { count: "exact" })
              .eq("role_id", data.role!.id)
              .not("follow_up_at", "is", null)
              .neq("stage", "rejected")
              .order("follow_up_at")
              .order("id")
              .range((page - 1) * 50, page * 50 - 1),
            workspaceCounts,
          ]);
          data.roleCandidates = checked(rows) as unknown as RoleCandidate[];
          data.total = rows.count ?? 0;
          data.roleCandidateCounts = roleCounts.counts;
          data.roleDashboardCounts = [roleCounts.dashboard];
        } else {
          const stage = isStage(stageParam) ? stageParam : "all_profiles";
          const page = Math.max(
            1,
            Math.min(100000, Math.floor(Number(filter.page) || 1)),
          );
          data.page = page;
          const candidateFilters = roleCandidateListFilters(filter);
          const candidateQuery = roleCandidateListQuery(
            db,
            data.role!.id,
            stage,
            data.role!.rating_threshold,
            candidateFilters,
            hasRoleCandidateListFilters(candidateFilters),
          );
          const shareLinksQuery =
            stage === "recruiter_shortlisted"
              ? db
                  .from("role_share_links")
                  .select(
                    "id,stage,token_prefix,visible_columns,allow_decisions,expires_at,revoked_at,created_at,last_viewed_at",
                  )
                  .eq("role_id", data.role!.id)
                  .eq("stage", stage)
                  .order("created_at", { ascending: false })
              : null;
          const [rows, roleCounts, fields, shareLinks] = await Promise.all([
            candidateQuery.range((page - 1) * 50, page * 50 - 1),
            workspaceCounts,
            db
              .from("role_fields")
              .select("*")
              .eq("role_id", data.role!.id)
              .eq("archived", false)
              .order("ordinal"),
            shareLinksQuery,
          ]);
          data.roleCandidates = checked(rows) as unknown as RoleCandidate[];
          data.total = rows.count ?? roleCounts.counts[stage] ?? 0;
          data.roleCandidateCounts = roleCounts.counts;
          data.roleDashboardCounts = [roleCounts.dashboard];
          data.roleFields = checked(fields);
          // token_hash is never selected; the app has no use for it and a
          // hash of a never-reused secret has no reason to leave the database.
          data.shareLinks = shareLinks ? checked(shareLinks) : [];
        }
      });
    }
    if (path[0] === "leads" && path[1]) {
      data.view = "lead";
      data.lead = checked(
        await db
          .from("lead_rows")
          .select("*")
          .eq("id", uuid.parse(path[1]))
          .single(),
      ) as Lead;
      clientId = data.lead.client_id;
      loads.push(async () => {
        data.discoveries = checked(
          await db
            .from("discoveries")
            .select("*,search_jobs(page_number,run_queries(text,strategy))")
            .eq("client_profile_id", data.lead!.client_profile_id)
            .eq("campaign_id", data.lead!.campaign_id)
            .order("observed_at", { ascending: false })
            .limit(100),
        ) as unknown as Discovery[];
        data.reviewEvents = checked(
          await db
            .from("review_events")
            .select("*")
            .eq("campaign_profile_id", data.lead!.id)
            .order("created_at", { ascending: false })
            .limit(100),
        );
      });
    }
    if (clientId) {
      uuid.parse(clientId);
      data.client ??= data.clients.find((c) => c.id === clientId);
      if (!data.client) notFound();
      if (
        ["client", "builder", "campaign", "runs", "leads", "lead"].includes(
          data.view,
        )
      ) {
        loads.push(async () => {
          data.campaigns = checked(
            await db
              .from("campaigns")
              .select("*")
              .eq("client_id", clientId)
              .order("created_at", { ascending: false }),
          );
        });
      }
    }
    if (
      [
        "leads",
        "settings",
        "client",
        "builder",
        "prospects",
        "excluded",
        "roles",
      ].includes(data.view) &&
      !clientId
    )
      redirect("/clients");
    if (data.view === "client") {
      loads.push(async () => {
        data.runs = checked(
          await db
            .from("campaign_runs")
            .select("*")
            .eq("client_id", clientId!)
            .order("created_at", { ascending: false })
            .limit(10),
        );
      });
    }
    if (["client", "leads", "campaign"].includes(data.view)) {
      loads.push(async () => {
        const scopeCampaign =
          data.campaign?.id ??
          (filter.campaign ? uuid.parse(filter.campaign) : undefined);
        const statuses = [
          "rule_match",
          "review",
          "accepted",
          "rejected",
          "suppressed",
        ];
        const countsPromise = db
          .rpc("lead_counts", {
            p_client: clientId,
            p_campaign: scopeCampaign ?? null,
          })
          .then((result) => result);
        const metricPromise = db
          .rpc("review_metrics", {
            p_client: clientId,
            p_campaign: scopeCampaign ?? null,
          })
          .then((result) => result);
        if (data.view === "leads") {
          const page = Math.max(1, Math.min(Number(filter.page) || 1, 100000));
          data.page = Math.floor(page);
          let q = db
            .from("lead_rows")
            .select("*", { count: "exact" })
            .eq("client_id", clientId!);
          if (scopeCampaign) q = q.eq("campaign_id", scopeCampaign);
          if (filter.status && statuses.includes(filter.status))
            q = q.eq("status", filter.status);
          if (filter.q)
            q = q.ilike(
              "search_text",
              `%${filter.q.slice(0, 200).replace(/[\\%_]/g, "\\$&")}%`,
            );
          const response = await q
            .order("updated_at", { ascending: false })
            .order("id")
            .range((data.page - 1) * 25, data.page * 25 - 1);
          data.leads = checked(response) as Lead[];
          data.total = response.count ?? 0;
        }
        const [countsResult, metricResult] = await Promise.all([
          countsPromise,
          metricPromise,
        ]);
        data.counts = checked(countsResult);
        const metric = checked(metricResult);
        data.reviewSeconds = metric.seconds;
        data.precision = metric.precision;
        data.dispatched = metric.dispatched;
      });
    }
    if (data.view === "roles") {
      loads.push(async () => {
        const [roles, dashboardCounts] = await Promise.all([
          db
            .from("roles")
            .select("*")
            .eq("client_id", clientId!)
            .order("created_at", { ascending: false }),
          db.rpc("role_dashboard_counts", { p_client: clientId! }),
        ]);
        data.roles = checked(roles);
        data.roleDashboardCounts = checked(dashboardCounts);
      });
    }
    if (data.view === "prospects") {
      loads.push(async () => {
        const filters = prospectFilters(
          new URLSearchParams(
            Object.entries(filter).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          ),
        );
        data.page = filters.page;
        const result = await prospectQuery(db, clientId!, filters).range(
          (filters.page - 1) * 50,
          filters.page * 50 - 1,
        );
        data.prospects = checked(result);
        data.total = result.count ?? 0;
      });
    }
    if (data.view === "excluded") {
      loads.push(async () => {
        data.page = Math.max(
          1,
          Math.min(100000, Math.floor(Number(filter.page) || 1)),
        );
        let query = db
          .from("suppressions")
          .select("id,canonical_url,reason,note,active,updated_at", {
            count: "exact",
          })
          .eq("client_id", clientId!)
          .eq("active", true);
        if (filter.q?.trim())
          query = query.ilike(
            "canonical_url",
            `%${filter.q
              .trim()
              .slice(0, 200)
              .replace(/[\\%_]/g, "\\$&")}%`,
          );
        const result = await query
          .order("updated_at", { ascending: false })
          .order("id")
          .range((data.page - 1) * 50, data.page * 50 - 1);
        data.suppressions = checked(result);
        data.total = result.count ?? 0;
      });
    }
    if (data.view === "settings") {
      data.checks = env.checks;
      data.suppressions = checked(
        await db
          .from("suppressions")
          .select("*")
          .eq("client_id", clientId!)
          .order("updated_at", { ascending: false }),
      );
    }
    if (data.view === "settings")
      data.suppressionEvents = checked(
        await db
          .from("suppression_events")
          .select("*")
          .eq("client_id", clientId!)
          .order("created_at", { ascending: false })
          .limit(100),
      );
    if (
      ![
        "prospects",
        "excluded",
        "clients",
        "client",
        "builder",
        "campaign",
        "runs",
        "leads",
        "lead",
        "settings",
        "roles",
        "role",
      ].includes(data.view)
    )
      notFound();
    await Promise.all(loads.map((load) => load()));
  } catch (error) {
    if (error instanceof AppError)
      return (
        <AccessPage
          title="Could not load this workspace"
          message={error.message}
        />
      );
    throw error;
  }
  const routeKey = `${path.join("/")}:${filter.page ?? ""}:${filter.status ?? ""}:${filter.campaign ?? ""}:${filter.q ?? ""}:${filter.contact ?? ""}:${filter.stage ?? ""}`;
  const roleRouteKey = `${path.join("/")}:${filter.page ?? ""}:${filter.q ?? ""}:${filter.source ?? ""}:${filter.source_detail ?? ""}:${filter.rating ?? ""}:${filter.entered_from ?? ""}:${filter.entered_to ?? ""}:${filter.sort ?? ""}`;
  if (data.view === "clients") return <ClientsWorkspace key={routeKey} data={data} />;
  if (data.view === "role") return <RoleWorkspace key={roleRouteKey} data={data} />;
  if (data.view === "roles") return <RolesWorkspace key={routeKey} data={data} />;
  return (
    <Workspace
      key={routeKey}
      data={data}
    />
  );
}
