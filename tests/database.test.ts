import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { defaults, type CampaignConfig } from "../src/lib/domain";
import { generateQueries, signature } from "../src/lib/queries";
import { qualify } from "../src/lib/qualification";

let embedded: EmbeddedPostgres | undefined;
let db: PgClient;
let connectionString: string;
const actor = randomUUID(),
  outsider = randomUUID();
const config: CampaignConfig = {
  ...defaults,
  locations: ["Chennai"],
  roles: ["SDR"],
  skills: ["Prospecting"],
  cooldownDays: 30,
};
async function sql(text: string, values: unknown[] = []) {
  return db.query(text, values);
}
async function asUser<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await sql("begin");
  await sql("set local role authenticated");
  await sql("select set_config('request.jwt.claim.sub',$1,true)", [user]);
  try {
    const result = await fn();
    await sql("commit");
    return result;
  } catch (e) {
    await sql("rollback");
    throw e;
  }
}
async function rpc(name: string, values: unknown[] = []) {
  const r = await sql(
    `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as result`,
    values,
  );
  return r.rows[0].result;
}
async function client() {
  return asUser(actor, () =>
    rpc("save_client", [null, "Database test client", ""]),
  );
}
async function campaign(cid: string, c = config) {
  const queries = generateQueries(c).queries.map((q) => ({
    ...q,
    signature: signature(q.text, c.country, c.language),
  }));
  return asUser(actor, () =>
    rpc("save_campaign", [
      null,
      cid,
      "Database test campaign",
      JSON.stringify(c),
      JSON.stringify(queries),
      false,
      null,
    ]),
  );
}
async function start(
  campaignId: string,
  token = randomUUID(),
  force: string[] = [],
) {
  return rpc("prepare_run", [actor, campaignId, token, force, 50, true, 1]);
}
async function claim(runId: string) {
  return rpc("claim_job", [actor, runId]);
}
function item(slug: string, snippet = "Location: Chennai. Prospecting.") {
  return {
    canonicalUrl: `https://www.linkedin.com/in/${slug}`,
    title: "Test Person - SDR at Test",
    snippet,
    originalUrl: `https://in.linkedin.com/in/${slug}?trk=x`,
    position: 1,
    assessment: qualify(
      "Test Person - SDR at Test",
      snippet,
      config,
      "2026-09-08T00:00:00.000Z",
    ),
  };
}
async function ingest(
  c: Awaited<ReturnType<typeof claim>>,
  rows = [item("test-person")],
  occurrences = rows.length,
) {
  await rpc("mark_dispatch", [actor, c.job.id, c.job.token]);
  await rpc("save_response", [
    actor,
    c.job.id,
    c.job.token,
    JSON.stringify({ organic: [] }),
  ]);
  return rpc("commit_job", [
    actor,
    c.job.id,
    c.job.token,
    JSON.stringify(rows),
    rows
      .map((x) => x.canonicalUrl)
      .sort()
      .join("|"),
    occurrences,
  ]);
}

