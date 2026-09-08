import { redirect, notFound } from "next/navigation";
import { admin, AppError, checked } from "@/lib/server/db";
import { setup } from "@/lib/server/config";
import { SetupPage, AccessPage } from "@/components/setup";
import { Workspace } from "@/components/workspace";
import { uuid } from "@/lib/domain";
import type { PageData, Discovery, Lead } from "@/lib/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
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
  const filter = await searchParams;
  if (!path.length) redirect("/clients");
  const data: PageData = {
    view: path[0],
    clients: checked(await db.from("clients").select("*").order("name")),
    campaigns: [],
    live: env.live,
    serverCap: env.serverCap,
    activeRuns: checked(
      await db
        .from("campaign_runs")
        .select(
          "id,client_id,campaign_id,status,reserved,budget,new_candidates",
        )
        .in("status", ["running", "paused"])
        .order("created_at")
        .limit(100),
    ),
    email: user.email ?? "Agency operator",
  };
  try {
    let clientId = filter.client;
    if (path[0] === "clients" && path[1]) {
      clientId = uuid.parse(path[1]);
      data.view = "client";
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
      data.discoveries = checked(
        await db
          .from("discoveries")
          .select("*,search_jobs(page_number,run_queries(text,strategy))")
          .eq("client_profile_id", data.lead.client_profile_id)
          .eq("campaign_id", data.lead.campaign_id)
          .order("observed_at", { ascending: false })
          .limit(100),
      ) as unknown as Discovery[];
      data.reviewEvents = checked(
        await db
          .from("review_events")
          .select("*")
          .eq("campaign_profile_id", data.lead.id)
          .order("created_at", { ascending: false })
          .limit(100),
      );
    }
    if (clientId) {
      uuid.parse(clientId);
      data.client = data.clients.find((c) => c.id === clientId);
      if (!data.client) notFound();
      data.campaigns = checked(
        await db
          .from("campaigns")
          .select("*")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
      );
    }
    if (
      ["leads", "settings", "client", "builder"].includes(data.view) &&
      !clientId
    )
      redirect("/clients");
    if (data.view === "client") {
      data.runs = checked(
        await db
          .from("campaign_runs")
          .select("*")
          .eq("client_id", clientId!)
          .order("created_at", { ascending: false })
          .limit(10),
      );
    }
    if (["client", "leads", "campaign"].includes(data.view)) {
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
      const values = await Promise.all(
        statuses.map(async (status) => {
          let q = db
            .from("lead_rows")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId!)
            .eq("status", status);
          if (scopeCampaign) q = q.eq("campaign_id", scopeCampaign);
          const r = await q;
          checked(r);
          return r.count ?? 0;
        }),
      );
      data.counts = Object.fromEntries(statuses.map((s, i) => [s, values[i]]));
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
      const metric = checked(
        await db.rpc("review_metrics", {
          p_client: clientId,
          p_campaign: scopeCampaign ?? null,
        }),
      );
      data.reviewSeconds = metric.seconds;
      data.precision = metric.precision;
      data.dispatched = metric.dispatched;
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
        "clients",
        "client",
        "builder",
        "campaign",
        "runs",
        "leads",
        "lead",
        "settings",
      ].includes(data.view)
    )
      notFound();
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
  return (
    <Workspace
      key={`${path.join("/")}:${filter.page ?? ""}:${filter.status ?? ""}:${filter.campaign ?? ""}:${filter.q ?? ""}`}
      data={data}
    />
  );
}