beforeAll(async () => {
  // Isolated real PostgreSQL; auth.uid() and roles mirror Supabase's JWT interface.
  // The production migration is applied unchanged. No provider adapter is invoked.
  const provided = process.env.TEST_DATABASE_URL;
  if (provided) {
    const url = new URL(provided);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw new Error("Database tests require a disposable LOCAL database.");
    connectionString = provided;
    db = new PgClient({ connectionString });
    await db.connect();
    const existing = await sql(
      "select to_regclass('public.clients') as existing",
    );
    if (existing.rows[0].existing)
      throw new Error(
        "Refusing to run on a database that already contains LeadScope tables. Use an empty dedicated test database.",
      );
  } else {
    const root = resolve(".local-db");
    await mkdir(root, { recursive: true });
    const path = resolve(root, `test-${randomUUID()}`);
    if (!path.startsWith(root + sep)) throw new Error("Unsafe database path");
    embedded = new EmbeddedPostgres({
      databaseDir: path,
      port: 55439,
      user: "postgres",
      password: "local-test-only",
      persistent: false,
      initdbFlags: ["--locale=C", "--encoding=UTF8"],
      onLog: () => {},
      onError: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    connectionString =
      "postgresql://postgres:local-test-only@127.0.0.1:55439/postgres";
    db = new PgClient({ connectionString });
    await db.connect();
  }
  await sql(`do $$ begin
    if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create schema if not exists auth;
    create table if not exists auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const files = (await readdir(resolve("supabase/migrations")))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files)
    await sql(await readFile(resolve("supabase/migrations", file), "utf8"));
  await sql(
    "insert into auth.users(id,raw_user_meta_data) values($1,'{}'),($2,'{\"is_agency_admin\":true}')",
    [actor, outsider],
  );
  await sql(
    "update public.user_profiles set is_agency_admin=true where id=$1",
    [actor],
  );
}, 60000);
afterAll(async () => {
  if (db) await db.end();
  if (embedded) await embedded.stop();
}, 30000);

describe("actual migration, RLS and transactional RPCs", () => {
  it("enables RLS on every public table and keeps privileged implementations private", async () => {
    expect(
      (
        await sql(
          "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and not relrowsecurity",
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await sql(
          "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and prosecdef",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("denies non-admin reads, writes and metadata-based promotion", async () => {
    await client();
    expect(
      (await asUser(outsider, () => sql("select * from public.clients"))).rows,
    ).toHaveLength(0);
    const profile = await asUser(outsider, () =>
      sql("select * from public.user_profiles"),
    );
    expect(profile.rows[0].is_agency_admin).toBe(false);
    await expect(
      asUser(outsider, () =>
        sql(
          "update public.user_profiles set is_agency_admin=true where id=$1",
          [outsider],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(outsider, () => rpc("save_client", [null, "Forbidden", ""])),
    ).rejects.toThrow("Agency access");
    await sql("begin");
    await sql("set local role anon");
    await expect(sql("select * from public.clients")).rejects.toThrow();
    await sql("rollback");
  });
  it("denies direct admin writes and provider RPC access via session role", async () => {
    await expect(
      asUser(actor, () =>
        sql("insert into public.clients(name) values('bypass')"),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(actor, () => rpc("claim_job", [actor, randomUUID()])),
    ).rejects.toThrow();
    await expect(rpc("claim_job", [outsider, randomUUID()])).rejects.toThrow(
      "Agency access",
    );
  });
  it("enforces cross-client campaign and profile relationships even with privileged writes", async () => {
    const a = await client(),
      b = await client(),
      camp = await campaign(a);
    const profile = (
      await sql(
        "insert into public.client_profiles(client_id,canonical_url) values($1,'https://www.linkedin.com/in/foreign') returning id",
        [b],
      )
    ).rows[0].id;
    await expect(
      sql(
        "insert into public.campaign_profiles(client_id,campaign_id,client_profile_id,criteria_version,assessment,automatic_status,rule_version) values($1,$2,$3,1,'{}','review','test')",
        [a, camp, profile],
      ),
    ).rejects.toThrow();
  });
  it("makes duplicate Start submissions idempotent", async () => {
    const camp = await campaign(await client());
    const token = randomUUID();
    const a = await start(camp, token);
    const b = await start(camp, token);
    expect(a.runId).toBe(b.runId);
    expect(
      (
        await sql("select reserved from public.campaign_runs where id=$1", [
          a.runId,
        ])
      ).rows[0].reserved,
    ).toBe(0);
  });
  it("creates only one run for simultaneous duplicate Start requests", async () => {
    const camp = await campaign(await client()),
      token = randomUUID();
    const second = new PgClient({ connectionString });
    await second.connect();
    try {
      const [a, b] = await Promise.all([
        start(camp, token),
        second
          .query(
            "select public.prepare_run($1,$2,$3,'{}',50,true,1) as result",
            [actor, camp, token],
          )
          .then((r) => r.rows[0].result),
      ]);
      expect(a.runId).toBe(b.runId);
      expect(
        (
          await sql(
            "select * from public.campaign_runs where request_token=$1",
            [token],
          )
        ).rowCount,
      ).toBe(1);
    } finally {
      await second.end();
    }
  });
  it("honors the confirmed cap and rejects a changed campaign revision", async () => {
    const camp = await campaign(await client());
    const r = await rpc("prepare_run", [
      actor,
      camp,
      randomUUID(),
      [],
      2,
      true,
      1,
    ]);
    expect(r.cap).toBe(2);
    await expect(
      rpc("prepare_run", [actor, camp, randomUUID(), [], 2, true, 99]),
    ).rejects.toThrow("Campaign changed");
  });
  it("serializes simultaneous claims and never over-reserves the budget", async () => {
    const camp = await campaign(await client(), { ...config, budget: 1 });
    const r = await start(camp);
    const second = new PgClient({ connectionString });
    await second.connect();
    try {
      const [a, b] = await Promise.all([
        claim(r.runId),
        second
          .query("select public.claim_job($1,$2) as result", [actor, r.runId])
          .then((r) => r.rows[0].result),
      ]);
      expect([a.state, b.state].sort()).toEqual(["dispatch", "waiting"]);
      expect(
        (
          await sql("select reserved from public.campaign_runs where id=$1", [
            r.runId,
          ])
        ).rows[0].reserved,
      ).toBe(1);
    } finally {
      await second.end();
    }
  });
  it("recovers expired tokens without refund and rejects stale commits", async () => {
    const r = await start(await campaign(await client()));
    const a = await claim(r.runId);
    await sql(
      "update public.search_jobs set lease_until=now()-interval '1 second' where id=$1",
      [a.job.id],
    );
    const b = await claim(r.runId);
    expect(b.job.token).not.toBe(a.job.token);
    expect(b.job.attempts).toBe(2);
    expect(
      await rpc("save_response", [actor, a.job.id, a.job.token, "{}"]),
    ).toBe(false);
    await expect(
      rpc("commit_job", [actor, a.job.id, a.job.token, "[]", "none", 0]),
    ).rejects.toThrow("lease expired");
    expect(
      (
        await sql("select reserved from public.campaign_runs where id=$1", [
          r.runId,
        ])
      ).rows[0].reserved,
    ).toBe(2);
  });
  it("keeps future retries unfinished", async () => {
    const r = await start(
      await campaign(await client(), { ...config, skills: [], queryCap: 2 }),
    );
    const c = await claim(r.runId);
    await rpc("fail_job", [
      actor,
      c.job.id,
      c.job.token,
      "serper_429",
      true,
      false,
    ]);
    const next = await claim(r.runId);
    expect(next.state).toBe("waiting");
    expect(next.nextRetryAt).toBeTruthy();
    expect(
      (
        await sql("select status from public.campaign_runs where id=$1", [
          r.runId,
        ])
      ).rows[0].status,
    ).toBe("running");
  });
  it("recovers saved raw response without another reservation and commits exactly once", async () => {
    const r = await start(await campaign(await client()));
    const a = await claim(r.runId);
    await rpc("mark_dispatch", [actor, a.job.id, a.job.token]);
    await rpc("save_response", [
      actor,
      a.job.id,
      a.job.token,
      '{"organic":[]}',
    ]);
    await sql(
      "update public.search_jobs set lease_until=now()-interval '1 second' where id=$1",
      [a.job.id],
    );
    const b = await claim(r.runId);
    expect(b.state).toBe("recover");
    const rows = [item("recover-person")];
    const first = await rpc("commit_job", [
      actor,
      b.job.id,
      b.job.token,
      JSON.stringify(rows),
      "fp",
      2,
    ]);
    const again = await rpc("commit_job", [
      actor,
      b.job.id,
      b.job.token,
      JSON.stringify(rows),
      "fp",
      2,
    ]);
    expect(again).toEqual(first);
    expect(first.duplicates).toBe(1);
    const saved = (
      await sql("select * from public.campaign_runs where id=$1", [r.runId])
    ).rows[0];
    expect(saved.reserved).toBe(1);
    expect(saved.rule_matches).toBe(1);
    expect(saved.new_candidates).toBe(1);
    expect(
      (await sql("select * from public.discoveries where run_id=$1", [r.runId]))
        .rowCount,
    ).toBe(1);
  });
  it("preserves manual decisions and separates campaign fit and client identities", async () => {
    const cid = await client(),
      campA = await campaign(cid),
      campB = await campaign(cid);
    const r1 = await start(campA);
    await ingest(await claim(r1.runId), [item("shared-person")]);
    const cp = (
      await sql(
        "select id from public.campaign_profiles where campaign_id=$1",
        [campA],
      )
    ).rows[0].id;
    await asUser(actor, () =>
      rpc("review_leads", [cid, [cp], "accepted", "Verified manually"]),
    );
    const queries = (
      await sql("select id from public.campaign_queries where campaign_id=$1", [
        campA,
      ])
    ).rows.map((r) => r.id);
    const r2 = await start(campA, randomUUID(), queries);
    await ingest(await claim(r2.runId), [
      item("shared-person", "Location: Pune."),
    ]);
    expect(
      (
        await sql(
          "select manual_decision from public.campaign_profiles where id=$1",
          [cp],
        )
      ).rows[0].manual_decision,
    ).toBe("accepted");
    const qsB = (
      await sql("select id from public.campaign_queries where campaign_id=$1", [
        campB,
      ])
    ).rows.map((r) => r.id);
    const rb = await start(campB, randomUUID(), qsB);
    await ingest(await claim(rb.runId), [
      item("shared-person", "Location: Pune."),
    ]);
    const pb = (
      await sql("select * from public.campaign_profiles where campaign_id=$1", [
        campB,
      ])
    ).rows[0];
    expect(pb.manual_decision).toBeNull();
    expect(pb.automatic_status).toBe("rejected");
    expect(
      (
        await sql("select * from public.client_profiles where client_id=$1", [
          cid,
        ])
      ).rowCount,
    ).toBe(1);
    const other = await client(),
      otherRun = await start(await campaign(other));
    await ingest(await claim(otherRun.runId), [item("shared-person")]);
    expect(
      (
        await sql(
          "select * from public.client_profiles where canonical_url='https://www.linkedin.com/in/shared-person'",
        )
      ).rowCount,
    ).toBe(2);
  });
  it("suppression blocks acceptance and export; removal returns candidates to Review", async () => {
    const cid = await client(),
      camp = await campaign(cid),
      r = await start(camp);
    await ingest(await claim(r.runId), [item("suppress-person")]);
    const cp = (
      await sql(
        "select id from public.campaign_profiles where campaign_id=$1",
        [camp],
      )
    ).rows[0].id;
    await asUser(actor, () => rpc("review_leads", [cid, [cp], "accepted", ""]));
    expect(
      await asUser(actor, () => rpc("export_accepted", [cid, camp])),
    ).toHaveLength(1);
    await asUser(actor, () =>
      rpc("set_suppression", [
        cid,
        "https://www.linkedin.com/in/suppress-person",
        "Do not contact",
        "",
        true,
      ]),
    );
    expect(
      await asUser(actor, () => rpc("export_accepted", [cid, camp])),
    ).toHaveLength(0);
    await expect(
      asUser(actor, () => rpc("review_leads", [cid, [cp], "accepted", ""])),
    ).rejects.toThrow("Suppressed or stale");
    await asUser(actor, () =>
      rpc("set_suppression", [
        cid,
        "https://www.linkedin.com/in/suppress-person",
        "Removed",
        "",
        false,
      ]),
    );
    expect(
      (
        await asUser(actor, () =>
          sql("select status from public.lead_rows where id=$1", [cp]),
        )
      ).rows[0].status,
    ).toBe("review");
  });
  it("records cooldown coverage and prevents work after cancellation", async () => {
    const camp = await campaign(await client()),
      r = await start(camp);
    const c = await claim(r.runId);
    await ingest(c, []);
    const preflight = await rpc("prepare_run", [
      actor,
      camp,
      randomUUID(),
      [],
      50,
      false,
      null,
    ]);
    expect(
      preflight.queries.find((q: { id: string }) => q.id === c.query.query_id)
        .priorPages,
    ).toEqual([1]);
    await asUser(actor, () => rpc("control_run", [r.runId, "cancel"]));
    expect((await claim(r.runId)).state).toBe("cancelled");
  });
  it("caps retry attempts at three and marks credential failure as terminal", async () => {
    const r = await start(
      await campaign(await client(), { ...config, skills: [], pageCap: 3 }),
    );
    for (let i = 0; i < 3; i++) {
      const c = await claim(r.runId);
      expect(c.job.attempts).toBe(i + 1);
      await rpc("mark_dispatch", [actor, c.job.id, c.job.token]);
      await rpc("fail_job", [
        actor,
        c.job.id,
        c.job.token,
        "serper_429",
        true,
        false,
      ]);
      await sql(
        "update public.search_jobs set retry_at=now()-interval '1 second' where id=$1",
        [c.job.id],
      );
    }
    expect((await claim(r.runId)).state).toBe("completed");
    const counts = (
      await sql(
        "select reserved,dispatched,errors from public.campaign_runs where id=$1",
        [r.runId],
      )
    ).rows[0];
    expect(counts).toEqual({ reserved: 3, dispatched: 3, errors: 3 });
    const bad = await start(await campaign(await client()));
    const c = await claim(bad.runId);
    await rpc("fail_job", [
      actor,
      c.job.id,
      c.job.token,
      "serper_401",
      false,
      true,
    ]);
    expect((await claim(bad.runId)).state).toBe("failed");
  });
  it("never dispatches a reserved but not yet started job after cancellation", async () => {
    const r = await start(await campaign(await client())),
      c = await claim(r.runId);
    await asUser(actor, () => rpc("control_run", [r.runId, "cancel"]));
    expect(await rpc("mark_dispatch", [actor, c.job.id, c.job.token])).toBe(
      false,
    );
    const counts = (
      await sql(
        "select reserved,dispatched from public.campaign_runs where id=$1",
        [r.runId],
      )
    ).rows[0];
    expect(counts).toEqual({ reserved: 1, dispatched: 0 });
  });
  it("commits an in-flight result after cancellation without scheduling deeper pages", async () => {
    const r = await start(await campaign(await client())),
      c = await claim(r.runId);
    await rpc("mark_dispatch", [actor, c.job.id, c.job.token]);
    await asUser(actor, () => rpc("control_run", [r.runId, "cancel"]));
    await rpc("save_response", [
      actor,
      c.job.id,
      c.job.token,
      '{"organic":[]}',
    ]);
    await rpc("commit_job", [
      actor,
      c.job.id,
      c.job.token,
      JSON.stringify([item("inflight")]),
      "inflight",
      1,
    ]);
    expect(
      (
        await sql(
          "select * from public.search_jobs where run_id=$1 and page_number>1",
          [r.runId],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await sql(
          "select status,new_candidates from public.campaign_runs where id=$1",
          [r.runId],
        )
      ).rows[0],
    ).toEqual({ status: "cancelled", new_candidates: 1 });
  });
  it("suppressed ingestion cannot count toward the target", async () => {
    const cid = await client(),
      camp = await campaign(cid),
      r = await start(camp);
    await asUser(actor, () =>
      rpc("set_suppression", [
        cid,
        "https://www.linkedin.com/in/hidden",
        "Exclusion",
        "",
        true,
      ]),
    );
    const metrics = await ingest(await claim(r.runId), [item("hidden")]);
    expect(metrics.ruleMatches).toBe(0);
    expect(metrics.suppressed).toBe(1);
    expect(
      (
        await asUser(actor, () =>
          sql("select status from public.lead_rows where campaign_id=$1", [
            camp,
          ]),
        )
      ).rows[0].status,
    ).toBe("suppressed");
  });
  it("requires explicit criteria reset and excludes stale decisions from export", async () => {
    const cid = await client(),
      camp = await campaign(cid),
      r = await start(camp);
    await ingest(await claim(r.runId), [item("criteria-change")]);
    await asUser(actor, () => rpc("control_run", [r.runId, "cancel"]));
    const cp = (
      await sql(
        "select id from public.campaign_profiles where campaign_id=$1",
        [camp],
      )
    ).rows[0].id;
    await asUser(actor, () => rpc("review_leads", [cid, [cp], "accepted", ""]));
    const nextConfig = { ...config, locations: ["Pune"] };
    const qs = generateQueries(nextConfig).queries.map((q) => ({
      ...q,
      signature: signature(q.text, "in", "en"),
    }));
    await expect(
      asUser(actor, () =>
        rpc("save_campaign", [
          camp,
          cid,
          "Updated",
          JSON.stringify(nextConfig),
          JSON.stringify(qs),
          false,
          1,
        ]),
      ),
    ).rejects.toThrow("Confirm reset");
    await asUser(actor, () =>
      rpc("save_campaign", [
        camp,
        cid,
        "Updated",
        JSON.stringify(nextConfig),
        JSON.stringify(qs),
        true,
        1,
      ]),
    );
    expect(
      await asUser(actor, () => rpc("export_accepted", [cid, camp])),
    ).toHaveLength(0);
    await expect(
      asUser(actor, () => rpc("review_leads", [cid, [cp], "accepted", ""])),
    ).rejects.toThrow("stale");
    const assessment = qualify(
      "Test Person - SDR",
      "Location: Chennai. Prospecting.",
      nextConfig,
    );
    await rpc("requalify_lead", [
      actor,
      cp,
      2,
      JSON.stringify(assessment),
      null,
    ]);
    expect(
      (
        await sql(
          "select criteria_version,automatic_status,manual_decision from public.campaign_profiles where id=$1",
          [cp],
        )
      ).rows[0],
    ).toEqual({
      criteria_version: 2,
      automatic_status: "rejected",
      manual_decision: "review",
    });
  });
  it("rolls back partial ingestion on invalid profile URLs", async () => {
    const r = await start(await campaign(await client())),
      c = await claim(r.runId);
    await expect(
      ingest(c, [
        item("valid-atomic"),
        { ...item("bad"), canonicalUrl: "invalid" },
      ]),
    ).rejects.toThrow();
    expect(
      (await sql("select * from public.discoveries where run_id=$1", [r.runId]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await sql("select status from public.search_jobs where id=$1", [
          c.job.id,
        ])
      ).rows[0].status,
    ).toBe("response_saved");
  });
});
