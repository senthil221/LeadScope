import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { defaults, type CampaignConfig } from "../src/lib/domain";
import { generateQueries, signature } from "../src/lib/queries";
import { qualify } from "../src/lib/qualification";
import { normalizeIdentity } from "../src/lib/recruiting/identity";

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
    const port = Number(process.env.TEST_DATABASE_PORT ?? 55439);
    const root = resolve(".local-db");
    await mkdir(root, { recursive: true });
    const path = resolve(root, `test-${randomUUID()}`);
    if (!path.startsWith(root + sep)) throw new Error("Unsafe database path");
    embedded = new EmbeddedPostgres({
      databaseDir: path,
      port,
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
      `postgresql://postgres:local-test-only@127.0.0.1:${port}/postgres`;
    db = new PgClient({ connectionString });
    await db.connect();
  }
  await sql(`do $$ begin
    if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create schema if not exists auth;
    create table if not exists auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}',
      email text, email_confirmed_at timestamptz, last_sign_in_at timestamptz,
      created_at timestamptz not null default now());
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const files = (await readdir(resolve("supabase/migrations")))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const source = await readFile(resolve("supabase/migrations", file), "utf8");
    try { await sql(source); }
    catch (error) {
      const issue = error as { message: string; position?: string; internalPosition?: string; internalQuery?: string };
      const position = Number(issue.position ?? 0);
      throw new Error(`${file}: ${issue.message}; position ${position}; context ${source.slice(Math.max(0, position - 180), position + 180)}; internal ${issue.internalPosition ?? ""} ${issue.internalQuery ?? ""}`, { cause: error });
    }
  }
  await sql(
    "insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,'{}',$3,now()),($2,'{\"is_agency_admin\":true}',$4,now())",
    [actor, outsider, "actor@example.com", "outsider@example.com"],
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
  it("saves a draft with every audience field and query omitted", async () => {
    const cid = await client();
    const id = await asUser(actor, () =>
      rpc("save_campaign", [
        null,
        cid,
        "Draft",
        JSON.stringify(defaults),
        "[]",
        false,
        null,
      ]),
    );
    expect(
      (await sql("select config from public.campaigns where id=$1", [id]))
        .rows[0].config.roles,
    ).toEqual([]);
    await expect(start(id)).rejects.toThrow("No eligible queries");
    const skillsOnly = await campaign(cid, {
      ...defaults,
      skills: ["cold email"],
    });
    expect((await start(skillsOnly)).runId).toBeTruthy();
  });
  it("runs two campaigns for one client concurrently with independent budgets and cancellation", async () => {
    const cid = await client();
    const first = await campaign(cid, { ...config, budget: 1 });
    const second = await campaign(cid, { ...config, budget: 2 });
    const a = await start(first),
      b = await start(second);
    const connection = new PgClient({ connectionString });
    await connection.connect();
    try {
      const [ca, cb] = await Promise.all([
        claim(a.runId),
        connection
          .query("select public.claim_job($1,$2) as result", [actor, b.runId])
          .then((r) => r.rows[0].result),
      ]);
      expect(ca.state).toBe("dispatch");
      expect(cb.state).toBe("dispatch");
      await asUser(actor, () => rpc("control_run", [a.runId, "cancel"]));
      await ingest(cb, [item("concurrent-campaign")]);
      const rows = (
        await sql(
          "select id,status,reserved,budget from public.campaign_runs where id=any($1::uuid[])",
          [[a.runId, b.runId]],
        )
      ).rows;
      expect(rows.find((r) => r.id === a.runId)).toMatchObject({
        status: "cancelled",
        reserved: 1,
        budget: 1,
      });
      expect(rows.find((r) => r.id === b.runId)).toMatchObject({
        reserved: 1,
        budget: 2,
      });
      expect(
        (
          await sql(
            "select count(*)::int as n from public.campaign_profiles where campaign_id=$1",
            [second],
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await connection.end();
    }
  });
  it("deduplicates accepted sheet memberships and isolates contact tracking by client", async () => {
    const cid = await client(),
      other = await client();
    const a = await campaign(cid),
      b = await campaign(cid),
      c = await campaign(other);
    for (const id of [a, b, c]) {
      const run = await start(id);
      await ingest(await claim(run.runId), [item("sheet-person")]);
    }
    const ids = (
      await sql("select id from public.campaign_profiles where client_id=$1", [
        cid,
      ])
    ).rows.map((r) => r.id);
    await asUser(actor, () => rpc("review_leads", [cid, ids, "accepted", ""]));
    const sheet = await asUser(actor, () =>
      sql("select * from public.accepted_prospect_rows where client_id=$1", [
        cid,
      ]),
    );
    expect(sheet.rows).toHaveLength(1);
    const profile = sheet.rows[0].id;
    expect(sheet.rows[0].source_query).toContain("site:linkedin.com/in/");
    await asUser(actor, () =>
      rpc("save_contact_status", [cid, profile, "contacted"]),
    );
    await asUser(actor, () =>
      rpc("save_profile_note", [cid, profile, "Follow up 100%_exact"]),
    );
    const exported = await asUser(actor, () =>
      rpc("export_prospects", [cid, "contacted", "100%_exact"]),
    );
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      contact_status: "contacted",
      notes: "Follow up 100%_exact",
    });
    expect(
      await asUser(actor, () => rpc("export_prospects", [cid, "replied", ""])),
    ).toEqual([]);
    expect(
      (
        await sql(
          "select contact_status,notes from public.client_profiles where client_id=$1",
          [other],
        )
      ).rows[0],
    ).toMatchObject({ contact_status: "not_contacted", notes: "" });
    await expect(
      asUser(actor, () =>
        rpc("save_contact_status", [other, profile, "replied"]),
      ),
    ).rejects.toThrow("Profile not found");
    await expect(
      asUser(actor, () =>
        rpc("save_contact_status", [cid, profile, "invalid"]),
      ),
    ).rejects.toThrow("valid contact status");
    await expect(
      asUser(outsider, () =>
        rpc("save_contact_status", [cid, profile, "replied"]),
      ),
    ).rejects.toThrow("Agency access");
    expect(
      (
        await asUser(outsider, () =>
          sql("select * from public.accepted_prospect_rows"),
        )
      ).rows,
    ).toHaveLength(0);
    await asUser(actor, () => rpc("review_leads", [cid, ids, "review", ""]));
    expect(
      await asUser(actor, () => rpc("export_prospects", [cid, "", ""])),
    ).toEqual([]);
    await asUser(actor, () => rpc("review_leads", [cid, ids, "accepted", ""]));
    await asUser(actor, () =>
      rpc("set_suppression", [
        cid,
        "https://www.linkedin.com/in/sheet-person",
        "Requested",
        "",
        true,
      ]),
    );
    expect(
      await asUser(actor, () => rpc("export_prospects", [cid, "", ""])),
    ).toEqual([]);
  });
  it("filters and exports the full accepted sheet beyond the first page", async () => {
    const cid = await client(),
      camp = await campaign(cid);
    await sql(
      `with profiles as (
      insert into public.client_profiles(client_id,canonical_url,contact_status)
      select $1,'https://www.linkedin.com/in/sheet-page-'||n,case when n=61 then 'replied' else 'not_contacted' end
      from generate_series(1,61) n returning id,client_id
    ) insert into public.campaign_profiles(client_id,campaign_id,client_profile_id,criteria_version,assessment,automatic_status,manual_decision,rule_version)
      select client_id,$2,id,1,'{"title":"Pagination test","snippet":"Evidence"}'::jsonb,'review','accepted','test' from profiles`,
      [cid, camp],
    );
    const result = await asUser(actor, () =>
      sql(
        "select id from public.accepted_prospect_rows where client_id=$1 order by date_added desc,id offset 50 limit 50",
        [cid],
      ),
    );
    expect(result.rows).toHaveLength(11);
    expect(
      await asUser(actor, () => rpc("export_prospects", [cid, "", ""])),
    ).toHaveLength(61);
    expect(
      await asUser(actor, () => rpc("export_prospects", [cid, "replied", ""])),
    ).toHaveLength(1);
    expect(
      await asUser(actor, () => rpc("lead_counts", [cid, null])),
    ).toMatchObject({ accepted: 61 });
    await sql("begin");
    await sql("set local role anon");
    await expect(
      sql("select * from public.accepted_prospect_rows"),
    ).rejects.toThrow();
    await sql("rollback");
  });
  it("bulk excludes old profiles from current sheets, exports and future campaigns idempotently", async () => {
    const cid = await client(),
      other = await client();
    const camp = await campaign(cid),
      outside = await campaign(other);
    const url = "https://www.linkedin.com/in/previous-prospect";
    for (const id of [camp, outside]) {
      const run = await start(id);
      await ingest(await claim(run.runId), [item("previous-prospect")]);
    }
    for (const id of [cid, other]) {
      const ids = (
        await sql(
          "select id from public.campaign_profiles where client_id=$1",
          [id],
        )
      ).rows.map((r) => r.id);
      await asUser(actor, () =>
        rpc("review_leads", [id, ids, "accepted", "Keep decision history"]),
      );
    }
    expect(
      await asUser(actor, () => rpc("exclude_profiles", [cid, [url, url]])),
    ).toEqual({ added: 1, alreadyExcluded: 0 });
    expect(
      await asUser(actor, () => rpc("exclude_profiles", [cid, [url]])),
    ).toEqual({ added: 0, alreadyExcluded: 1 });
    expect(
      (
        await sql(
          "select count(*)::int as n from public.suppression_events where client_id=$1",
          [cid],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      await asUser(actor, () => rpc("export_prospects", [cid, "", ""])),
    ).toEqual([]);
    expect(
      await asUser(actor, () => rpc("export_accepted", [cid, null])),
    ).toEqual([]);
    expect(
      await asUser(actor, () => rpc("export_prospects", [other, "", ""])),
    ).toHaveLength(1);
    expect(
      (
        await sql(
          "select manual_decision from public.campaign_profiles where client_id=$1",
          [cid],
        )
      ).rows[0].manual_decision,
    ).toBe("accepted");
    const future = await campaign(cid);
    const run = await start(future);
    await ingest(await claim(run.runId), [item("previous-prospect")]);
    expect(
      (
        await asUser(actor, () =>
          sql("select status from public.lead_rows where campaign_id=$1", [
            future,
          ]),
        )
      ).rows[0].status,
    ).toBe("suppressed");
    await expect(
      asUser(outsider, () => rpc("exclude_profiles", [cid, [url]])),
    ).rejects.toThrow("Agency access");
    await expect(
      asUser(actor, () => rpc("exclude_profiles", [randomUUID(), [url]])),
    ).rejects.toThrow("Client not found");
    await expect(
      asUser(actor, () =>
        rpc("exclude_profiles", [
          cid,
          ["https://www.linkedin.com/in/valid-new", "invalid"],
        ]),
      ),
    ).rejects.toThrow("valid LinkedIn");
    expect(
      (
        await sql(
          "select count(*)::int as n from public.suppressions where client_id=$1",
          [cid],
        )
      ).rows[0].n,
    ).toBe(1);
    await asUser(actor, () =>
      rpc("set_suppression", [cid, url, "Imported blocklist", "", false]),
    );
    expect(
      await asUser(actor, () => rpc("export_prospects", [cid, "", ""])),
    ).toEqual([]);
    expect(
      await asUser(actor, () => rpc("exclude_profiles", [cid, [url]])),
    ).toEqual({ added: 1, alreadyExcluded: 0 });
  });
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

const recruitingTables = [
  "candidates",
  "candidate_identities",
  "roles",
  "role_candidates",
  "role_candidate_events",
];
async function role(clientId: string, threshold = 3, name = "Senior engineer") {
  return asUser(actor, () =>
    rpc("save_role", [null, clientId, name, "", threshold, "open", null]),
  );
}
async function person(slug: string, fields: Record<string, unknown> = {}) {
  const identity = normalizeIdentity(
    "linkedin",
    `https://www.linkedin.com/in/${slug}`,
  );
  return asUser(actor, () =>
    rpc("upsert_candidate", [
      `Candidate ${slug}`,
      JSON.stringify([identity]),
      JSON.stringify(fields),
    ]),
  );
}
async function pipeline(slug: string, threshold = 3) {
  const cid = await client();
  const rid = await role(cid, threshold);
  const candidateId = await person(slug);
  await asUser(actor, () =>
    rpc("add_candidates_to_role", [cid, rid, [candidateId], "linkedin"]),
  );
  const rcId = (
    await sql("select id from public.role_candidates where role_id=$1", [rid])
  ).rows[0].id as string;
  return { cid, rid, candidateId, rcId };
}

describe("edit history, duplicate review and bulk editing", () => {
  async function twoRows(slug: string) {
    const first = await pipeline(slug);
    const second = await person(`${slug}-second`);
    await asUser(actor, () => rpc("add_candidates_to_role", [first.cid, first.rid, [second], "linkedin"]));
    const ids = (await sql("select id from public.role_candidates where role_id=$1 order by id", [first.rid])).rows.map((row) => row.id);
    return { ...first, second, ids };
  }
  async function bulk(fixture: Awaited<ReturnType<typeof twoRows>>, field: string, value: unknown, mode = "replace", token: string | null = null) {
    return asUser(actor, () => rpc("bulk_edit_role_candidates", [fixture.cid, fixture.rid, fixture.ids, "all_profiles", field, value === null ? null : JSON.stringify(value), mode, token]));
  }
  // The edit worth making in bulk is a whole import that went in wrong, and
  // an import is bigger than the fifty rows a page shows.
  it("covers more rows than one page holds, listing the first fifty", async () => {
    const cid = await client();
    const rid = await role(cid);
    const rows = Array.from({ length: 60 }, (_, index) => linkedinRow(`wide-bulk-${index}`));
    expect(
      await asUser(actor, () =>
        rpc("import_candidates", [cid, rid, JSON.stringify(rows), "csv", "all_profiles"]),
      ),
    ).toMatchObject({ created: 60 });
    const ids = (
      await sql("select id from public.role_candidates where role_id=$1 order by id", [rid])
    ).rows.map((row) => row.id);
    const edit = (token: string | null) =>
      asUser(actor, () =>
        rpc("bulk_edit_role_candidates", [cid, rid, ids, "all_profiles", "source", JSON.stringify("google"), "replace", token]),
      );
    const preview = await edit(null);
    expect(preview).toMatchObject({ changed: 60, skipped: 0 });
    expect(preview.rows).toHaveLength(50);
    await edit(preview.token);
    expect(
      (await sql("select count(*)::int as n from public.role_candidates where role_id=$1 and source='google'", [rid]))
        .rows[0].n,
    ).toBe(60);
    // One batch, so Edit history reads as the single action it was.
    expect(
      (await sql("select count(distinct batch_id)::int as n from private.candidate_edit_history where field='source'"))
        .rows[0].n,
    ).toBe(1);
  });
  it("still refuses a selection beyond what one edit should carry", async () => {
    const f = await twoRows("bulk-cap");
    const tooMany = Array.from({ length: 2001 }, () => randomUUID());
    await expect(
      asUser(actor, () =>
        rpc("bulk_edit_role_candidates", [f.cid, f.rid, tooMany, "all_profiles", "source", JSON.stringify("google"), "replace", null]),
      ),
    ).rejects.toThrow("Select 1");
  });
  it("previews without writing, fills only blanks, applies atomically and records before/after with a batch", async () => {
    const f = await twoRows("bulk-fill");
    await asUser(actor, () => rpc("save_candidate_field", [f.second, "current_company", "Existing company"]));
    const preview = await bulk(f, "current_company", "New company", "fill_empty");
    expect(preview).toMatchObject({ changed: 1, skipped: 1, shared: true, batchId: null });
    expect((await sql("select current_company from public.candidates where id=$1", [f.candidateId])).rows[0].current_company).toBe("");
    const applied = await bulk(f, "current_company", "New company", "fill_empty", preview.token);
    expect(applied.batchId).toBeTruthy();
    const history = await asUser(actor, () => rpc("candidate_edit_history_page", [f.cid, f.rid, f.candidateId, null]));
    expect(history.rows.find((row: { field: string }) => row.field === "current_company")).toMatchObject({ before: "", after: "New company", batchId: applied.batchId, scope: "Shared profile" });
    const audit = (await sql("select actor_id from private.candidate_edit_history where batch_id=$1", [applied.batchId])).rows;
    expect(audit).toEqual([{ actor_id: actor }]);
    const clear = await bulk(f, "current_company", null, "clear");
    expect(clear.changed).toBe(2);
    await bulk(f, "current_company", null, "clear", clear.token);
    expect((await sql("select current_company from public.candidates where id=any($1::uuid[])", [[f.candidateId,f.second]])).rows.every((row) => row.current_company === "")).toBe(true);
  });
  it("rejects stale previews and wrong-scope selections without partial writes", async () => {
    const f = await twoRows("bulk-stale");
    const preview = await bulk(f, "location", "Chennai");
    await asUser(actor, () => rpc("save_candidate_field", [f.second, "headline", "Concurrent edit"]));
    await expect(bulk(f, "location", "Chennai", "replace", preview.token)).rejects.toThrow("Data changed");
    const outside = await pipeline("bulk-outside");
    await expect(bulk({ ...f, ids: [f.rcId,outside.rcId] }, "location", "Chennai")).rejects.toThrow("scope");
    expect((await sql("select location from public.candidates where id=any($1::uuid[])", [[f.candidateId,f.second]])).rows.every((row) => row.location === "")).toBe(true);
    await expect(bulk(f, "email", "same@example.com")).rejects.toThrow("not available");
    await expect(bulk({ ...f, ids: [f.rcId,f.rcId] }, "location", "Chennai")).rejects.toThrow("unique");
    const ratingPreview = await bulk(f, "rating", 4.5);
    await sql("update public.roles set rating_threshold=5 where id=$1", [f.rid]);
    await expect(bulk(f, "rating", 4.5, "replace", ratingPreview.token)).rejects.toThrow("Data changed");
    await sql("update public.roles set archived=true where id=$1", [f.rid]);
    await expect(bulk(f, "location", "Chennai")).rejects.toThrow("Active role");
  });
  it("rolls back earlier writes and audit entries if a later row fails", async () => {
    const f = await twoRows("bulk-rollback");
    const lastPerson = (await sql("select candidate_id from public.role_candidates where role_id=$1 order by id desc limit 1", [f.rid])).rows[0].candidate_id;
    // This UUID comes from our fixture. Fail on the second row after the first
    // write and its audit trigger have run inside the same transaction.
    await sql(`create function public.test_bulk_failure() returns trigger language plpgsql as $$ begin if new.id::text=tg_argv[0] and new.location='Reject bulk test' then raise exception 'Simulated write failure'; end if; return new; end $$;
      create trigger test_bulk_failure before update on public.candidates for each row execute function public.test_bulk_failure('${lastPerson}');`);
    const preview = await bulk(f, "location", "Reject bulk test");
    await expect(bulk(f, "location", "Reject bulk test", "replace", preview.token)).rejects.toThrow("Simulated write failure");
    expect((await sql("select location from public.candidates where id=any($1::uuid[])", [[f.candidateId,f.second]])).rows.every((row) => row.location === "")).toBe(true);
    expect((await sql("select id from private.candidate_edit_history where candidate_id=any($1::uuid[]) and field='location'", [[f.candidateId,f.second]])).rowCount).toBe(0);
    await sql("drop trigger test_bulk_failure on public.candidates; drop function public.test_bulk_failure()");
  });
  it("validates custom options, records each changed custom field and preserves rating stage rules", async () => {
    const f = await twoRows("bulk-custom");
    const fieldId = await asUser(actor, () => rpc("add_role_field", [f.cid,f.rid,"Priority","select",JSON.stringify(["High","Low"])]));
    const key = (await sql("select key from public.role_fields where id=$1", [fieldId])).rows[0].key;
    await expect(bulk(f, `custom:${key}`, "Invalid")).rejects.toThrow("existing column option");
    const preview = await bulk(f, `custom:${key}`, "High");
    await bulk(f, `custom:${key}`, "High", "replace", preview.token);
    const history = await asUser(actor, () => rpc("candidate_edit_history_page", [f.cid,f.rid,null,null]));
    expect(history.rows.filter((row: { field: string }) => row.field === `custom:${key}`)).toHaveLength(2);
    const rating = await bulk(f, "rating", 4.5);
    await bulk(f, "rating", 4.5, "replace", rating.token);
    expect((await sql("select stage from public.role_candidates where role_id=$1", [f.rid])).rows.every((row) => row.stage === "profile_shortlisted")).toBe(true);
  });
  it("finds full-database matches, records review decisions, and reopens changed matches", async () => {
    const f = await pipeline("duplicate-first");
    const second = await person("duplicate-second");
    const email = "duplicate-review@example.com";
    await asUser(actor, () => rpc("save_candidate_field", [f.candidateId,"email",email]));
    await asUser(actor, () => rpc("save_candidate_field", [second,"email",email.toUpperCase()]));
    let matches = await asUser(actor, () => rpc("duplicate_review_page", [f.cid,f.rid,"pending",null]));
    expect(matches.rows).toHaveLength(1);
    const pair = matches.rows[0];
    expect(pair.reasons).toContain("Same email");
    expect([pair.first.id,pair.second.id]).toContain(second);
    const decision = [f.cid,f.rid,pair.first.id,pair.second.id,pair.fingerprint,pair.revision,"separate","Shared mailbox"];
    await asUser(actor, () => rpc("review_candidate_duplicate", decision));
    await expect(asUser(actor, () => rpc("review_candidate_duplicate", decision))).rejects.toThrow("Another operator");
    matches = await asUser(actor, () => rpc("duplicate_review_page", [f.cid,f.rid,"pending",null]));
    expect(matches.rows).toEqual([]);
    expect((await asUser(actor, () => rpc("duplicate_review_page", [f.cid,f.rid,"separate",null]))).rows[0].note).toBe("Shared mailbox");
    await asUser(actor, () => rpc("save_candidate_field", [second,"full_name","Updated duplicate name"]));
    expect((await asUser(actor, () => rpc("duplicate_review_page", [f.cid,f.rid,"pending",null]))).rows).toHaveLength(1);
    expect((await sql("select id from public.candidates where id=any($1::uuid[])", [[f.candidateId,second]])).rowCount).toBe(2);
    expect((await asUser(actor, () => rpc("candidate_edit_history_page", [f.cid,f.rid,null,null]))).rows.some((row: { field: string }) => row.field === "duplicate_review")).toBe(true);
  });
  it("ignores blank contacts and same names alone, and paginates history without overlap", async () => {
    const f = await twoRows("history-paging");
    await sql("update public.candidates set full_name='Same name' where id=any($1::uuid[])", [[f.candidateId,f.second]]);
    expect((await asUser(actor, () => rpc("duplicate_review_page", [f.cid,f.rid,"pending",null]))).rows).toHaveLength(0);
    await sql("update public.candidates set current_company='Same Company',phone='4155552671' where id=any($1::uuid[])", [[f.candidateId,f.second]]);
    const matches = await asUser(actor, () => rpc("duplicate_review_page", [f.cid,f.rid,"pending",null]));
    expect(matches.rows[0].reasons).toEqual(["Same phone","Same name and company"]);
    for (let n=0;n<53;n++) await asUser(actor, () => rpc("save_candidate_field", [f.candidateId,"location",`Location ${n}`]));
    const first = await asUser(actor, () => rpc("candidate_edit_history_page", [f.cid,f.rid,f.candidateId,null]));
    const next = await asUser(actor, () => rpc("candidate_edit_history_page", [f.cid,f.rid,f.candidateId,first.nextCursor]));
    expect(first.rows).toHaveLength(50);
    expect(next.rows.length).toBeGreaterThan(0);
    expect(new Set([...first.rows,...next.rows].map((row: { id: string }) => row.id)).size).toBe(first.rows.length+next.rows.length);
  });
  it("denies unapproved and anonymous callers and protects private audit tables", async () => {
    const f = await twoRows("tools-access");
    for (const [name,args] of [["candidate_edit_history_page",[f.cid,f.rid,null,null]],["duplicate_review_page",[f.cid,f.rid,"pending",null]],["bulk_edit_role_candidates",[f.cid,f.rid,f.ids,"all_profiles","location",JSON.stringify("X"),"replace",null]]] as const) {
      await expect(asUser(outsider, () => rpc(name,[...args]))).rejects.toThrow("Agency access");
    }
    await expect(asUser(actor, () => sql("select * from private.candidate_edit_history"))).rejects.toThrow();
    await expect(asUser(actor, () => sql("select * from private.candidate_duplicate_reviews"))).rejects.toThrow();
    await sql("begin; set local role anon");
    await expect(rpc("candidate_edit_history_page",[f.cid,f.rid,null,null])).rejects.toThrow();
    await sql("rollback");
  });
});

describe("recoverable role membership deletion", () => {
  // Deletion is the owner's alone, so the actor holds ownership for this block
  // and gives it back afterwards. The refusal for a merely approved operator is
  // asserted on its own below.
  beforeAll(() =>
    sql("update public.user_profiles set is_owner=true where id=$1", [actor]).then(() => {}),
  );
  afterAll(() =>
    sql("update public.user_profiles set is_owner=false where id=$1", [actor]).then(() => {}),
  );

  it("refuses an approved operator who is not the owner", async () => {
    const { cid, rid, rcId } = await pipeline("trash-not-owner");
    await sql("update public.user_profiles set is_owner=false where id=$1", [actor]);
    try {
      for (const call of [
        () => rpc("remove_role_candidates", [cid, rid, [rcId], "all_profiles"]),
        () => rpc("deleted_role_candidate_batches", [cid, rid]),
        () => rpc("restore_role_candidates", [cid, rid, randomUUID()]),
      ])
        await expect(asUser(actor, call)).rejects.toThrow("workspace owner");
      // Nothing was removed on the way to being refused.
      expect(
        (await sql("select id from public.role_candidates where id=$1", [rcId])).rowCount,
      ).toBe(1);
    } finally {
      await sql("update public.user_profiles set is_owner=true where id=$1", [actor]);
    }
  });

  it("removes only the selected role membership and restores its exact fields and history", async () => {
    const { cid, rid, candidateId, rcId } = await pipeline("trash-roundtrip");
    const secondRole = await role(cid, 3, "Another role");
    await asUser(actor, () => rpc("add_candidates_to_role", [cid, secondRole, [candidateId], "linkedin"]));
    await sql("update public.role_candidates set internal_notes='Keep these notes' where id=$1", [rcId]);
    const original = (await sql("select to_jsonb(rc) as record from public.role_candidates rc where id=$1", [rcId])).rows[0].record;
    const history = (await sql("select to_jsonb(e) as record from public.role_candidate_events e where role_candidate_id=$1 order by id", [rcId])).rows;
    expect(history.length).toBeGreaterThan(0);
    const batch = await asUser(actor, () => rpc("remove_role_candidates", [cid, rid, [rcId], "all_profiles"]));
    expect((await sql("select id from public.role_candidates where id=$1", [rcId])).rowCount).toBe(0);
    expect((await sql("select id from public.role_candidate_events where role_candidate_id=$1", [rcId])).rowCount).toBe(0);
    expect((await sql("select id from public.candidates where id=$1", [candidateId])).rowCount).toBe(1);
    expect((await sql("select id from public.candidate_identities where candidate_id=$1", [candidateId])).rowCount).toBeGreaterThan(0);
    expect((await sql("select id from public.role_candidates where role_id=$1 and candidate_id=$2", [secondRole, candidateId])).rowCount).toBe(1);
    expect(await asUser(actor, () => rpc("deleted_role_candidate_batches", [cid, rid]))).toEqual([expect.objectContaining({ id: batch, count: 1 })]);
    expect(await asUser(actor, () => rpc("restore_role_candidates", [cid, rid, batch]))).toBe(1);
    expect((await sql("select to_jsonb(rc) as record from public.role_candidates rc where id=$1", [rcId])).rows[0].record).toEqual(original);
    expect((await sql("select to_jsonb(e) as record from public.role_candidate_events e where role_candidate_id=$1 order by id", [rcId])).rows).toEqual(history);
    expect(await asUser(actor, () => rpc("restore_role_candidates", [cid, rid, batch]))).toBe(0);
    expect(await asUser(actor, () => rpc("deleted_role_candidate_batches", [cid, rid]))).toEqual([]);
  });
  it("atomically rejects wrong-role IDs, stale stages, duplicates and unapproved users", async () => {
    const a = await pipeline("trash-scope-a"), b = await pipeline("trash-scope-b");
    for (const ids of [[a.rcId, b.rcId], [a.rcId, a.rcId], []]) {
      await expect(asUser(actor, () => rpc("remove_role_candidates", [a.cid, a.rid, ids, "all_profiles"]))).rejects.toThrow();
    }
    await expect(asUser(actor, () => rpc("remove_role_candidates", [a.cid, a.rid, [a.rcId], "offer_sent"]))).rejects.toThrow("changed");
    await expect(asUser(outsider, () => rpc("remove_role_candidates", [a.cid, a.rid, [a.rcId], "all_profiles"]))).rejects.toThrow();
    await expect(asUser(outsider, () => rpc("deleted_role_candidate_batches", [a.cid, a.rid]))).rejects.toThrow();
    expect((await sql("select id from public.role_candidates where id=any($1::uuid[])", [[a.rcId, b.rcId]])).rowCount).toBe(2);
    const batch = await asUser(actor, () => rpc("remove_role_candidates", [a.cid, a.rid, [a.rcId], "all_profiles"]));
    await expect(asUser(actor, () => rpc("restore_role_candidates", [b.cid, b.rid, batch]))).rejects.toThrow("not found");
    await expect(asUser(outsider, () => rpc("restore_role_candidates", [a.cid, a.rid, batch]))).rejects.toThrow();
    await expect(asUser(actor, () => sql("select * from private.role_candidate_trash"))).rejects.toThrow();
    await sql("begin");
    await sql("set local role anon");
    await expect(rpc("deleted_role_candidate_batches", [a.cid, a.rid])).rejects.toThrow();
    await sql("rollback");
  });
  it("protects archived roles and refuses to overwrite a re-added membership", async () => {
    const { cid, rid, candidateId, rcId } = await pipeline("trash-conflict");
    await sql("update public.roles set archived=true where id=$1", [rid]);
    await expect(asUser(actor, () => rpc("remove_role_candidates", [cid, rid, [rcId], "all_profiles"]))).rejects.toThrow("Active role not found");
    await sql("update public.roles set archived=false where id=$1", [rid]);
    const batch = await asUser(actor, () => rpc("remove_role_candidates", [cid, rid, [rcId], "all_profiles"]));
    await asUser(actor, () => rpc("add_candidates_to_role", [cid, rid, [candidateId], "linkedin"]));
    await expect(asUser(actor, () => rpc("restore_role_candidates", [cid, rid, batch]))).rejects.toThrow("already been added");
    expect((await sql("select id from public.role_candidates where role_id=$1", [rid])).rowCount).toBe(1);
    expect(await asUser(actor, () => rpc("deleted_role_candidate_batches", [cid, rid]))).toHaveLength(1);
  });
});

describe("recruiting foundation: roles, master candidates and pipeline history", () => {
  it("grants authenticated read-only access to every recruiting table", async () => {
    for (const table of recruitingTables) {
      const grants = await sql(
        "select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='authenticated'",
        [table],
      );
      expect({ table, granted: grants.rows.map((r) => r.privilege_type) }).toEqual(
        { table, granted: ["SELECT"] },
      );
      const secured = await sql(
        "select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname=$1",
        [table],
      );
      expect({ table, rls: secured.rows[0].relrowsecurity }).toEqual({
        table,
        rls: true,
      });
    }
  });
  it("denies anon reads and recruiting RPCs entirely", async () => {
    await sql("begin");
    await sql("set local role anon");
    await expect(sql("select * from public.roles")).rejects.toThrow();
    await expect(sql("select * from public.candidates")).rejects.toThrow();
    await expect(
      sql("select public.save_role(null,null,'x','',3,'open',null)"),
    ).rejects.toThrow();
    await sql("rollback");
  });
  it("denies non-admin and direct writes to recruiting tables", async () => {
    const cid = await client();
    await expect(
      asUser(outsider, () => rpc("save_role", [null, cid, "Forbidden", "", 3, "open", null])),
    ).rejects.toThrow("Agency access");
    await expect(
      asUser(actor, () =>
        sql("insert into public.roles(client_id,name) values($1,'bypass')", [cid]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(actor, () =>
        sql("insert into public.candidates(full_name,created_by) values('bypass',$1)", [
          actor,
        ]),
      ),
    ).rejects.toThrow();
  });
  it("refuses a role candidate that crosses clients even with privileged writes", async () => {
    const a = await client(),
      b = await client();
    const roleInB = await role(b);
    const candidateId = await person("cross-client-guard");
    await expect(
      sql(
        "insert into public.role_candidates(client_id,role_id,candidate_id) values($1,$2,$3)",
        [a, roleInB, candidateId],
      ),
    ).rejects.toThrow();
  });
  it("resolves LinkedIn URL variants to one master candidate", async () => {
    const first = await asUser(actor, () =>
      rpc("upsert_candidate", [
        "Priya Nair",
        JSON.stringify([
          normalizeIdentity("linkedin", "https://www.linkedin.com/in/priya-dedupe"),
        ]),
        "{}",
      ]),
    );
    const second = await asUser(actor, () =>
      rpc("upsert_candidate", [
        "Priya N",
        JSON.stringify([
          normalizeIdentity("linkedin", "https://in.linkedin.com/in/priya-dedupe?trk=x"),
        ]),
        "{}",
      ]),
    );
    expect(second).toBe(first);
    expect(
      (
        await sql(
          "select count(*)::int as n from public.candidate_identities where candidate_id=$1",
          [first],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("never clears reusable contact data with a blank re-import", async () => {
    const identity = JSON.stringify([
      normalizeIdentity("linkedin", "https://www.linkedin.com/in/enriched-once"),
    ]);
    const id = await asUser(actor, () =>
      rpc("upsert_candidate", [
        "Enriched Person",
        identity,
        JSON.stringify({ phone: "9876543210", location: "Chennai" }),
      ]),
    );
    await asUser(actor, () =>
      rpc("upsert_candidate", ["Enriched Person", identity, JSON.stringify({ phone: "" })]),
    );
    expect(
      (await sql("select phone,location from public.candidates where id=$1", [id]))
        .rows[0],
    ).toEqual({ phone: "9876543210", location: "Chennai" });
  });
  it("requires a mergeable identity and stops an ambiguous merge", async () => {
    await expect(
      asUser(actor, () =>
        rpc("upsert_candidate", [
          "Nameless",
          JSON.stringify([{ kind: "phone", value: "9000000001" }]),
          "{}",
        ]),
      ),
    ).rejects.toThrow("can be matched");
    const a = await person("ambiguous-a");
    const b = await person("ambiguous-b");
    expect(a).not.toBe(b);
    await expect(
      asUser(actor, () =>
        rpc("upsert_candidate", [
          "Ambiguous",
          JSON.stringify([
            normalizeIdentity("linkedin", "https://www.linkedin.com/in/ambiguous-a"),
            normalizeIdentity("linkedin", "https://www.linkedin.com/in/ambiguous-b"),
          ]),
          "{}",
        ]),
      ),
    ).rejects.toThrow("different candidates");
  });
  it("adds a candidate to a role once, however many times it is submitted", async () => {
    const cid = await client();
    const rid = await role(cid);
    const candidateId = await person("added-once");
    expect(
      await asUser(actor, () =>
        rpc("add_candidates_to_role", [cid, rid, [candidateId, candidateId], "csv"]),
      ),
    ).toEqual({ added: 1, alreadyInRole: 0 });
    expect(
      await asUser(actor, () =>
        rpc("add_candidates_to_role", [cid, rid, [candidateId], "csv"]),
      ),
    ).toEqual({ added: 0, alreadyInRole: 1 });
    expect(
      (
        await sql(
          "select count(*)::int as n from public.role_candidate_events where kind='import' and client_id=$1",
          [cid],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("keeps the same person in two roles without duplicating the master record", async () => {
    const cid = await client();
    const first = await role(cid, 3, "Backend engineer");
    const second = await role(cid, 4, "Platform engineer");
    const candidateId = await person("two-roles");
    await asUser(actor, () =>
      rpc("add_candidates_to_role", [cid, first, [candidateId], "linkedin"]),
    );
    await asUser(actor, () =>
      rpc("add_candidates_to_role", [cid, second, [candidateId], "linkedin"]),
    );
    expect(
      (
        await sql(
          "select count(*)::int as n from public.role_candidates where candidate_id=$1",
          [candidateId],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await sql("select count(*)::int as n from public.candidates where id=$1", [
          candidateId,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
  it("records one event per stage move and never rewrites created_at", async () => {
    const { cid, rcId } = await pipeline("stage-history");
    const before = (
      await sql("select created_at,stage from public.role_candidates where id=$1", [
        rcId,
      ])
    ).rows[0];
    await asUser(actor, () =>
      rpc("move_stage", [cid, [rcId], "profile_shortlisted", "Rated above floor"]),
    );
    const events = await sql(
      "select from_stage,to_stage,actor,reason from public.role_candidate_events where role_candidate_id=$1 and kind='stage'",
      [rcId],
    );
    expect(events.rows).toEqual([
      {
        from_stage: "all_profiles",
        to_stage: "profile_shortlisted",
        actor,
        reason: "Rated above floor",
      },
    ]);
    const after = (
      await sql(
        "select created_at,stage,stage_entered_at from public.role_candidates where id=$1",
        [rcId],
      )
    ).rows[0];
    expect(after.created_at).toEqual(before.created_at);
    expect(after.stage).toBe("profile_shortlisted");
    // Re-submitting the same stage writes no second history row.
    await asUser(actor, () =>
      rpc("move_stage", [cid, [rcId], "profile_shortlisted", ""]),
    );
    expect(
      (
        await sql(
          "select count(*)::int as n from public.role_candidate_events where role_candidate_id=$1 and kind='stage'",
          [rcId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("refuses a stage move that targets rejection or another client", async () => {
    const { cid, rcId } = await pipeline("stage-guards");
    const other = await client();
    await expect(
      asUser(actor, () => rpc("move_stage", [cid, [rcId], "rejected", ""])),
    ).rejects.toThrow("valid pipeline stage");
    await expect(
      asUser(actor, () => rpc("move_stage", [other, [rcId], "offer_sent", ""])),
    ).rejects.toThrow("not in this client");
  });
  it("requires a reason to reject, in the RPC and in the table itself", async () => {
    const { cid, rcId } = await pipeline("reject-reason");
    await expect(
      asUser(actor, () => rpc("reject_candidate", [cid, [rcId], "recruiter", "   "])),
    ).rejects.toThrow("Enter a reason");
    await expect(
      asUser(actor, () => rpc("reject_candidate", [cid, [rcId], "unknown", "Not a fit"])),
    ).rejects.toThrow("recruiter or client");
    await expect(
      sql(
        "update public.role_candidates set stage='rejected',rejection_type='recruiter',rejection_reason='' where id=$1",
        [rcId],
      ),
    ).rejects.toThrow();
    await expect(
      sql("update public.role_candidates set stage='rejected' where id=$1", [rcId]),
    ).rejects.toThrow();
  });
  it("keeps rejected candidates readable and restores them cleanly", async () => {
    const { cid, rcId } = await pipeline("reject-history");
    await asUser(actor, () =>
      rpc("move_stage", [cid, [rcId], "recruiter_shortlisted", ""]),
    );
    await asUser(actor, () =>
      rpc("reject_candidate", [cid, [rcId], "client", "Salary expectation too high"]),
    );
    const rejected = (
      await sql(
        "select stage,rejection_type,rejection_reason,rejected_by from public.role_candidates where id=$1",
        [rcId],
      )
    ).rows[0];
    expect(rejected).toEqual({
      stage: "rejected",
      rejection_type: "client",
      rejection_reason: "Salary expectation too high",
      rejected_by: actor,
    });
    expect(
      (
        await sql(
          "select from_stage,to_stage,reason from public.role_candidate_events where role_candidate_id=$1 and kind='reject'",
          [rcId],
        )
      ).rows,
    ).toEqual([
      {
        from_stage: "recruiter_shortlisted",
        to_stage: "rejected",
        reason: "Salary expectation too high",
      },
    ]);
    await asUser(actor, () =>
      rpc("move_stage", [cid, [rcId], "recruiter_shortlisted", "Client reconsidered"]),
    );
    expect(
      (
        await sql(
          "select stage,rejection_type,rejection_reason,rejected_at from public.role_candidates where id=$1",
          [rcId],
        )
      ).rows[0],
    ).toEqual({
      stage: "recruiter_shortlisted",
      rejection_type: null,
      rejection_reason: "",
      rejected_at: null,
    });
  });
  it("changes a rating threshold without touching a single candidate", async () => {
    const { cid, rid, rcId } = await pipeline("threshold-frozen", 3);
    await asUser(actor, () =>
      rpc("move_stage", [cid, [rcId], "profile_shortlisted", ""]),
    );
    const before = (
      await sql(
        "select id,stage,rating,threshold_at_rating,stage_entered_at,updated_at from public.role_candidates where role_id=$1 order by id",
        [rid],
      )
    ).rows;
    const events = (
      await sql(
        "select count(*)::int as n from public.role_candidate_events where client_id=$1",
        [cid],
      )
    ).rows[0].n;
    await asUser(actor, () =>
      rpc("save_role", [rid, cid, "Senior engineer", "Raised the bar", 5, "open", 1]),
    );
    const savedRole = (
      await sql("select rating_threshold,revision from public.roles where id=$1", [rid])
    ).rows[0];
    expect(Number(savedRole.rating_threshold)).toBe(5);
    expect(savedRole.revision).toBe(2);
    expect(
      (
        await sql(
          "select id,stage,rating,threshold_at_rating,stage_entered_at,updated_at from public.role_candidates where role_id=$1 order by id",
          [rid],
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await sql(
          "select count(*)::int as n from public.role_candidate_events where client_id=$1",
          [cid],
        )
      ).rows[0].n,
    ).toBe(events);
  });
  it("guards role saves with revision, threshold range and client state", async () => {
    const cid = await client();
    const rid = await role(cid);
    await expect(
      asUser(actor, () => rpc("save_role", [rid, cid, "Stale", "", 3, "open", 99])),
    ).rejects.toThrow("Another operator");
    await expect(
      asUser(actor, () => rpc("save_role", [null, cid, "Bad floor", "", 9, "open", null])),
    ).rejects.toThrow("0.0 to 5.0");
    await expect(
      asUser(actor, () => rpc("save_role", [null, cid, "Bad state", "", 3, "paused", null])),
    ).rejects.toThrow("valid role status");
    await asUser(actor, () => rpc("archive_entity", ["client", cid, true]));
    await expect(
      asUser(actor, () => rpc("save_role", [null, cid, "Archived", "", 3, "open", null])),
    ).rejects.toThrow("Restore this client");
  });
  it("keeps on-hold and closed roles out of active client summaries", async () => {
    const cid = await client();
    await role(cid, 3, "Open role");
    const onHold = await role(cid, 3, "On hold role");
    const closed = await role(cid, 3, "Closed role");
    await asUser(actor, () =>
      rpc("save_role", [onHold, cid, "On hold role", "", 3, "on_hold", 1]),
    );
    await asUser(actor, () =>
      rpc("save_role", [closed, cid, "Closed role", "", 3, "closed", 1]),
    );
    const summary = await asUser(actor, () =>
      sql(
        "select active_roles from public.client_directory_counts() where client_id=$1",
        [cid],
      ),
    );
    expect(summary.rows[0].active_roles).toBe(1);
  });
  it("refuses candidates for an archived role", async () => {
    const cid = await client();
    const rid = await role(cid);
    const candidateId = await person("archived-role");
    await asUser(actor, () => rpc("archive_role", [rid, true]));
    await expect(
      asUser(actor, () =>
        rpc("add_candidates_to_role", [cid, rid, [candidateId], "linkedin"]),
      ),
    ).rejects.toThrow("Restore this role");
  });
});

function linkedinRow(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    name: `Candidate ${slug}`,
    identities: [normalizeIdentity("linkedin", `https://www.linkedin.com/in/${slug}`)],
    fields: {},
    ...overrides,
  };
}

describe("import_candidates: two mobile numbers, ten digits each", () => {
  const importRows = (cid: string, rid: string, rows: unknown[]) =>
    asUser(actor, () =>
      rpc("import_candidates", [cid, rid, JSON.stringify(rows), "csv", "all_profiles"]),
    );
  const contacts = async (rid: string) =>
    (
      await sql(
        "select c.phone,c.alternate_phone from public.candidates c join public.role_candidates rc on rc.candidate_id=c.id where rc.role_id=$1",
        [rid],
      )
    ).rows[0];

  it("stores both numbers", async () => {
    const cid = await client();
    const rid = await role(cid);
    const summary = await importRows(cid, rid, [
      linkedinRow("two-mobiles", {
        fields: { phone: "9876543210", alternatePhone: "9812345678" },
      }),
    ]);
    expect(summary).toMatchObject({ created: 1 });
    expect(await contacts(rid)).toEqual({
      phone: "9876543210",
      alternate_phone: "9812345678",
    });
  });

  it("fails a row whose number is not ten digits", async () => {
    const cid = await client();
    const rid = await role(cid);
    for (const fields of [
      { phone: "+919876543210" },
      { phone: "98765" },
      { phone: "9876543210", alternatePhone: "98765432101" },
    ]) {
      const summary = await importRows(cid, rid, [
        linkedinRow(`bad-mobile-${JSON.stringify(fields).length}-${fields.alternatePhone ?? "x"}`, { fields }),
      ]);
      expect(summary).toMatchObject({ created: 0, invalid: 1 });
    }
  });

  it("keeps one number when a row writes the same one in both columns", async () => {
    const cid = await client();
    const rid = await role(cid);
    const summary = await importRows(cid, rid, [
      linkedinRow("one-number-twice", {
        fields: { phone: "9876543210", alternatePhone: "9876543210" },
      }),
    ]);
    expect(summary).toMatchObject({ created: 1 });
    expect(await contacts(rid)).toEqual({
      phone: "9876543210",
      alternate_phone: null,
    });
  });

  // The file that found this: one candidate listed twice, their second number
  // in the alternate column of the first row and as the primary of the second.
  it("reconciles a second row whose primary is the alternate already on file", async () => {
    const cid = await client();
    const rid = await role(cid);
    await importRows(cid, rid, [
      linkedinRow("listed-twice", {
        fields: { phone: "9004949735", alternatePhone: "9004949120" },
      }),
    ]);
    const summary = await importRows(cid, rid, [
      linkedinRow("listed-twice", { fields: { phone: "9004949120" } }),
    ]);
    expect(summary).toMatchObject({ invalid: 0, alreadyInRole: 1 });
    expect(await contacts(rid)).toEqual({
      phone: "9004949120",
      alternate_phone: null,
    });
  });

  it("does not clear an alternate already on file with a blank one", async () => {
    const cid = await client();
    const rid = await role(cid);
    await importRows(cid, rid, [
      linkedinRow("keep-alternate", {
        fields: { phone: "9876543210", alternatePhone: "9812345678" },
      }),
    ]);
    await importRows(cid, rid, [linkedinRow("keep-alternate")]);
    expect(await contacts(rid)).toEqual({
      phone: "9876543210",
      alternate_phone: "9812345678",
    });
  });
});

describe("six sources, and Naukri that skips the rating queue", () => {
  const importRows = (cid: string, rid: string, rows: unknown[], source = "naukri") =>
    asUser(actor, () =>
      rpc("import_candidates", [cid, rid, JSON.stringify(rows), source, "all_profiles"]),
    );
  const placed = async (rid: string) =>
    (
      await sql(
        "select stage,source from public.role_candidates where role_id=$1 order by id",
        [rid],
      )
    ).rows;

  it("starts a Naukri profile in Profile shortlisted, and says why in the timeline", async () => {
    const cid = await client();
    const rid = await role(cid);
    expect(await importRows(cid, rid, [linkedinRow("naukri-one")])).toMatchObject({ created: 1 });
    expect(await placed(rid)).toEqual([
      { stage: "profile_shortlisted", source: "naukri" },
    ]);
    const events = (
      await sql(
        "select kind,from_stage,to_stage,reason from public.role_candidate_events where client_id=$1 order by id",
        [cid],
      )
    ).rows;
    expect(events).toContainEqual({
      kind: "stage",
      from_stage: "all_profiles",
      to_stage: "profile_shortlisted",
      reason: "Naukri profile, added without a rating.",
    });
    expect(events.find((event) => event.kind === "import").to_stage).toBe("profile_shortlisted");
  });

  it("leaves every other source in All profiles", async () => {
    const cid = await client();
    const rid = await role(cid);
    for (const source of ["linkedin", "google", "csv", "master_db", "other"])
      await importRows(cid, rid, [linkedinRow(`source-${source}`)], source);
    expect((await placed(rid)).every((row) => row.stage === "all_profiles")).toBe(true);
  });

  it("lets a Source cell in the file overrule the batch setting", async () => {
    const cid = await client();
    const rid = await role(cid);
    await importRows(
      cid,
      rid,
      [
        linkedinRow("row-source-naukri", { source: "naukri" }),
        linkedinRow("row-source-unknown", { source: "carrier pigeon" }),
      ],
      "csv",
    );
    const rows = [...(await placed(rid))].sort((a, b) => a.source.localeCompare(b.source));
    expect(rows).toEqual([
      // Unreadable, so the batch setting stands rather than the row failing.
      { stage: "all_profiles", source: "csv" },
      { stage: "profile_shortlisted", source: "naukri" },
    ]);
  });

  it("refuses the mechanism-shaped sources it used to accept", async () => {
    const cid = await client();
    const rid = await role(cid);
    for (const source of ["manual", "url_paste", "sourcing_import"])
      await expect(importRows(cid, rid, [linkedinRow("old-source")], source)).rejects.toThrow(
        "Unsupported candidate source",
      );
  });

  it("applies the same rule to a candidate added from the master database", async () => {
    const cid = await client();
    const rid = await role(cid);
    const candidateId = await person("master-naukri");
    await asUser(actor, () => rpc("add_candidates_to_role", [cid, rid, [candidateId], "naukri"]));
    expect(await placed(rid)).toEqual([
      { stage: "profile_shortlisted", source: "naukri" },
    ]);
  });

  it("takes rows out of the rating queue when their source becomes Naukri", async () => {
    const cid = await client();
    const rid = await role(cid);
    // One waiting to be rated, one already past that point.
    await asUser(actor, () =>
      rpc("import_candidates", [cid, rid, JSON.stringify([
        linkedinRow("edit-to-naukri-a"), linkedinRow("edit-to-naukri-b"),
      ]), "csv", "all_profiles"]),
    );
    const ids = (
      await sql("select id from public.role_candidates where role_id=$1 order by id", [rid])
    ).rows.map((row) => row.id);
    await sql("update public.role_candidates set stage='recruiter_shortlisted' where id=$1", [ids[1]]);
    const edit = (token: string | null) =>
      asUser(actor, () =>
        rpc("bulk_edit_role_candidates", [cid, rid, ids, null, "source", JSON.stringify("naukri"), "replace", token]),
      );
    const preview = await edit(null);
    // Said before it happens, and only for the one still in All profiles.
    expect(preview).toMatchObject({ changed: 2, moved: 1 });
    expect(
      (await sql("select stage from public.role_candidates where id=$1", [ids[0]])).rows[0].stage,
    ).toBe("all_profiles");
    await edit(preview.token);
    const stages = (
      await sql("select id,stage,source from public.role_candidates where role_id=$1 order by id", [rid])
    ).rows;
    expect(stages).toEqual([
      { id: ids[0], stage: "profile_shortlisted", source: "naukri" },
      // Already being worked; a source correction does not pull it backwards.
      { id: ids[1], stage: "recruiter_shortlisted", source: "naukri" },
    ]);
    expect(
      (
        await sql(
          "select reason from public.role_candidate_events where role_candidate_id=$1 and kind='stage'",
          [ids[0]],
        )
      ).rows.map((row) => row.reason),
    ).toEqual(["Source set to Naukri, which is not rated here."]);
  });
  it("leaves stages alone when the source becomes anything else", async () => {
    const { cid, rid, rcId } = await pipeline("edit-to-google");
    const preview = await asUser(actor, () =>
      rpc("bulk_edit_role_candidates", [cid, rid, [rcId], null, "source", JSON.stringify("google"), "replace", null]),
    );
    expect(preview).toMatchObject({ changed: 1, moved: 0 });
    await asUser(actor, () =>
      rpc("bulk_edit_role_candidates", [cid, rid, [rcId], null, "source", JSON.stringify("google"), "replace", preview.token]),
    );
    expect(
      (await sql("select stage from public.role_candidates where id=$1", [rcId])).rows[0].stage,
    ).toBe("all_profiles");
  });
  it("bulk edits the source, and will not empty it", async () => {
    const { cid, rid, rcId } = await pipeline("bulk-source");
    const preview = await asUser(actor, () =>
      rpc("bulk_edit_role_candidates", [cid, rid, [rcId], null, "source", JSON.stringify("google"), "replace", null]),
    );
    expect(preview).toMatchObject({ changed: 1 });
    expect(preview.rows[0]).toMatchObject({ before: "linkedin", after: "google" });
    await asUser(actor, () =>
      rpc("bulk_edit_role_candidates", [cid, rid, [rcId], null, "source", JSON.stringify("google"), "replace", preview.token]),
    );
    expect((await placed(rid))[0].source).toBe("google");
    // Recorded like any other edit.
    expect(
      (
        await sql(
          "select before_value,after_value from private.candidate_edit_history where field='source' order by id desc limit 1",
        )
      ).rows[0],
    ).toEqual({ before_value: "linkedin", after_value: "google" });
    await expect(
      asUser(actor, () =>
        rpc("bulk_edit_role_candidates", [cid, rid, [rcId], null, "source", JSON.stringify("pigeon"), "replace", null]),
      ),
    ).rejects.toThrow("one of the listed sources");
    await expect(
      asUser(actor, () =>
        rpc("bulk_edit_role_candidates", [cid, rid, [rcId], null, "source", null, "clear", null]),
      ),
    ).rejects.toThrow("Every row has a source");
  });
});

describe("import_candidates: a rating in the file does what a typed one does", () => {
  const importRows = (cid: string, rid: string, rows: unknown[], stage = "all_profiles") =>
    asUser(actor, () =>
      rpc("import_candidates", [cid, rid, JSON.stringify(rows), "csv", stage]),
    );
  const membership = async (rid: string) =>
    (
      await sql(
        "select stage,rating,rated_by,threshold_at_rating from public.role_candidates where role_id=$1",
        [rid],
      )
    ).rows[0];

  it("moves a candidate whose imported rating meets the floor", async () => {
    const cid = await client();
    const rid = await role(cid, 4);
    const summary = await importRows(cid, rid, [
      linkedinRow("import-rating-meets", { fields: { rating: 4.6 } }),
    ]);
    expect(summary).toMatchObject({ created: 1, rated: 1 });
    const row = await membership(rid);
    expect(row.stage).toBe("profile_shortlisted");
    expect(Number(row.rating)).toBe(4.6);
    expect(row.rated_by).toBe(actor);
    expect(Number(row.threshold_at_rating)).toBe(4);
    // The same two events a rating typed into the grid leaves behind.
    const kinds = (
      await sql(
        "select kind from public.role_candidate_events where client_id=$1 order by kind",
        [cid],
      )
    ).rows.map((event) => event.kind);
    expect(kinds).toEqual(["import", "rating", "stage"]);
  });

  it("records a rating below the floor without moving anybody", async () => {
    const cid = await client();
    const rid = await role(cid, 4);
    const summary = await importRows(cid, rid, [
      linkedinRow("import-rating-below", { fields: { rating: 2.5 } }),
    ]);
    expect(summary).toMatchObject({ created: 1, rated: 1 });
    const row = await membership(rid);
    expect(row.stage).toBe("all_profiles");
    expect(Number(row.rating)).toBe(2.5);
  });

  it("rates somebody already on the role rather than adding them twice", async () => {
    const cid = await client();
    const rid = await role(cid, 4);
    await importRows(cid, rid, [linkedinRow("import-rating-again")]);
    const summary = await importRows(cid, rid, [
      linkedinRow("import-rating-again", { fields: { rating: 4.2 } }),
    ]);
    expect(summary).toMatchObject({ created: 0, alreadyInRole: 1, rated: 1 });
    expect(
      (await sql("select count(*) from public.role_candidates where role_id=$1", [rid]))
        .rows[0].count,
    ).toBe("1");
    expect((await membership(rid)).stage).toBe("profile_shortlisted");
  });

  it("fails the row rather than importing an unusable rating", async () => {
    const cid = await client();
    const rid = await role(cid, 4);
    for (const rating of [6, -1, 4.55, "high"]) {
      const summary = await importRows(cid, rid, [
        linkedinRow(`import-rating-bad-${String(rating)}`, { fields: { rating } }),
      ]);
      expect(summary).toMatchObject({ created: 0, invalid: 1, rated: 0, flagged: 0, flaggedRows: [] });
    }
    expect(
      (await sql("select count(*) from public.role_candidates where role_id=$1", [rid]))
        .rows[0].count,
    ).toBe("0");
  });

  it("leaves an existing rating alone when the file repeats it", async () => {
    const cid = await client();
    const rid = await role(cid, 4);
    await importRows(cid, rid, [
      linkedinRow("import-rating-same", { fields: { rating: 4.6 } }),
    ]);
    const summary = await importRows(cid, rid, [
      linkedinRow("import-rating-same", { fields: { rating: 4.6 } }),
    ]);
    expect(summary).toMatchObject({ rated: 0 });
    expect(
      (
        await sql(
          "select count(*) from public.role_candidate_events where client_id=$1 and kind='rating'",
          [cid],
        )
      ).rows[0].count,
    ).toBe("1");
  });
});

describe("import_candidates: bulk import shared by paste, manual, CSV and sourcing", () => {
  it("rejects an unsupported source and an out-of-range batch size", async () => {
    const cid = await client();
    const rid = await role(cid);
    await expect(
      asUser(actor, () =>
        rpc("import_candidates", [cid, rid, JSON.stringify([linkedinRow("bad-source")]), "invented", "all_profiles"]),
      ),
    ).rejects.toThrow("Unsupported candidate source");
    await expect(
      asUser(actor, () => rpc("import_candidates", [cid, rid, JSON.stringify([]), "linkedin", "all_profiles"])),
    ).rejects.toThrow("between 1 and 200");
    await expect(
      asUser(actor, () =>
        rpc("import_candidates", [
          cid,
          rid,
          JSON.stringify(Array.from({ length: 201 }, (_, i) => linkedinRow(`over-${i}`))),
          "linkedin",
          "all_profiles",
        ]),
      ),
    ).rejects.toThrow("between 1 and 200");
  });
  it("refuses an import into another client's role or an archived role", async () => {
    const cid = await client();
    const other = await client();
    const rid = await role(cid);
    await expect(
      asUser(actor, () =>
        rpc("import_candidates", [other, rid, JSON.stringify([linkedinRow("cross-client")]), "linkedin", "all_profiles"]),
      ),
    ).rejects.toThrow("Restore this role");
    await asUser(actor, () => rpc("archive_role", [rid, true]));
    await expect(
      asUser(actor, () =>
        rpc("import_candidates", [cid, rid, JSON.stringify([linkedinRow("archived")]), "linkedin", "all_profiles"]),
      ),
    ).rejects.toThrow("Restore this role");
  });
  it("creates new candidates, adds them to the role, and writes one import event each", async () => {
    const cid = await client();
    const rid = await role(cid);
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("bulk-a"), linkedinRow("bulk-b")]),
        "linkedin",
        "all_profiles",
      ]),
    );
    expect(summary).toEqual({ created: 2, matchedExisting: 0, alreadyInRole: 0, invalid: 0, updated: 0, skipped: 0, rated: 0, flagged: 0, flaggedRows: [] });
    expect(
      (await sql("select count(*)::int as n from public.role_candidates where role_id=$1", [rid]))
        .rows[0].n,
    ).toBe(2);
    expect(
      (
        await sql(
          "select count(*)::int as n from public.role_candidate_events where client_id=$1 and kind='import'",
          [cid],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it("stores the optional vendor detail on a new role candidate and its import event", async () => {
    const cid = await client();
    const rid = await role(cid);
    await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("upwork-source", { sourceDetail: "Upwork - August shortlist" })]),
        "csv",
        "all_profiles",
      ]),
    );
    expect(
      (await sql("select source,source_detail from public.role_candidates where role_id=$1", [rid]))
        .rows[0],
    ).toEqual({ source: "csv", source_detail: "Upwork - August shortlist" });
    expect(
      (
        await sql(
          "select detail->>'sourceDetail' as source_detail from public.role_candidate_events where role_candidate_id=(select id from public.role_candidates where role_id=$1)",
          [rid],
        )
      ).rows[0].source_detail,
    ).toBe("Upwork - August shortlist");
  });
  it("imports a typed active role field and rejects a stale custom key", async () => {
    const cid = await client();
    const rid = await role(cid);
    const fieldId = await asUser(actor, () =>
      rpc("add_role_field", [cid, rid, "Notice period", "number", JSON.stringify([])]),
    );
    const key = (await sql("select key from public.role_fields where id=$1", [fieldId])).rows[0]
      .key;
    await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("custom-import", { custom: { [key]: 30 } })]),
        "csv",
        "all_profiles",
      ]),
    );
    expect(
      (await sql("select custom from public.role_candidates where role_id=$1", [rid])).rows[0]
        .custom,
    ).toEqual({ [key]: 30 });
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("custom-import-invalid", { custom: { stale_column: "x" } })]),
        "csv",
        "all_profiles",
      ]),
    );
    expect(summary.invalid).toBe(1);
  });
  it("resolves a candidate already in the master database as matchedExisting, never duplicating it", async () => {
    const cid = await client();
    const rid = await role(cid);
    const existing = await person("bulk-existing");
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("bulk-existing")]),
        "csv",
        "all_profiles",
      ]),
    );
    expect(summary).toEqual({ created: 0, matchedExisting: 1, alreadyInRole: 0, invalid: 0, updated: 0, skipped: 0, rated: 0, flagged: 0, flaggedRows: [] });
    expect(
      (
        await sql("select candidate_id from public.role_candidates where role_id=$1", [rid])
      ).rows[0].candidate_id,
    ).toBe(existing);
  });
  it("counts a candidate already in this role without erroring or duplicating the row", async () => {
    const cid = await client();
    const rid = await role(cid);
    const first = await asUser(actor, () =>
      rpc("import_candidates", [cid, rid, JSON.stringify([linkedinRow("bulk-repeat")]), "linkedin", "all_profiles"]),
    );
    expect(first.created).toBe(1);
    const second = await asUser(actor, () =>
      rpc("import_candidates", [cid, rid, JSON.stringify([linkedinRow("bulk-repeat")]), "linkedin", "all_profiles"]),
    );
    expect(second).toEqual({ created: 0, matchedExisting: 0, alreadyInRole: 1, invalid: 0, updated: 0, skipped: 0, rated: 0, flagged: 0, flaggedRows: [] });
    expect(
      (await sql("select count(*)::int as n from public.role_candidates where role_id=$1", [rid]))
        .rows[0].n,
    ).toBe(1);
  });
  it("adds an existing master candidate to a role with the master database source", async () => {
    const cid = await client();
    const rid = await role(cid);
    const candidateId = await person("master-reuse");
    await expect(
      asUser(actor, () =>
        rpc("add_candidates_to_role", [cid, rid, [candidateId], "master_db"]),
      ),
    ).resolves.toEqual({ added: 1, alreadyInRole: 0 });
    expect(
      (await sql("select source from public.role_candidates where role_id=$1", [rid])).rows[0]
        .source,
    ).toBe("master_db");
  });
  it("dedupes two rows in the same batch that share an identity", async () => {
    const cid = await client();
    const rid = await role(cid);
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("same-batch"), linkedinRow("same-batch")]),
        "csv",
        "all_profiles",
      ]),
    );
    expect(summary).toEqual({ created: 1, matchedExisting: 0, alreadyInRole: 1, invalid: 0, updated: 0, skipped: 0, rated: 0, flagged: 0, flaggedRows: [] });
    expect(
      (await sql("select count(*)::int as n from public.role_candidates where role_id=$1", [rid]))
        .rows[0].n,
    ).toBe(1);
  });
  it("skips invalid rows and still imports the valid ones in the same batch", async () => {
    const cid = await client();
    const rid = await role(cid);
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([
          linkedinRow("valid-one"),
          { name: "", identities: [normalizeIdentity("linkedin", "https://www.linkedin.com/in/no-name")] },
          { name: "No identity" },
          { name: "Phone only", identities: [{ kind: "phone", value: "9000000002" }] },
          { name: "Bad kind", identities: [{ kind: "fax", value: "123" }] },
        ]),
        "csv",
        "all_profiles",
      ]),
    );
    expect(summary).toEqual({ created: 1, matchedExisting: 0, alreadyInRole: 0, invalid: 4, updated: 0, skipped: 0, rated: 0, flagged: 0, flaggedRows: [] });
  });
  // Only the profile URL says two rows are the same person. A shared inbox,
  // a colleague's address, a reused Naukri id: each of those used to be enough
  // to write one candidate's details over another's, quietly.
  it("hands back a row that matches only on an email rather than merging it", async () => {
    const cid = await client();
    const rid = await role(cid);
    const existing = await asUser(actor, () =>
      rpc("upsert_candidate", [
        "Priya Raman",
        JSON.stringify([
          normalizeIdentity("linkedin", "https://www.linkedin.com/in/priya-raman"),
          normalizeIdentity("email", "team@agency.com"),
        ]),
        JSON.stringify({ currentCompany: "Zoho" }),
      ]),
    );
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([
          {
            name: "Vikram Nair",
            identities: [
              normalizeIdentity("linkedin", "https://www.linkedin.com/in/vikram-nair"),
              normalizeIdentity("email", "team@agency.com"),
            ],
            fields: { currentCompany: "Freshworks" },
          },
        ]),
        "csv",
        "all_profiles",
      ]),
    );
    expect(summary).toMatchObject({ created: 0, matchedExisting: 0, invalid: 0, flagged: 1 });
    expect(summary.flaggedRows).toEqual([{ name: "Vikram Nair", matchedOn: "email" }]);
    // Nothing written: not over the person on file, and not as a new row.
    expect(
      (await sql("select current_company from public.candidates where id=$1", [existing]))
        .rows[0].current_company,
    ).toBe("Zoho");
    expect(
      (await sql("select count(*)::int as n from public.role_candidates where role_id=$1", [rid]))
        .rows[0].n,
    ).toBe(0);
  });
  it("still merges when the profile URL is the one already on file", async () => {
    const cid = await client();
    const rid = await role(cid);
    await person("same-profile", { currentCompany: "Zoho" });
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([
          linkedinRow("same-profile", { fields: { currentCompany: "Freshworks" } }),
        ]),
        "csv",
        "all_profiles",
      ]),
    );
    expect(summary).toMatchObject({ matchedExisting: 1, flagged: 0 });
  });
  it("treats a row spanning two existing candidates as invalid rather than merging them", async () => {
    const cid = await client();
    const rid = await role(cid);
    await person("merge-guard-a");
    await person("merge-guard-b");
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([
          {
            name: "Ambiguous",
            identities: [
              normalizeIdentity("linkedin", "https://www.linkedin.com/in/merge-guard-a"),
              normalizeIdentity("linkedin", "https://www.linkedin.com/in/merge-guard-b"),
            ],
          },
        ]),
        "linkedin",
        "all_profiles",
      ]),
    );
    expect(summary).toEqual({ created: 0, matchedExisting: 0, alreadyInRole: 0, invalid: 1, updated: 0, skipped: 0, rated: 0, flagged: 0, flaggedRows: [] });
  });
  it("never clears reusable contact data with a blank field on a bulk re-import", async () => {
    const cid = await client();
    const rid = await role(cid);
    await person("bulk-enriched", { phone: "9876500000" });
    await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("bulk-enriched", { fields: { phone: "" } })]),
        "linkedin",
        "all_profiles",
      ]),
    );
    expect(
      (
        await sql(
          "select c.phone from public.candidates c join public.candidate_identities i on i.candidate_id=c.id where i.kind='linkedin' and i.normalized_value=$1",
          ["https://www.linkedin.com/in/bulk-enriched"],
        )
      ).rows[0].phone,
    ).toBe("9876500000");
  });
  it("creates nobody when importing into a later stage", async () => {
    const cid = await client();
    const rid = await role(cid);
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("stage-target")]),
        "csv",
        "client_shortlisted",
      ]),
    );
    expect(summary).toEqual({ created: 0, matchedExisting: 0, alreadyInRole: 0, invalid: 0, updated: 0, skipped: 1, rated: 0, flagged: 0, flaggedRows: [] });
    expect(
      (await sql("select count(*)::int as n from public.role_candidates where role_id=$1", [rid]))
        .rows[0].n,
    ).toBe(0);
    // Nor was the shared person invented somewhere off to the side.
    expect(
      (
        await sql("select count(*)::int as n from public.candidate_identities where normalized_value=$1", [
          "https://www.linkedin.com/in/stage-target",
        ])
      ).rows[0].n,
    ).toBe(0);
  });
  it("skips someone who exists in the master database but is not on this role", async () => {
    const cid = await client();
    const rid = await role(cid);
    const otherRole = await role(cid);
    await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        otherRole,
        JSON.stringify([linkedinRow("stage-elsewhere")]),
        "csv",
        "all_profiles",
      ]),
    );
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([
          linkedinRow("stage-elsewhere", { fields: { location: "Chennai" } }),
        ]),
        "csv",
        "recruiter_shortlisted",
      ]),
    );
    expect(summary).toEqual({ created: 0, matchedExisting: 0, alreadyInRole: 0, invalid: 0, updated: 0, skipped: 1, rated: 0, flagged: 0, flaggedRows: [] });
    expect(
      (await sql("select count(*)::int as n from public.role_candidates where role_id=$1", [rid]))
        .rows[0].n,
    ).toBe(0);
    // Left entirely alone, not quietly enriched from another role's import.
    expect(
      (
        await sql(
          "select c.location from public.candidates c join public.candidate_identities i on i.candidate_id=c.id where i.normalized_value=$1",
          ["https://www.linkedin.com/in/stage-elsewhere"],
        )
      ).rows[0].location,
    ).toBe("");
  });
  it("updates someone already on the role, and the detail reaches every stage", async () => {
    const cid = await client();
    const rid = await role(cid);
    await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("stage-enrich")]),
        "csv",
        "all_profiles",
      ]),
    );
    const rcId = (
      await sql("select id from public.role_candidates where role_id=$1", [rid])
    ).rows[0].id;
    await sql("update public.role_candidates set stage='client_shortlisted' where id=$1", [rcId]);
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([
          linkedinRow("stage-enrich", {
            fields: { currentCtc: "55 LPA", location: "Pune" },
          }),
        ]),
        "csv",
        "client_shortlisted",
      ]),
    );
    expect(summary).toEqual({ created: 0, matchedExisting: 0, alreadyInRole: 0, invalid: 0, updated: 1, skipped: 0, rated: 0, flagged: 0, flaggedRows: [] });
    const row = (
      await sql(
        "select c.current_ctc,c.location from public.candidates c join public.candidate_identities i on i.candidate_id=c.id where i.normalized_value=$1",
        ["https://www.linkedin.com/in/stage-enrich"],
      )
    ).rows[0];
    expect(row.current_ctc).toBe("55 LPA");
    expect(row.location).toBe("Pune");
    // The stage is untouched, and no duplicate membership appeared.
    expect(
      (await sql("select stage from public.role_candidates where role_id=$1", [rid])).rows,
    ).toEqual([{ stage: "client_shortlisted" }]);
  });
  it("refuses a stage an import cannot fill in", async () => {
    const cid = await client();
    const rid = await role(cid);
    for (const stage of ["rejected", "invented", null]) {
      await expect(
        asUser(actor, () =>
          rpc("import_candidates", [
            cid,
            rid,
            JSON.stringify([linkedinRow("stage-bad")]),
            "csv",
            stage,
          ]),
        ),
      ).rejects.toThrow("pipeline stage");
    }
  });
  it("never moves someone backwards when All profiles re-imports them", async () => {
    const cid = await client();
    const rid = await role(cid);
    await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("stage-keep")]),
        "csv",
        "all_profiles",
      ]),
    );
    await sql("update public.role_candidates set stage='offer_sent' where role_id=$1", [rid]);
    const summary = await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([linkedinRow("stage-keep")]),
        "csv",
        "all_profiles",
      ]),
    );
    expect(summary).toEqual({ created: 0, matchedExisting: 0, alreadyInRole: 1, invalid: 0, updated: 0, skipped: 0, rated: 0, flagged: 0, flaggedRows: [] });
    expect(
      (await sql("select stage from public.role_candidates where role_id=$1", [rid])).rows[0].stage,
    ).toBe("offer_sent");
  });
  it("stores the CTC and qualification an import carries", async () => {
    const cid = await client();
    const rid = await role(cid);
    await asUser(actor, () =>
      rpc("import_candidates", [
        cid,
        rid,
        JSON.stringify([
          linkedinRow("stage-detail", {
            fields: { currentCtc: "42 LPA", highestQualification: "B.E. Computer Science" },
          }),
        ]),
        "csv",
        "all_profiles",
      ]),
    );
    const row = (
      await sql(
        "select c.current_ctc,c.highest_qualification from public.candidates c join public.candidate_identities i on i.candidate_id=c.id where i.normalized_value=$1",
        ["https://www.linkedin.com/in/stage-detail"],
      )
    ).rows[0];
    expect(row.current_ctc).toBe("42 LPA");
    expect(row.highest_qualification).toBe("B.E. Computer Science");
  });
});

describe("operator access: owner-only, and cannot lock the owner out", () => {
  // The harness seeds nobody as an owner, because ownership is seeded from a
  // real email the test database does not have. Each test grants it explicitly
  // so the refusal path is the default rather than the exception.
  async function withOwner<T>(owner: string, fn: () => Promise<T>): Promise<T> {
    await sql("update public.user_profiles set is_owner=true where id=$1", [owner]);
    try {
      return await fn();
    } finally {
      await sql("update public.user_profiles set is_owner=false where id=$1", [owner]);
    }
  }

  it("refuses an approved agency admin who is not the owner", async () => {
    await expect(
      asUser(actor, () => rpc("list_operators")),
    ).rejects.toThrow("Only the workspace owner");
    await expect(
      asUser(actor, () => rpc("set_operator_access", [outsider, true])),
    ).rejects.toThrow("Only the workspace owner");
  });

  it("refuses an account with no agency access at all", async () => {
    await expect(
      asUser(outsider, () => rpc("list_operators")),
    ).rejects.toThrow("Only the workspace owner");
  });

  it("lists every account for the owner, with its access", async () => {
    const rows = await withOwner(actor, () => asUser(actor, () => rpc("list_operators")));
    const emails = (rows as { email: string }[]).map((row) => row.email);
    expect(emails).toContain("actor@example.com");
    expect(emails).toContain("outsider@example.com");
    const self = (rows as { email: string; owner: boolean }[]).find(
      (row) => row.email === "actor@example.com",
    );
    expect(self?.owner).toBe(true);
  });

  it("grants and revokes another operator", async () => {
    await withOwner(actor, async () => {
      await asUser(actor, () => rpc("set_operator_access", [outsider, true]));
      expect(
        (await sql("select is_agency_admin from public.user_profiles where id=$1", [outsider]))
          .rows[0].is_agency_admin,
      ).toBe(true);
      await asUser(actor, () => rpc("set_operator_access", [outsider, false]));
      expect(
        (await sql("select is_agency_admin from public.user_profiles where id=$1", [outsider]))
          .rows[0].is_agency_admin,
      ).toBe(false);
    });
  });

  it("refuses to change the owner's own access, so the screen cannot lock itself", async () => {
    await withOwner(actor, async () => {
      await expect(
        asUser(actor, () => rpc("set_operator_access", [actor, false])),
      ).rejects.toThrow("your own access");
      expect(
        (await sql("select is_agency_admin from public.user_profiles where id=$1", [actor]))
          .rows[0].is_agency_admin,
      ).toBe(true);
    });
  });

  it("refuses to change any owner's access, not merely your own", async () => {
    await sql("update public.user_profiles set is_owner=true where id=$1", [outsider]);
    try {
      await withOwner(actor, async () => {
        await expect(
          asUser(actor, () => rpc("set_operator_access", [outsider, false])),
        ).rejects.toThrow("owner");
      });
    } finally {
      await sql("update public.user_profiles set is_owner=false where id=$1", [outsider]);
    }
  });

  it("refuses an operator id that does not exist", async () => {
    await withOwner(actor, async () => {
      await expect(
        asUser(actor, () => rpc("set_operator_access", [randomUUID(), true])),
      ).rejects.toThrow("no longer exists");
    });
  });
});

describe("rate_candidate: auto-advance out of All profiles only", () => {
  it("rejects an out-of-range rating", async () => {
    const { cid, rcId } = await pipeline("rate-range", 3);
    await expect(
      asUser(actor, () => rpc("rate_candidate", [cid, rcId, 6])),
    ).rejects.toThrow("0.0 to 5.0");
    await expect(
      asUser(actor, () => rpc("rate_candidate", [cid, rcId, -1])),
    ).rejects.toThrow("0.0 to 5.0");
  });
  it("fails for a candidate outside this client's scope", async () => {
    const { rcId } = await pipeline("rate-scope", 3);
    const other = await client();
    await expect(
      asUser(actor, () => rpc("rate_candidate", [other, rcId, 4])),
    ).rejects.toThrow("Candidate not found");
  });
  it("advances to Profile shortlisted the moment the rating meets the threshold", async () => {
    const { cid, rcId } = await pipeline("rate-meets", 3);
    await asUser(actor, () => rpc("rate_candidate", [cid, rcId, 4]));
    const row = (
      await sql(
        "select stage,rating,rated_by,threshold_at_rating from public.role_candidates where id=$1",
        [rcId],
      )
    ).rows[0];
    expect(row.stage).toBe("profile_shortlisted");
    expect(Number(row.rating)).toBe(4);
    expect(row.rated_by).toBe(actor);
    expect(Number(row.threshold_at_rating)).toBe(3);
    // rate_candidate always writes a rating event, then a stage event only
    // because this row was still in All profiles; add_candidates_to_role's
    // own import event from pipeline() setup is untouched alongside them.
    // Both events can share one now() timestamp within the same transaction,
    // so kind is asserted rather than a fragile created_at ordering.
    const events = await sql(
      "select kind,from_stage,to_stage from public.role_candidate_events where role_candidate_id=$1",
      [rcId],
    );
    expect(events.rows).toEqual(
      expect.arrayContaining([
        { kind: "import", from_stage: null, to_stage: "all_profiles" },
        { kind: "rating", from_stage: null, to_stage: null },
        { kind: "stage", from_stage: "all_profiles", to_stage: "profile_shortlisted" },
      ]),
    );
    expect(events.rows).toHaveLength(3);
  });
  it("stays in All profiles when the rating is below the threshold", async () => {
    const { cid, rcId } = await pipeline("rate-below", 3);
    await asUser(actor, () => rpc("rate_candidate", [cid, rcId, 2]));
    const belowThreshold = (
      await sql("select stage,rating from public.role_candidates where id=$1", [rcId])
    ).rows[0];
    expect(belowThreshold.stage).toBe("all_profiles");
    expect(Number(belowThreshold.rating)).toBe(2);
    expect(
      (
        await sql(
          "select count(*)::int as n from public.role_candidate_events where role_candidate_id=$1 and kind='stage'",
          [rcId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("never advances a candidate again once past All profiles, however high the rating", async () => {
    const { cid, rcId } = await pipeline("rate-past", 3);
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "recruiter_shortlisted", ""]));
    await asUser(actor, () => rpc("rate_candidate", [cid, rcId, 5]));
    const pastAllProfiles = (
      await sql("select stage,rating from public.role_candidates where id=$1", [rcId])
    ).rows[0];
    expect(pastAllProfiles.stage).toBe("recruiter_shortlisted");
    expect(Number(pastAllProfiles.rating)).toBe(5);
  });
  it("is a no-op when the rating does not actually change", async () => {
    const { cid, rcId } = await pipeline("rate-noop", 3);
    await asUser(actor, () => rpc("rate_candidate", [cid, rcId, 2]));
    const before = (
      await sql("select updated_at from public.role_candidates where id=$1", [rcId])
    ).rows[0].updated_at;
    await asUser(actor, () => rpc("rate_candidate", [cid, rcId, 2]));
    const after = (
      await sql("select updated_at from public.role_candidates where id=$1", [rcId])
    ).rows[0].updated_at;
    expect(after).toEqual(before);
    // One 'rating' event from the first call; the second, identical call
    // writes nothing more. pipeline() setup's own 'import' event is separate.
    expect(
      (
        await sql(
          "select count(*)::int as n from public.role_candidate_events where role_candidate_id=$1 and kind='rating'",
          [rcId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("clears rated_by and rated_at along with the rating itself", async () => {
    const { cid, rcId } = await pipeline("rate-clear", 3);
    await asUser(actor, () => rpc("rate_candidate", [cid, rcId, 2]));
    await asUser(actor, () => rpc("rate_candidate", [cid, rcId, null]));
    expect(
      (
        await sql(
          "select rating,rated_by,rated_at from public.role_candidates where id=$1",
          [rcId],
        )
      ).rows[0],
    ).toEqual({ rating: null, rated_by: null, rated_at: null });
  });
});

describe("reject_candidate: from Profile shortlisted onwards", () => {
  // A profile shortlisted on its rating and then found to be wrong is rejected
  // where it sits. All profiles is still refused: nothing has been judged yet.
  it("rejects from Profile shortlisted, recording who called it and why", async () => {
    const { cid, rcId } = await pipeline("reject-shortlisted", 3);
    await asUser(actor, () => rpc("rate_candidate", [cid, rcId, 4]));
    await asUser(actor, () =>
      rpc("reject_candidate", [cid, [rcId], "client", "Notice period too long"]),
    );
    const row = (
      await sql(
        "select stage,rejection_type,rejection_reason,rejected_by from public.role_candidates where id=$1",
        [rcId],
      )
    ).rows[0];
    expect(row).toEqual({
      stage: "rejected",
      rejection_type: "client",
      rejection_reason: "Notice period too long",
      rejected_by: actor,
    });
    const event = (
      await sql(
        "select from_stage,to_stage from public.role_candidate_events where role_candidate_id=$1 and kind='reject'",
        [rcId],
      )
    ).rows;
    expect(event).toEqual([
      { from_stage: "profile_shortlisted", to_stage: "rejected" },
    ]);
  });
  it("still refuses a candidate who is only in All profiles", async () => {
    const { cid, rcId } = await pipeline("reject-unrated", 3);
    await expect(
      asUser(actor, () =>
        rpc("reject_candidate", [cid, [rcId], "recruiter", "Not a fit"]),
      ),
    ).rejects.toThrow("from Profile shortlisted onwards");
  });
});

describe("apply_threshold: the only path that moves an already-rated candidate", () => {
  it("moves only All-profiles candidates whose rating already meets the current threshold", async () => {
    const cid = await client();
    const rid = await role(cid, 3);
    const meets = await person("threshold-meets");
    const below = await person("threshold-below");
    const unrated = await person("threshold-unrated");
    await asUser(actor, () =>
      rpc("add_candidates_to_role", [cid, rid, [meets, below, unrated], "linkedin"]),
    );
    const rows = await sql(
      "select id,candidate_id from public.role_candidates where role_id=$1",
      [rid],
    );
    const idFor = (candidateId: string) =>
      rows.rows.find((r) => r.candidate_id === candidateId)!.id as string;
    // Written directly rather than via rate_candidate, whose own auto-advance
    // would already move a qualifying row before apply_threshold ever runs.
    // This isolates apply_threshold's own filter from that other RPC.
    await sql("update public.role_candidates set rating=3 where id=$1", [idFor(meets)]);
    await sql("update public.role_candidates set rating=1 where id=$1", [idFor(below)]);
    const result = await asUser(actor, () => rpc("apply_threshold", [cid, rid]));
    expect(result).toEqual({ moved: 1 });
    const appliedThreshold = (
      await sql("select stage,threshold_at_rating from public.role_candidates where id=$1", [
        idFor(meets),
      ])
    ).rows[0];
    expect(appliedThreshold.stage).toBe("profile_shortlisted");
    expect(Number(appliedThreshold.threshold_at_rating)).toBe(3);
    expect(
      (await sql("select stage from public.role_candidates where id=$1", [idFor(below)]))
        .rows[0].stage,
    ).toBe("all_profiles");
    expect(
      (await sql("select stage from public.role_candidates where id=$1", [idFor(unrated)]))
        .rows[0].stage,
    ).toBe("all_profiles");
  });
  it("moves candidates that were rated before the threshold was raised, only when explicitly applied", async () => {
    const { cid, rid, rcId } = await pipeline("threshold-retroactive", 2);
    await asUser(actor, () => rpc("rate_candidate", [cid, rcId, 2]));
    expect(
      (await sql("select stage from public.role_candidates where id=$1", [rcId])).rows[0]
        .stage,
    ).toBe("profile_shortlisted");
    // Move back to all_profiles to simulate a candidate still sitting there
    // under the old, lower threshold once it is raised.
    await sql(
      "update public.role_candidates set stage='all_profiles',rejection_type=null,rejection_reason='' where id=$1",
      [rcId],
    );
    await asUser(actor, () => rpc("save_role", [rid, cid, "Threshold retro", "", 5, "open", 1]));
    expect(
      (await sql("select stage from public.role_candidates where id=$1", [rcId])).rows[0]
        .stage,
    ).toBe("all_profiles");
    const first = await asUser(actor, () => rpc("apply_threshold", [cid, rid]));
    expect(first).toEqual({ moved: 0 });
    await asUser(actor, () => rpc("save_role", [rid, cid, "Threshold retro", "", 2, "open", 2]));
    const second = await asUser(actor, () => rpc("apply_threshold", [cid, rid]));
    expect(second).toEqual({ moved: 1 });
    // Distinct from the earlier auto-advance's own "met the threshold" event:
    // this one specifically confirms apply_threshold, not rate_candidate,
    // performed this move.
    expect(
      (
        await sql(
          "select count(*)::int as n from public.role_candidate_events where role_candidate_id=$1 and kind='stage' and reason='Rating floor applied to existing manual ratings.'",
          [rcId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("fails for a role outside this client or that does not exist", async () => {
    const cid = await client();
    const other = await client();
    const rid = await role(other);
    await expect(
      asUser(actor, () => rpc("apply_threshold", [cid, rid])),
    ).rejects.toThrow("Role not found");
  });
});

describe("save_screening: recruiter screening answers and internal notes", () => {
  it("denies a non-admin", async () => {
    const { cid, rcId } = await pipeline("screen-denied", 3);
    await expect(
      asUser(outsider, () =>
        rpc("save_screening", [cid, rcId, JSON.stringify({ interest: "yes" }), "note"]),
      ),
    ).rejects.toThrow("Agency access");
  });
  it("saves screening and internal notes together and logs one event", async () => {
    const { cid, rcId } = await pipeline("screen-save", 3);
    await asUser(actor, () =>
      rpc("save_screening", [
        cid,
        rcId,
        JSON.stringify({ interest: "yes", currentCtc: "12 LPA" }),
        "Strong communicator.",
      ]),
    );
    const row = (
      await sql("select screening,internal_notes from public.role_candidates where id=$1", [
        rcId,
      ])
    ).rows[0];
    expect(row).toEqual({
      screening: { interest: "yes", currentCtc: "12 LPA" },
      internal_notes: "Strong communicator.",
    });
    expect(
      (
        await sql(
          "select count(*)::int as n from public.role_candidate_events where role_candidate_id=$1 and kind='screening'",
          [rcId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("mirrors a valid follow-up date into the indexed queue field", async () => {
    const { cid, rcId } = await pipeline("screen-follow-up", 3);
    await asUser(actor, () =>
      rpc("save_screening", [
        cid,
        rcId,
        JSON.stringify({ interest: "maybe", followUpAt: "2026-09-22" }),
        "Call after their notice period.",
      ]),
    );
    const savedScreening = (
      await sql(
        "select follow_up_at::text as follow_up_at,screening from public.role_candidates where id=$1",
        [rcId],
      )
    ).rows[0];
    expect(savedScreening.follow_up_at).toBe("2026-09-22");
    expect(savedScreening.screening).toEqual({ interest: "maybe", followUpAt: "2026-09-22" });
    await asUser(actor, () =>
      rpc("save_screening", [cid, rcId, JSON.stringify({ followUpAt: "" }), ""]),
    );
    expect(
      (
        await sql("select follow_up_at from public.role_candidates where id=$1", [rcId])
      ).rows[0].follow_up_at,
    ).toBeNull();
    await expect(
      asUser(actor, () =>
        rpc(
          "save_screening",
          [cid, rcId, JSON.stringify({ followUpAt: "not-a-date" }), ""],
        ),
      ),
    ).rejects.toThrow("Choose a valid follow-up date");
  });
  it("rejects a non-object screening payload and an oversized note", async () => {
    const { cid, rcId } = await pipeline("screen-invalid", 3);
    await expect(
      asUser(actor, () => rpc("save_screening", [cid, rcId, JSON.stringify(["not an object"]), ""])),
    ).rejects.toThrow("Invalid screening data");
    await expect(
      asUser(actor, () =>
        rpc("save_screening", [cid, rcId, "{}", "x".repeat(4001)]),
      ),
    ).rejects.toThrow("Shorten the internal note");
  });
  it("cannot reach a candidate outside this client", async () => {
    const { rcId } = await pipeline("screen-scope", 3);
    const other = await client();
    await expect(
      asUser(actor, () => rpc("save_screening", [other, rcId, "{}", ""])),
    ).rejects.toThrow("Candidate not found");
  });
});

describe("candidate notes and offer details", () => {
  it("saves the recruiter client note, scopes it to the client, and logs the change", async () => {
    const { cid, rcId } = await pipeline("client-note-save", 3);
    await asUser(actor, () =>
      rpc("save_client_note", [cid, rcId, "  Strong stakeholder feedback.  "]),
    );
    const row = (
      await sql("select client_notes from public.role_candidates where id=$1", [rcId])
    ).rows[0];
    expect(row.client_notes).toBe("Strong stakeholder feedback.");
    expect(
      (
        await sql(
          "select count(*)::int as n from public.role_candidate_events where role_candidate_id=$1 and kind='client_note'",
          [rcId],
        )
      ).rows[0].n,
    ).toBe(1);
    const other = await client();
    await expect(
      asUser(actor, () => rpc("save_client_note", [other, rcId, "Wrong client"])),
    ).rejects.toThrow("Candidate not found");
  });

  it("denies client-note updates to a non-admin", async () => {
    const { cid, rcId } = await pipeline("client-note-denied", 3);
    await expect(
      asUser(outsider, () => rpc("save_client_note", [cid, rcId, "No access"])),
    ).rejects.toThrow("Agency access");
  });

  it("allows the authenticated wrapper to save offer details", async () => {
    const { cid, rcId } = await pipeline("offer-save-permission", 3);
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "offer_sent", "Offer sent"]));
    await asUser(actor, () =>
      rpc("save_offer_details", [
        cid,
        rcId,
        125000,
        "inr",
        "2026-09-18",
        "2026-09-25",
        "2026-10-01",
        "Awaiting response.",
      ]),
    );
    const row = (
      await sql(
        "select offer_amount::text,offer_currency,offer_response_due_at::text,offer_notes from public.role_candidates where id=$1",
        [rcId],
      )
    ).rows[0];
    expect(row).toEqual({
      offer_amount: "125000.00",
      offer_currency: "INR",
      offer_response_due_at: "2026-09-25",
      offer_notes: "Awaiting response.",
    });
  });
});

describe("update_candidate_details: correcting the reusable master record", () => {
  it("denies a non-admin", async () => {
    const id = await person("edit-denied");
    await expect(
      asUser(outsider, () =>
        rpc("update_candidate_details", [id, "New Name", "", "", "", "", null, null, null, null]),
      ),
    ).rejects.toThrow("Agency access");
  });
  it("updates every editable field, including clearing phone and email", async () => {
    const id = await person("edit-full", { phone: "9876500000", email: "old@example.com" });
    await asUser(actor, () =>
      rpc("update_candidate_details", [
        id,
        "Corrected Name",
        "Staff engineer",
        "Newco",
        "Principal engineer",
        "Bengaluru",
        9.5,
        null,
        null,
        null,
      ]),
    );
    expect(
      (
        await sql(
          "select full_name,headline,current_company,current_designation,location,total_experience_years,phone,email from public.candidates where id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({
      full_name: "Corrected Name",
      headline: "Staff engineer",
      current_company: "Newco",
      current_designation: "Principal engineer",
      location: "Bengaluru",
      total_experience_years: "9.5",
      phone: null,
      email: null,
    });
  });
  it("lets the authenticated wrapper save the candidate LinkedIn identity", async () => {
    const id = await person("edit-linkedin-permission");
    await expect(
      asUser(actor, () =>
        rpc("set_candidate_linkedin", [
          id,
          "https://www.linkedin.com/in/edit-linkedin-permission",
        ]),
      ),
    ).resolves.toBeDefined();
  });
  it("rejects a blank name, an out-of-range experience, and an invalid email", async () => {
    const id = await person("edit-invalid");
    await expect(
      asUser(actor, () => rpc("update_candidate_details", [id, "  ", "", "", "", "", null, null, null, null])),
    ).rejects.toThrow("Enter a candidate name");
    await expect(
      asUser(actor, () =>
        rpc("update_candidate_details", [id, "Name", "", "", "", "", 71, null, null, null]),
      ),
    ).rejects.toThrow("between 0 and 70");
    await expect(
      asUser(actor, () =>
        rpc("update_candidate_details", [id, "Name", "", "", "", "", null, null, null, "not-an-email"]),
      ),
    ).rejects.toThrow("valid email");
    await expect(
      asUser(actor, () =>
        rpc("update_candidate_details", [id, "Name", "", "", "", "", null, "541354", null, null]),
      ),
    ).rejects.toThrow("10 digit");
    await expect(
      sql("update public.candidates set phone='not-a-phone' where id=$1", [id]),
    ).rejects.toThrow("10 digit mobile");
    // The trigger also refuses a second number that repeats the first.
    await expect(
      sql("update public.candidates set phone='9876543210',alternate_phone='9876543210' where id=$1", [id]),
    ).rejects.toThrow("same as the primary");
  });
  it("stores email in a consistent lowercase format", async () => {
    const id = await person("edit-email-normalized");
    await asUser(actor, () =>
      rpc("update_candidate_details", [
        id,
        "Name",
        "",
        "",
        "",
        "",
        null,
        "9876543210",
        null,
        "Recruiter@Example.COM",
      ]),
    );
    expect(
      (await sql("select phone,email from public.candidates where id=$1", [id])).rows[0],
    ).toEqual({ phone: "9876543210", email: "recruiter@example.com" });
  });
  it("fails for a candidate that does not exist", async () => {
    await expect(
      asUser(actor, () =>
        rpc("update_candidate_details", [
          randomUUID(),
          "Name",
          "",
          "",
          "",
          "",
          null,
          null,
          null,
          null,
        ]),
      ),
    ).rejects.toThrow("Candidate not found");
  });
});

describe("save_resume_path: recording where an uploaded resume landed", () => {
  it("denies a non-admin", async () => {
    const id = await person("resume-denied");
    await expect(
      asUser(outsider, () => rpc("save_resume_path", [id, `${id}/1.pdf`])),
    ).rejects.toThrow("Agency access");
  });
  it("sets and clears the resume reference", async () => {
    const id = await person("resume-set");
    await asUser(actor, () => rpc("save_resume_path", [id, `${id}/1700000000000.pdf`]));
    expect(
      (await sql("select resume_path from public.candidates where id=$1", [id])).rows[0]
        .resume_path,
    ).toBe(`${id}/1700000000000.pdf`);
    await asUser(actor, () => rpc("save_resume_path", [id, ""]));
    expect(
      (await sql("select resume_path from public.candidates where id=$1", [id])).rows[0]
        .resume_path,
    ).toBeNull();
  });
  it("fails for a candidate that does not exist", async () => {
    await expect(
      asUser(actor, () => rpc("save_resume_path", [randomUUID(), "x/1.pdf"])),
    ).rejects.toThrow("Candidate not found");
  });
});

async function field(
  cid: string,
  rid: string,
  label: string,
  kind = "text",
  options: string[] = [],
) {
  return asUser(actor, () => rpc("add_role_field", [cid, rid, label, kind, JSON.stringify(options)]));
}

describe("add_role_field: role-level custom column definitions", () => {
  it("denies a non-admin", async () => {
    const cid = await client();
    const rid = await role(cid);
    await expect(
      asUser(outsider, () => rpc("add_role_field", [cid, rid, "Visa status", "text", "[]"])),
    ).rejects.toThrow("Agency access");
  });
  it("derives a stable key from the label", async () => {
    const cid = await client();
    const rid = await role(cid);
    const id = await field(cid, rid, "Visa Status!!", "text");
    expect(
      (await sql("select key,label,kind from public.role_fields where id=$1", [id])).rows[0],
    ).toEqual({ key: "visa_status", label: "Visa Status!!", kind: "text" });
  });
  it("appends a numeric suffix when two columns share a label", async () => {
    const cid = await client();
    const rid = await role(cid);
    const first = await field(cid, rid, "Notes");
    const second = await field(cid, rid, "Notes");
    const keys = (
      await sql("select key from public.role_fields where id=any($1) order by key", [
        [first, second],
      ])
    ).rows.map((r) => r.key);
    expect(keys).toEqual(["notes", "notes_2"]);
  });
  it("requires at least one option for a dropdown column", async () => {
    const cid = await client();
    const rid = await role(cid);
    await expect(
      asUser(actor, () => rpc("add_role_field", [cid, rid, "Stage", "select", "[]"])),
    ).rejects.toThrow("between 1 and 20 options");
  });
  it("rejects an invalid kind, a blank label, and an archived or foreign role", async () => {
    const cid = await client();
    const other = await client();
    const rid = await role(cid);
    await expect(
      asUser(actor, () => rpc("add_role_field", [cid, rid, "X", "currency", "[]"])),
    ).rejects.toThrow("valid column type");
    await expect(
      asUser(actor, () => rpc("add_role_field", [cid, rid, "  ", "text", "[]"])),
    ).rejects.toThrow("Enter a column name");
    await expect(
      asUser(actor, () => rpc("add_role_field", [other, rid, "X", "text", "[]"])),
    ).rejects.toThrow("Restore this role");
    await asUser(actor, () => rpc("archive_role", [rid, true]));
    await expect(
      asUser(actor, () => rpc("add_role_field", [cid, rid, "X", "text", "[]"])),
    ).rejects.toThrow("Restore this role");
  });
  it("caps a role at 30 active custom columns", async () => {
    const cid = await client();
    const rid = await role(cid);
    for (let i = 0; i < 30; i++) await field(cid, rid, `Field ${i}`);
    await expect(field(cid, rid, "One too many")).rejects.toThrow("maximum of 30");
  });
});

describe("archive_role_field: hides a column without touching stored values", () => {
  it("fails for a column that does not exist", async () => {
    await expect(
      asUser(actor, () => rpc("archive_role_field", [randomUUID(), true])),
    ).rejects.toThrow("Custom column not found");
  });
  it("stops accepting new values once archived, without clearing what is already saved", async () => {
    const { cid, rid, rcId } = await pipeline("field-archive", 3);
    const id = await field(cid, rid, "Visa status");
    const key = (await sql("select key from public.role_fields where id=$1", [id])).rows[0].key;
    await asUser(actor, () => rpc("save_custom_field", [cid, rcId, key, JSON.stringify("Valid")]));
    await asUser(actor, () => rpc("archive_role_field", [id, true]));
    await expect(
      asUser(actor, () => rpc("save_custom_field", [cid, rcId, key, JSON.stringify("Changed")])),
    ).rejects.toThrow("no longer exists");
    expect(
      (await sql("select custom from public.role_candidates where id=$1", [rcId])).rows[0]
        .custom,
    ).toEqual({ [key]: "Valid" });
  });
});

describe("save_custom_field: one cell, one save, validated per column type", () => {
  it("denies a non-admin", async () => {
    const { cid, rid, rcId } = await pipeline("field-denied", 3);
    const id = await field(cid, rid, "Note");
    const key = (await sql("select key from public.role_fields where id=$1", [id])).rows[0].key;
    await expect(
      asUser(outsider, () => rpc("save_custom_field", [cid, rcId, key, JSON.stringify("x")])),
    ).rejects.toThrow("Agency access");
  });
  it("saves a value for every column type and validates its shape", async () => {
    const { cid, rid, rcId } = await pipeline("field-types", 3);
    const textId = await field(cid, rid, "Note", "text");
    const numberId = await field(cid, rid, "Score", "number");
    const boolId = await field(cid, rid, "Willing to relocate", "boolean");
    const selectId = await field(cid, rid, "Priority", "select", ["High", "Low"]);
    const keys = Object.fromEntries(
      (
        await sql("select id,key from public.role_fields where id=any($1)", [
          [textId, numberId, boolId, selectId],
        ])
      ).rows.map((r) => [r.id, r.key]),
    );
    await asUser(actor, () =>
      rpc("save_custom_field", [cid, rcId, keys[textId], JSON.stringify("Looks strong")]),
    );
    await asUser(actor, () => rpc("save_custom_field", [cid, rcId, keys[numberId], JSON.stringify(8)]));
    await asUser(actor, () =>
      rpc("save_custom_field", [cid, rcId, keys[boolId], JSON.stringify(true)]),
    );
    await asUser(actor, () =>
      rpc("save_custom_field", [cid, rcId, keys[selectId], JSON.stringify("High")]),
    );
    expect(
      (await sql("select custom from public.role_candidates where id=$1", [rcId])).rows[0]
        .custom,
    ).toEqual({
      [keys[textId]]: "Looks strong",
      [keys[numberId]]: 8,
      [keys[boolId]]: true,
      [keys[selectId]]: "High",
    });
    await expect(
      asUser(actor, () =>
        rpc("save_custom_field", [cid, rcId, keys[numberId], JSON.stringify("not a number")]),
      ),
    ).rejects.toThrow("Enter a number");
    await expect(
      asUser(actor, () =>
        rpc("save_custom_field", [cid, rcId, keys[boolId], JSON.stringify("yes")]),
      ),
    ).rejects.toThrow("Choose yes or no");
  });
  it("removes the key entirely when cleared, rather than storing a null", async () => {
    const { cid, rid, rcId } = await pipeline("field-clear", 3);
    const id = await field(cid, rid, "Note");
    const key = (await sql("select key from public.role_fields where id=$1", [id])).rows[0].key;
    await asUser(actor, () => rpc("save_custom_field", [cid, rcId, key, JSON.stringify("x")]));
    await asUser(actor, () => rpc("save_custom_field", [cid, rcId, key, null]));
    expect(
      (await sql("select custom from public.role_candidates where id=$1", [rcId])).rows[0]
        .custom,
    ).toEqual({});
  });
  it("fails for a column key this role never defined", async () => {
    const { cid, rcId } = await pipeline("field-unknown", 3);
    await expect(
      asUser(actor, () => rpc("save_custom_field", [cid, rcId, "made_up_key", JSON.stringify("x")])),
    ).rejects.toThrow("no longer exists");
  });
  it("cannot reach a candidate outside this client, even with a same-named column", async () => {
    const { rcId } = await pipeline("field-scope", 3);
    const other = await client();
    const id = await field(other, await role(other), "Note");
    const key = (await sql("select key from public.role_fields where id=$1", [id])).rows[0].key;
    // The lookup joins role_candidates scoped by client_id, so a role_candidate
    // from a different client is invisible here regardless of whether some
    // field with a matching key happens to exist in the caller's own client.
    await expect(
      asUser(actor, () => rpc("save_custom_field", [other, rcId, key, JSON.stringify("x")])),
    ).rejects.toThrow("no longer exists");
  });
  it("survives a stage move unchanged, by construction", async () => {
    const { cid, rid, rcId } = await pipeline("field-persist", 3);
    const id = await field(cid, rid, "Note");
    const key = (await sql("select key from public.role_fields where id=$1", [id])).rows[0].key;
    await asUser(actor, () => rpc("save_custom_field", [cid, rcId, key, JSON.stringify("Persisted")]));
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "recruiter_shortlisted", ""]));
    expect(
      (await sql("select custom from public.role_candidates where id=$1", [rcId])).rows[0]
        .custom,
    ).toEqual({ [key]: "Persisted" });
  });
});

function hashOf(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function freshToken() {
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  return { token, hash: hashOf(token), prefix: token.slice(0, 8) };
}
// The RPC no longer generates or returns a token: the app does that in Node
// (see route.ts), matching what this test does here for exactly the same
// reason (see the migration's own comment on create_share_link).
async function shareLink(
  cid: string,
  rid: string,
  stage: string,
  visible: string[],
  overrides: { editable?: string[]; expiresAt?: string | null; allowDecisions?: boolean } = {},
) {
  const { token, hash, prefix } = freshToken();
  const id = await asUser(actor, () =>
    rpc("create_share_link", [
      cid,
      rid,
      stage,
      visible,
      overrides.editable ?? [],
      overrides.expiresAt ?? null,
      hash,
      prefix,
      overrides.allowDecisions ?? false,
    ]),
  );
  return { id: id as string, token };
}

describe.skip("legacy flexible share-link behaviour", () => {
  it("grants authenticated read-only access, matching every other recruiting table", async () => {
    const grants = await sql(
      "select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='role_share_links' and grantee='authenticated'",
    );
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(["SELECT"]);
  });
  it("denies anon every table read", async () => {
    await sql("begin");
    await sql("set local role anon");
    await expect(sql("select * from public.role_share_links")).rejects.toThrow();
    await sql("rollback");
  });
  it("denies anon execute on every recruiting share function", async () => {
    await sql("begin");
    await sql("set local role anon");
    await expect(
      sql(
        "select public.create_share_link(null,null,'all_profiles',array['full_name'],array[]::text[],null,repeat('a',64),'aaaaaaaa')",
      ),
    ).rejects.toThrow();
    await expect(sql("select public.revoke_share_link(null)")).rejects.toThrow();
    await expect(
      sql("select public.regenerate_share_link(null,repeat('a',64),'aaaaaaaa')"),
    ).rejects.toThrow();
    await expect(sql("select public.read_shared_stage('x')")).rejects.toThrow();
    await expect(
      sql("select public.write_shared_cell('x',null,'client_notes','\"x\"'::jsonb)"),
    ).rejects.toThrow();
    await expect(
      sql("select public.write_client_decision('x',null,'shortlisted','')"),
    ).rejects.toThrow();
    await sql("rollback");
  });
  it("denies a logged-in operator execute on read_shared_stage: it is service_role only", async () => {
    const { cid, rid, rcId } = await pipeline("share-authenticated-denied", 0);
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "client_shortlisted", ""]));
    const { token } = await shareLink(cid, rid, "client_shortlisted", ["full_name"]);
    await expect(
      asUser(actor, () => rpc("read_shared_stage", [hashOf(token)])),
    ).rejects.toThrow();
  });
  it("denies a logged-in operator execute on write_shared_cell: it is service_role only", async () => {
    const { cid, rid, rcId } = await pipeline("share-write-authenticated-denied", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name", "client_notes"], {
      editable: ["client_notes"],
    });
    await expect(
      asUser(actor, () =>
        rpc("write_shared_cell", [hashOf(token), rcId, "client_notes", JSON.stringify("x")]),
      ),
    ).rejects.toThrow();
  });
  it("denies a logged-in operator execute on write_client_decision: it is service_role only", async () => {
    const { cid, rid, rcId } = await pipeline("share-decision-authenticated-denied", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name"], {
      allowDecisions: true,
    });
    await expect(
      asUser(actor, () => rpc("write_client_decision", [hashOf(token), rcId, "shortlisted", ""])),
    ).rejects.toThrow();
  });
});

describe.skip("legacy flexible share creation", () => {
  it("denies a non-admin", async () => {
    const cid = await client();
    const rid = await role(cid);
    await expect(
      asUser(outsider, () => {
        const fresh = freshToken();
        return rpc("create_share_link", [
          cid,
          rid,
          "all_profiles",
          ["full_name"],
          [],
          null,
          fresh.hash,
          fresh.prefix,
        ]);
      }),
    ).rejects.toThrow("Agency access");
  });
  it("defaults allow_decisions to false, and persists true when requested", async () => {
    const cid = await client();
    const rid = await role(cid);
    const plain = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    expect(
      (await sql("select allow_decisions from public.role_share_links where id=$1", [plain.id]))
        .rows[0].allow_decisions,
    ).toBe(false);
    const withDecisions = await shareLink(cid, rid, "profile_shortlisted", ["full_name"], {
      allowDecisions: true,
    });
    expect(
      (
        await sql("select allow_decisions from public.role_share_links where id=$1", [
          withDecisions.id,
        ])
      ).rows[0].allow_decisions,
    ).toBe(true);
  });
  it("refuses internal_notes as visible or editable, from the RPC and from the table itself", async () => {
    const cid = await client();
    const rid = await role(cid);
    await expect(
      shareLink(cid, rid, "all_profiles", ["full_name", "internal_notes"]),
    ).rejects.toThrow("Internal notes can never be shared");
    await expect(
      asUser(actor, () => {
        const fresh = freshToken();
        return rpc("create_share_link", [
          cid,
          rid,
          "all_profiles",
          ["full_name"],
          ["internal_notes"],
          null,
          fresh.hash,
          fresh.prefix,
        ]);
      }),
    ).rejects.toThrow("Internal notes can never be shared");
    // Direct privileged insert, bypassing the RPC entirely: the CHECK
    // constraint is the actual backstop, not just application logic.
    await expect(
      sql(
        "insert into public.role_share_links(client_id,role_id,stage,token_hash,token_prefix,visible_columns) values($1,$2,'all_profiles',repeat('x',64),'aaaaaaaa',array['internal_notes'])",
        [cid, rid],
      ),
    ).rejects.toThrow();
  });
  it("requires at least one visible column and rejects an unknown one", async () => {
    const cid = await client();
    const rid = await role(cid);
    await expect(shareLink(cid, rid, "all_profiles", [])).rejects.toThrow(
      "Choose at least one column",
    );
    await expect(
      shareLink(cid, rid, "all_profiles", ["not_a_real_column"]),
    ).rejects.toThrow("not available for this role");
  });
  it("accepts an active custom field key for this role", async () => {
    const cid = await client();
    const rid = await role(cid);
    const fid = await asUser(actor, () =>
      rpc("add_role_field", [cid, rid, "Visa status", "text", "[]"]),
    );
    const key = (await sql("select key from public.role_fields where id=$1", [fid])).rows[0].key;
    const { id } = await shareLink(cid, rid, "all_profiles", ["full_name", key]);
    expect(
      (await sql("select visible_columns from public.role_share_links where id=$1", [id]))
        .rows[0].visible_columns,
    ).toEqual(["full_name", key]);
  });
  it("requires an editable column to already be visible, from the RPC and from the table", async () => {
    const cid = await client();
    const rid = await role(cid);
    await expect(
      asUser(actor, () => {
        const fresh = freshToken();
        return rpc("create_share_link", [
          cid,
          rid,
          "all_profiles",
          ["full_name"],
          ["client_notes"],
          null,
          fresh.hash,
          fresh.prefix,
        ]);
      }),
    ).rejects.toThrow("must be visible");
    await expect(
      sql(
        "insert into public.role_share_links(client_id,role_id,stage,token_hash,token_prefix,visible_columns,editable_columns) values($1,$2,'all_profiles',repeat('y',64),'bbbbbbbb',array['full_name'],array['client_notes'])",
        [cid, rid],
      ),
    ).rejects.toThrow();
  });
  it("refuses client_decision and any static candidate field as editable, even when visible", async () => {
    const cid = await client();
    const rid = await role(cid);
    await expect(
      asUser(actor, () => {
        const fresh = freshToken();
        return rpc("create_share_link", [
          cid,
          rid,
          "all_profiles",
          ["full_name", "client_decision"],
          ["client_decision"],
          null,
          fresh.hash,
          fresh.prefix,
        ]);
      }),
    ).rejects.toThrow("cannot be made editable");
    await expect(
      asUser(actor, () => {
        const fresh = freshToken();
        return rpc("create_share_link", [
          cid,
          rid,
          "all_profiles",
          ["full_name"],
          ["full_name"],
          null,
          fresh.hash,
          fresh.prefix,
        ]);
      }),
    ).rejects.toThrow("cannot be made editable");
  });
  it("accepts client_notes, interview_at, and an active custom field as editable", async () => {
    const cid = await client();
    const rid = await role(cid);
    const fid = await asUser(actor, () =>
      rpc("add_role_field", [cid, rid, "Notice period", "text", "[]"]),
    );
    const key = (await sql("select key from public.role_fields where id=$1", [fid])).rows[0].key;
    const { id } = await shareLink(
      cid,
      rid,
      "all_profiles",
      ["client_notes", "interview_at", key],
      { editable: ["client_notes", "interview_at", key] },
    );
    expect(
      (await sql("select editable_columns from public.role_share_links where id=$1", [id]))
        .rows[0].editable_columns.sort(),
    ).toEqual(["client_notes", "interview_at", key].sort());
  });
  it("rejects an invalid stage and a role from another client", async () => {
    const cid = await client();
    const other = await client();
    const rid = await role(cid);
    await expect(
      shareLink(cid, rid, "master_db", ["full_name"]),
    ).rejects.toThrow("valid pipeline stage");
    await expect(
      shareLink(other, rid, "all_profiles", ["full_name"]),
    ).rejects.toThrow("Role not found");
  });
  it("stores only the hash and prefix it is given, never the raw token", async () => {
    const cid = await client();
    const rid = await role(cid);
    const { id, token } = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    const stored = (
      await sql("select token_hash,token_prefix from public.role_share_links where id=$1", [id])
    ).rows[0];
    expect(stored.token_hash).not.toBe(token);
    expect(stored.token_hash).toBe(hashOf(token));
    expect(stored.token_prefix).toBe(token.slice(0, 8));
  });
  it("rejects a malformed hash or prefix", async () => {
    const cid = await client();
    const rid = await role(cid);
    await expect(
      asUser(actor, () =>
        rpc("create_share_link", [cid, rid, "all_profiles", ["full_name"], [], null, "too-short", "aaaaaaaa"]),
      ),
    ).rejects.toThrow("Invalid share token");
    await expect(
      asUser(actor, () =>
        rpc("create_share_link", [cid, rid, "all_profiles", ["full_name"], [], null, "a".repeat(64), "short"]),
      ),
    ).rejects.toThrow("Invalid share token");
  });
});

describe.skip("legacy flexible share projection", () => {
  it("projects only the requested columns as keys, never anything else", async () => {
    const { cid, rid, rcId } = await pipeline("share-projection", 0);
    await asUser(actor, () =>
      rpc("save_screening", [cid, rcId, "{}", "Never shown to a client."]),
    );
    const candidateId = (
      await sql("select candidate_id from public.role_candidates where id=$1", [rcId])
    ).rows[0].candidate_id;
    await asUser(actor, () =>
      rpc("update_candidate_details", [
        candidateId,
        "Priya Nair",
        "Senior engineer",
        "Zetaflow",
        "Staff engineer",
        "Chennai",
        7,
        "9876500000",
        null,
        "priya@example.com",
      ]),
    );
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name", "location"]);
    const result = await rpc("read_shared_stage", [hashOf(token)]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(Object.keys(row).sort()).toEqual(["full_name", "id", "location"]);
    expect(row.full_name).toBe("Priya Nair");
    expect(row.location).toBe("Chennai");
    expect(JSON.stringify(result)).not.toContain("Never shown to a client");
    expect(JSON.stringify(result)).not.toContain("headline");
    expect(JSON.stringify(result)).not.toContain("zetaflow");
    expect(JSON.stringify(result)).not.toContain("919876500000");
  });
  it("includes a custom field's value and definition only when it is visible", async () => {
    const { cid, rid, rcId } = await pipeline("share-custom", 0);
    const fid = await asUser(actor, () =>
      rpc("add_role_field", [cid, rid, "Notice period", "text", "[]"]),
    );
    const key = (await sql("select key from public.role_fields where id=$1", [fid])).rows[0].key;
    await asUser(actor, () => rpc("save_custom_field", [cid, rcId, key, JSON.stringify("30 days")]));
    const hiddenLink = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    const hidden = await rpc("read_shared_stage", [hashOf(hiddenLink.token)]);
    expect(hidden.fields).toEqual([]);
    expect(hidden.rows[0].custom).toBeUndefined();
    const visibleLink = await shareLink(cid, rid, "all_profiles", ["full_name", key]);
    const visible = await rpc("read_shared_stage", [hashOf(visibleLink.token)]);
    expect(visible.fields).toEqual([{ key, label: "Notice period", kind: "text", options: [] }]);
    expect(visible.rows[0].custom).toEqual({ [key]: "30 days" });
  });
  it("only returns candidates actually in the shared stage", async () => {
    const { cid, rid, rcId } = await pipeline("share-stage-scope", 0);
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "recruiter_shortlisted", ""]));
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    const result = await rpc("read_shared_stage", [hashOf(token)]);
    expect(result.rows).toEqual([]);
  });
  it("denies a revoked link", async () => {
    const cid = await client();
    const rid = await role(cid);
    const { id, token } = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    await asUser(actor, () => rpc("revoke_share_link", [id]));
    await expect(rpc("read_shared_stage", [hashOf(token)])).rejects.toThrow("revoked");
  });
  it("denies an expired link", async () => {
    const cid = await client();
    const rid = await role(cid);
    const { id, token } = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    await sql("update public.role_share_links set expires_at=now()-interval '1 day' where id=$1", [
      id,
    ]);
    await expect(rpc("read_shared_stage", [hashOf(token)])).rejects.toThrow("expired");
  });
  it("denies a token that does not exist", async () => {
    await expect(
      rpc("read_shared_stage", [hashOf("guessed-token-that-was-never-issued")]),
    ).rejects.toThrow("no longer valid");
  });
  it("records that the link was viewed", async () => {
    const cid = await client();
    const rid = await role(cid);
    const { id, token } = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    expect(
      (await sql("select last_viewed_at from public.role_share_links where id=$1", [id])).rows[0]
        .last_viewed_at,
    ).toBeNull();
    await rpc("read_shared_stage", [hashOf(token)]);
    expect(
      (await sql("select last_viewed_at from public.role_share_links where id=$1", [id])).rows[0]
        .last_viewed_at,
    ).not.toBeNull();
  });
});

describe.skip("legacy flexible client edits", () => {
  it("rejects a token that does not exist", async () => {
    await expect(
      rpc("write_shared_cell", [
        hashOf("never-issued"),
        randomUUID(),
        "client_notes",
        JSON.stringify("x"),
      ]),
    ).rejects.toThrow("no longer valid");
  });
  it("denies a revoked or expired link", async () => {
    const { cid, rid, rcId } = await pipeline("write-revoked", 0);
    const revoked = await shareLink(cid, rid, "all_profiles", ["client_notes"], {
      editable: ["client_notes"],
    });
    await asUser(actor, () => rpc("revoke_share_link", [revoked.id]));
    await expect(
      rpc("write_shared_cell", [hashOf(revoked.token), rcId, "client_notes", JSON.stringify("x")]),
    ).rejects.toThrow("revoked");
    const expired = await shareLink(cid, rid, "all_profiles", ["client_notes"], {
      editable: ["client_notes"],
    });
    await sql("update public.role_share_links set expires_at=now()-interval '1 day' where id=$1", [
      expired.id,
    ]);
    await expect(
      rpc("write_shared_cell", [hashOf(expired.token), rcId, "client_notes", JSON.stringify("x")]),
    ).rejects.toThrow("expired");
  });
  it("refuses a column not marked editable, even if it is visible", async () => {
    const { cid, rid, rcId, candidateId } = await pipeline("write-not-editable", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name", "client_notes"], {
      editable: ["client_notes"],
    });
    await expect(
      rpc("write_shared_cell", [hashOf(token), rcId, "full_name", JSON.stringify("Hacked")]),
    ).rejects.toThrow("cannot be edited");
    expect(
      (await sql("select full_name from public.candidates where id=$1", [candidateId])).rows[0]
        .full_name,
    ).not.toBe("Hacked");
  });
  it("refuses a candidate outside this link's own role and stage", async () => {
    const { cid, rid, rcId } = await pipeline("write-scope-a", 0);
    const other = await pipeline("write-scope-b", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["client_notes"], {
      editable: ["client_notes"],
    });
    await expect(
      rpc("write_shared_cell", [hashOf(token), other.rcId, "client_notes", JSON.stringify("x")]),
    ).rejects.toThrow("Candidate not found");
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "recruiter_shortlisted", ""]));
    await expect(
      rpc("write_shared_cell", [hashOf(token), rcId, "client_notes", JSON.stringify("x")]),
    ).rejects.toThrow("Candidate not found");
  });
  it("writes client_notes and records the edit as the client, not the recruiter", async () => {
    const { cid, rid, rcId } = await pipeline("write-notes", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name", "client_notes"], {
      editable: ["client_notes"],
    });
    await rpc("write_shared_cell", [hashOf(token), rcId, "client_notes", JSON.stringify("Great fit")]);
    expect(
      (await sql("select client_notes from public.role_candidates where id=$1", [rcId])).rows[0]
        .client_notes,
    ).toBe("Great fit");
    const event = (
      await sql(
        "select actor,share_link_id,detail from public.role_candidate_events where role_candidate_id=$1 and kind='client_edit'",
        [rcId],
      )
    ).rows[0];
    expect(event.actor).toBeNull();
    expect(event.detail).toEqual({
      column: "client_notes",
      previousValue: "",
      value: "Great fit",
    });
    const projected = await rpc("read_shared_stage", [hashOf(token)]);
    expect(projected.rows[0].client_notes).toBe("Great fit");
  });
  it("validates interview_at as a real date and rejects garbage", async () => {
    const { cid, rid, rcId } = await pipeline("write-interview", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["interview_at"], {
      editable: ["interview_at"],
    });
    await expect(
      rpc("write_shared_cell", [hashOf(token), rcId, "interview_at", JSON.stringify("not-a-date")]),
    ).rejects.toThrow("valid date");
    await rpc("write_shared_cell", [
      hashOf(token),
      rcId,
      "interview_at",
      JSON.stringify("2026-10-01T10:00:00Z"),
    ]);
    expect(
      (await sql("select interview_at from public.role_candidates where id=$1", [rcId])).rows[0]
        .interview_at,
    ).toEqual(new Date("2026-10-01T10:00:00Z"));
  });
  it("clears interview_at back to null", async () => {
    const { cid, rid, rcId } = await pipeline("write-interview-clear", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["interview_at"], {
      editable: ["interview_at"],
    });
    await rpc("write_shared_cell", [
      hashOf(token),
      rcId,
      "interview_at",
      JSON.stringify("2026-10-01T10:00:00Z"),
    ]);
    await rpc("write_shared_cell", [hashOf(token), rcId, "interview_at", null]);
    expect(
      (await sql("select interview_at from public.role_candidates where id=$1", [rcId])).rows[0]
        .interview_at,
    ).toBeNull();
  });
  it("validates a custom field's value by its own kind, same rules as save_custom_field", async () => {
    const { cid, rid, rcId } = await pipeline("write-custom", 0);
    const fid = await asUser(actor, () =>
      rpc("add_role_field", [cid, rid, "Willing to relocate", "boolean", "[]"]),
    );
    const key = (await sql("select key from public.role_fields where id=$1", [fid])).rows[0].key;
    const { token } = await shareLink(cid, rid, "all_profiles", [key], { editable: [key] });
    await expect(
      rpc("write_shared_cell", [hashOf(token), rcId, key, JSON.stringify("yes")]),
    ).rejects.toThrow("Choose yes or no");
    await rpc("write_shared_cell", [hashOf(token), rcId, key, JSON.stringify(true)]);
    expect(
      (await sql("select custom from public.role_candidates where id=$1", [rcId])).rows[0].custom,
    ).toEqual({ [key]: true });
  });
  it("refuses a custom field that was archived after the link was created", async () => {
    const { cid, rid, rcId } = await pipeline("write-archived-field", 0);
    const fid = await asUser(actor, () =>
      rpc("add_role_field", [cid, rid, "Notice period", "text", "[]"]),
    );
    const key = (await sql("select key from public.role_fields where id=$1", [fid])).rows[0].key;
    const { token } = await shareLink(cid, rid, "all_profiles", [key], { editable: [key] });
    await asUser(actor, () => rpc("archive_role_field", [fid, true]));
    await expect(
      rpc("write_shared_cell", [hashOf(token), rcId, key, JSON.stringify("30 days")]),
    ).rejects.toThrow("no longer exists");
  });
  it("throttles a link that writes too many times in a short window", async () => {
    const { cid, rid, rcId } = await pipeline("write-throttle", 0);
    const { id: linkId, token } = await shareLink(cid, rid, "all_profiles", ["client_notes"], {
      editable: ["client_notes"],
    });
    // Simulate 60 prior writes directly, rather than making 60 real round
    // trips, to exercise the same count the RPC itself reads.
    await sql(
      `insert into public.role_candidate_events(client_id,role_candidate_id,kind,share_link_id,created_at)
       select $1,$2,'client_edit',$3,now() from generate_series(1,60)`,
      [cid, rcId, linkId],
    );
    await expect(
      rpc("write_shared_cell", [hashOf(token), rcId, "client_notes", JSON.stringify("one more")]),
    ).rejects.toThrow("Too many changes");
  });
});

describe.skip("legacy client decisions", () => {
  it("refuses a decision on a link that was not created with allow_decisions", async () => {
    const { cid, rid, rcId } = await pipeline("decision-not-allowed", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    await expect(
      rpc("write_client_decision", [hashOf(token), rcId, "shortlisted", ""]),
    ).rejects.toThrow("cannot record decisions");
  });
  it("rejects an unsupported decision value", async () => {
    const { cid, rid, rcId } = await pipeline("decision-bad-value", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name"], {
      allowDecisions: true,
    });
    await expect(
      rpc("write_client_decision", [hashOf(token), rcId, "maybe", ""]),
    ).rejects.toThrow("Choose Shortlist, Hold, or Reject");
  });
  it("requires a reason to reject, but not to shortlist or hold", async () => {
    const { cid, rid, rcId } = await pipeline("decision-reason", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name"], {
      allowDecisions: true,
    });
    await expect(
      rpc("write_client_decision", [hashOf(token), rcId, "rejected", ""]),
    ).rejects.toThrow("Enter a reason");
    await expect(
      rpc("write_client_decision", [hashOf(token), rcId, "shortlisted", ""]),
    ).resolves.toBeDefined();
  });
  it("records shortlist and hold as an advisory signal, without touching stage", async () => {
    const { cid, rid, rcId } = await pipeline("decision-shortlist", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name", "client_decision"], {
      allowDecisions: true,
    });
    await rpc("write_client_decision", [hashOf(token), rcId, "hold", "Waiting on budget"]);
    const row = (
      await sql("select stage,client_decision from public.role_candidates where id=$1", [rcId])
    ).rows[0];
    expect(row.stage).toBe("all_profiles");
    expect(row.client_decision).toBe("hold");
    const event = (
      await sql(
        "select actor,share_link_id,kind,detail from public.role_candidate_events where role_candidate_id=$1 and kind='client_decision'",
        [rcId],
      )
    ).rows[0];
    expect(event.actor).toBeNull();
    expect(event.share_link_id).toBeTruthy();
    expect(event.detail).toEqual({ decision: "hold", reason: "Waiting on budget" });
    const projected = await rpc("read_shared_stage", [hashOf(token)]);
    expect(projected.rows[0].client_decision).toBe("hold");
  });
  it("rejects the candidate through the same path a recruiter reject uses: stage, type, mandatory reason", async () => {
    const { cid, rid, rcId } = await pipeline("decision-reject", 0);
    const { token } = await shareLink(cid, rid, "all_profiles", ["full_name"], {
      allowDecisions: true,
    });
    await rpc("write_client_decision", [hashOf(token), rcId, "rejected", "Not a fit"]);
    const row = (
      await sql(
        "select stage,client_decision,rejection_type,rejection_reason,rejected_by from public.role_candidates where id=$1",
        [rcId],
      )
    ).rows[0];
    expect(row.stage).toBe("rejected");
    expect(row.client_decision).toBe("rejected");
    expect(row.rejection_type).toBe("client");
    expect(row.rejection_reason).toBe("Not a fit");
    expect(row.rejected_by).toBeNull();
    const event = (
      await sql(
        "select actor,share_link_id,from_stage,to_stage from public.role_candidate_events where role_candidate_id=$1 and kind='reject'",
        [rcId],
      )
    ).rows[0];
    expect(event.actor).toBeNull();
    expect(event.share_link_id).toBeTruthy();
    expect(event.from_stage).toBe("all_profiles");
    expect(event.to_stage).toBe("rejected");
  });
  it("refuses a candidate outside this link's own role and stage", async () => {
    const { rcId } = await pipeline("decision-scope-a", 0);
    const other = await pipeline("decision-scope-b", 0);
    const { token } = await shareLink(other.cid, other.rid, "all_profiles", ["full_name"], {
      allowDecisions: true,
    });
    await expect(
      rpc("write_client_decision", [hashOf(token), rcId, "shortlisted", ""]),
    ).rejects.toThrow("Candidate not found");
  });
  it("shares its throttle counter with write_shared_cell on the same link", async () => {
    const { cid, rid, rcId } = await pipeline("decision-throttle", 0);
    const { id: linkId, token } = await shareLink(cid, rid, "all_profiles", ["full_name"], {
      allowDecisions: true,
    });
    await sql(
      `insert into public.role_candidate_events(client_id,role_candidate_id,kind,share_link_id,created_at)
       select $1,$2,'client_edit',$3,now() from generate_series(1,60)`,
      [cid, rcId, linkId],
    );
    await expect(
      rpc("write_client_decision", [hashOf(token), rcId, "shortlisted", ""]),
    ).rejects.toThrow("Too many changes");
  });
});

describe.skip("legacy share-link regeneration", () => {
  it("denies a non-admin for both", async () => {
    const cid = await client();
    const rid = await role(cid);
    const { id } = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    await expect(asUser(outsider, () => rpc("revoke_share_link", [id]))).rejects.toThrow(
      "Agency access",
    );
    const fresh = freshToken();
    await expect(
      asUser(outsider, () =>
        rpc("regenerate_share_link", [id, fresh.hash, fresh.prefix]),
      ),
    ).rejects.toThrow("Agency access");
  });
  it("is idempotent and fails for a link that does not exist", async () => {
    const cid = await client();
    const rid = await role(cid);
    const { id } = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    await asUser(actor, () => rpc("revoke_share_link", [id]));
    const first = (
      await sql("select revoked_at from public.role_share_links where id=$1", [id])
    ).rows[0].revoked_at;
    await asUser(actor, () => rpc("revoke_share_link", [id]));
    const second = (
      await sql("select revoked_at from public.role_share_links where id=$1", [id])
    ).rows[0].revoked_at;
    expect(second).toEqual(first);
    await expect(
      asUser(actor, () => rpc("revoke_share_link", [randomUUID()])),
    ).rejects.toThrow("not found");
  });
  it("issues a genuinely new token that invalidates the old one, and revives a revoked link", async () => {
    const cid = await client();
    const rid = await role(cid);
    const { id, token: oldToken } = await shareLink(cid, rid, "all_profiles", ["full_name"]);
    await asUser(actor, () => rpc("revoke_share_link", [id]));
    const fresh = freshToken();
    await asUser(actor, () => rpc("regenerate_share_link", [id, fresh.hash, fresh.prefix]));
    const newToken = fresh.token;
    expect(newToken).not.toBe(oldToken);
    await expect(rpc("read_shared_stage", [hashOf(oldToken)])).rejects.toThrow(
      "no longer valid",
    );
    const result = await rpc("read_shared_stage", [hashOf(newToken)]);
    expect(result.rows).toEqual([]);
    expect(
      (await sql("select revoked_at from public.role_share_links where id=$1", [id])).rows[0]
        .revoked_at,
    ).toBeNull();
  });
  it("fails to regenerate a link that does not exist", async () => {
    const fresh = freshToken();
    await expect(
      asUser(actor, () =>
        rpc("regenerate_share_link", [randomUUID(), fresh.hash, fresh.prefix]),
      ),
    ).rejects.toThrow("not found");
  });
});

describe("client sharing: recruiter shortlist and Notes-only access", () => {
  async function strictClientLink(cid: string, rid: string) {
    const fresh = freshToken();
    const id = await asUser(actor, () =>
      rpc("create_share_link", [
        cid,
        rid,
        "recruiter_shortlisted",
        ["full_name", "client_notes"],
        ["client_notes"],
        null,
        fresh.hash,
        fresh.prefix,
        false,
      ]),
    );
    return { id: id as string, token: fresh.token };
  }

  it("allows only a Recruiter Shortlisted link with Notes as the one writable field", async () => {
    const { cid, rid, rcId } = await pipeline("strict-client-link", 3);
    const rejected = freshToken();
    await expect(
      asUser(actor, () =>
        rpc("create_share_link", [
          cid,
          rid,
          "all_profiles",
          ["full_name", "client_notes"],
          ["client_notes"],
          null,
          rejected.hash,
          rejected.prefix,
          false,
        ]),
      ),
    ).rejects.toThrow("Recruiter shortlisted");
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "recruiter_shortlisted", ""]));

    const decisions = freshToken();
    await expect(
      asUser(actor, () =>
        rpc("create_share_link", [
          cid,
          rid,
          "recruiter_shortlisted",
          ["full_name", "client_notes"],
          ["client_notes"],
          null,
          decisions.hash,
          decisions.prefix,
          true,
        ]),
      ),
    ).rejects.toThrow("cannot move or reject");

    const { id, token } = await strictClientLink(cid, rid);
    expect(
      (await sql("select stage,visible_columns,editable_columns,allow_decisions from public.role_share_links where id=$1", [id]))
        .rows[0],
    ).toEqual({
      stage: "recruiter_shortlisted",
      visible_columns: ["full_name", "client_notes", "linkedin"],
      editable_columns: ["client_notes"],
      allow_decisions: false,
    });
    const shared = await rpc("read_shared_stage", [hashOf(token)]);
    expect(shared.rows[0].linkedin).toBe(
      "https://www.linkedin.com/in/strict-client-link",
    );
    await rpc("write_shared_cell", [hashOf(token), rcId, "client_notes", JSON.stringify("Please call")]);
    await expect(
      rpc("write_shared_cell", [hashOf(token), rcId, "full_name", JSON.stringify("Changed")]),
    ).rejects.toThrow("Notes only");
    await expect(
      rpc("write_client_decision", [hashOf(token), rcId, "rejected", "No"]),
    ).rejects.toThrow("cannot move or reject");
    expect(
      (await sql("select client_notes from public.role_candidates where id=$1", [rcId])).rows[0]
        .client_notes,
    ).toBe("Please call");
  });

  it("keeps a candidate in Master DB after qualification and rejection", async () => {
    const { cid, rcId, candidateId } = await pipeline("master-qualification", 3);
    expect(
      (await sql("select master_qualified_at from public.candidates where id=$1", [candidateId])).rows[0]
        .master_qualified_at,
    ).toBeNull();
    await asUser(actor, () => rpc("rate_candidate", [cid, rcId, 3]));
    expect(
      (await sql("select master_qualified_at from public.candidates where id=$1", [candidateId])).rows[0]
        .master_qualified_at,
    ).not.toBeNull();
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "recruiter_shortlisted", ""]));
    await asUser(actor, () => rpc("reject_candidate", [cid, [rcId], "recruiter", "Not a fit"]));
    expect(
      (await sql("select master_qualified_at from public.candidates where id=$1", [candidateId])).rows[0]
        .master_qualified_at,
    ).not.toBeNull();
  });
});

describe("role_candidate_events.share_link_id: the Phase 1 column finally has a home", () => {
  it("accepts null but rejects a share link that does not exist", async () => {
    const { cid, rcId } = await pipeline("share-event-fk", 0);
    await expect(
      sql(
        "insert into public.role_candidate_events(client_id,role_candidate_id,kind,share_link_id) values($1,$2,'stage',$3)",
        [cid, rcId, randomUUID()],
      ),
    ).rejects.toThrow();
    await expect(
      sql(
        "insert into public.role_candidate_events(client_id,role_candidate_id,kind,share_link_id) values($1,$2,'stage',null)",
        [cid, rcId],
      ),
    ).resolves.toBeDefined();
  });
});

describe("record_outcome: offer_sent -> offer_accepted|offer_declined -> joined", () => {
  it("denies a non-admin", async () => {
    const { cid, rcId } = await pipeline("outcome-non-admin", 0);
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "offer_sent", ""]));
    await expect(
      asUser(outsider, () => rpc("record_outcome", [cid, [rcId], "offer_sent"])),
    ).rejects.toThrow("Agency access");
  });
  it("rejects an unsupported outcome value", async () => {
    const { cid, rcId } = await pipeline("outcome-bad-value", 0);
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "offer_sent", ""]));
    await expect(
      asUser(actor, () => rpc("record_outcome", [cid, [rcId], "hired"])),
    ).rejects.toThrow("Choose a valid outcome");
  });
  it("refuses an outcome for a candidate who has not reached offer_sent", async () => {
    const { cid, rcId } = await pipeline("outcome-wrong-stage", 0);
    await expect(
      asUser(actor, () => rpc("record_outcome", [cid, [rcId], "offer_sent"])),
    ).rejects.toThrow("cannot move to that outcome");
  });
  it("refuses skipping a step: cannot go straight to offer_accepted or joined", async () => {
    const { cid, rcId } = await pipeline("outcome-skip-step", 0);
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "offer_sent", ""]));
    await expect(
      asUser(actor, () => rpc("record_outcome", [cid, [rcId], "offer_accepted"])),
    ).rejects.toThrow("cannot move to that outcome");
    await expect(
      asUser(actor, () => rpc("record_outcome", [cid, [rcId], "joined"])),
    ).rejects.toThrow("cannot move to that outcome");
  });
  it("walks the full path and stamps outcome_at and one event per step", async () => {
    const { cid, rcId } = await pipeline("outcome-full-path", 0);
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "offer_sent", ""]));
    await asUser(actor, () => rpc("record_outcome", [cid, [rcId], "offer_sent"]));
    await asUser(actor, () => rpc("record_outcome", [cid, [rcId], "offer_accepted"]));
    await asUser(actor, () => rpc("record_outcome", [cid, [rcId], "joined"]));
    const row = (
      await sql("select outcome,outcome_at,stage from public.role_candidates where id=$1", [rcId])
    ).rows[0];
    expect(row.outcome).toBe("joined");
    expect(row.stage).toBe("offer_sent");
    expect(row.outcome_at).not.toBeNull();
    const events = (
      await sql(
        "select detail from public.role_candidate_events where role_candidate_id=$1 and kind='outcome' order by created_at",
        [rcId],
      )
    ).rows;
    expect(events.map((e) => e.detail)).toEqual([
      { outcome: "offer_sent" },
      { outcome: "offer_accepted" },
      { outcome: "joined" },
    ]);
  });
  it("treats offer_declined as terminal: no further outcome can follow it", async () => {
    const { cid, rcId } = await pipeline("outcome-declined-terminal", 0);
    await asUser(actor, () => rpc("move_stage", [cid, [rcId], "offer_sent", ""]));
    await asUser(actor, () => rpc("record_outcome", [cid, [rcId], "offer_sent"]));
    await asUser(actor, () => rpc("record_outcome", [cid, [rcId], "offer_declined"]));
    await expect(
      asUser(actor, () => rpc("record_outcome", [cid, [rcId], "joined"])),
    ).rejects.toThrow("cannot move to that outcome");
  });
  it("refuses a selection spanning outside this client", async () => {
    const a = await pipeline("outcome-cross-client-a", 0);
    const b = await pipeline("outcome-cross-client-b", 0);
    await asUser(actor, () => rpc("move_stage", [a.cid, [a.rcId], "offer_sent", ""]));
    await asUser(actor, () => rpc("move_stage", [b.cid, [b.rcId], "offer_sent", ""]));
    await expect(
      asUser(actor, () => rpc("record_outcome", [a.cid, [a.rcId, b.rcId], "offer_sent"])),
    ).rejects.toThrow("not in this client");
  });
});

describe("role_stage_funnel and role_stage_durations: read-only analytics views", () => {
  it("denies anon any access, same as every other recruiting surface", async () => {
    await sql("begin");
    await sql("set local role anon");
    await expect(sql("select * from public.role_stage_funnel")).rejects.toThrow();
    await expect(sql("select * from public.role_stage_durations")).rejects.toThrow();
    await sql("rollback");
  });
  it("counts ever_reached and currently_here per stage, and times only completed stays", async () => {
    const { rid, rcId, cid } = await pipeline("analytics-funnel", 0);
    const importedAt = (
      await sql(
        "select created_at from public.role_candidate_events where role_candidate_id=$1 and kind='import'",
        [rcId],
      )
    ).rows[0].created_at as Date;
    const shortlistedAt = new Date(importedAt.getTime() + 2 * 86400000);
    const recruiterAt = new Date(shortlistedAt.getTime() + 4 * 86400000);
    await sql(
      `insert into public.role_candidate_events(client_id,role_candidate_id,kind,to_stage,created_at)
       values($1,$2,'stage','profile_shortlisted',$3),($1,$2,'stage','recruiter_shortlisted',$4)`,
      [cid, rcId, shortlistedAt, recruiterAt],
    );
    await sql("update public.role_candidates set stage='recruiter_shortlisted' where id=$1", [rcId]);

    const funnel = await sql(
      "select stage,ever_reached,currently_here from public.role_stage_funnel where role_id=$1",
      [rid],
    );
    const byStage: Record<string, { ever_reached: number; currently_here: number }> =
      Object.fromEntries(funnel.rows.map((r) => [r.stage, r]));
    expect(byStage.all_profiles).toMatchObject({ ever_reached: 1, currently_here: 0 });
    expect(byStage.profile_shortlisted).toMatchObject({ ever_reached: 1, currently_here: 0 });
    expect(byStage.recruiter_shortlisted).toMatchObject({ ever_reached: 1, currently_here: 1 });
    expect(byStage.client_shortlisted).toMatchObject({ ever_reached: 0, currently_here: 0 });

    const durations = await sql(
      "select stage,completed_count,median_days from public.role_stage_durations where role_id=$1",
      [rid],
    );
    const durByStage: Record<string, { completed_count: number; median_days: number }> =
      Object.fromEntries(durations.rows.map((r) => [r.stage, r]));
    expect(durByStage.all_profiles.completed_count).toBe(1);
    expect(Number(durByStage.all_profiles.median_days)).toBeCloseTo(2, 0);
    expect(durByStage.profile_shortlisted.completed_count).toBe(1);
    expect(Number(durByStage.profile_shortlisted.median_days)).toBeCloseTo(4, 0);
    expect(durByStage.recruiter_shortlisted).toBeUndefined();
  });
  it("counts a rejection as ever_reached('rejected') without leaving it in an earlier stage's currently_here", async () => {
    const { cid, rid, rcId } = await pipeline("analytics-reject", 0);
    await asUser(actor, () =>
      rpc("move_stage", [cid, [rcId], "recruiter_shortlisted", "Reviewed"]),
    );
    await asUser(actor, () => rpc("reject_candidate", [cid, [rcId], "recruiter", "Not a fit"]));
    const funnel = await sql(
      "select stage,ever_reached,currently_here from public.role_stage_funnel where role_id=$1",
      [rid],
    );
    const byStage: Record<string, { ever_reached: number; currently_here: number }> =
      Object.fromEntries(funnel.rows.map((r) => [r.stage, r]));
    expect(byStage.rejected).toMatchObject({ ever_reached: 1, currently_here: 1 });
    expect(byStage.all_profiles).toMatchObject({ ever_reached: 1, currently_here: 0 });
  });
});

describe("role_candidate_stage_counts", () => {
  it("returns complete current-stage totals through the existing RLS boundary", async () => {
    const { cid, rid, rcId } = await pipeline("pipeline-stage-counts", 0);
    await asUser(actor, () =>
      rpc("move_stage", [cid, [rcId], "recruiter_shortlisted", "Reviewed"]),
    );
    const rows = await asUser(actor, () =>
      sql(
        "select stage,candidate_count from public.role_candidate_stage_counts($1)",
        [rid],
      ),
    );
    expect(rows.rows).toEqual([
      { stage: "recruiter_shortlisted", candidate_count: 1 },
    ]);
  });

  it("does not expose pipeline counts to anonymous callers", async () => {
    await sql("begin");
    await sql("set local role anon");
    await expect(
      sql("select * from public.role_candidate_stage_counts($1)", [randomUUID()]),
    ).rejects.toThrow();
    await sql("rollback");
  });
});

describe("role_work_queue_counts", () => {
  it("summarizes a role's next actions without returning candidates", async () => {
    const { cid, rid, rcId } = await pipeline("role-work-queue", 0);
    await asUser(actor, () =>
      rpc("save_screening", [cid, rcId, JSON.stringify({ followUpAt: "2000-01-01" }), ""]),
    );
    const initial = await asUser(actor, () =>
      sql("select * from public.role_work_queue_counts($1)", [cid]),
    );
    expect(initial.rows).toContainEqual({
      role_id: rid,
      new_profiles: 1,
      client_review: 0,
      due_follow_ups: 1,
      offers_in_progress: 0,
    });
    await asUser(actor, () =>
      rpc("move_stage", [cid, [rcId], "client_shortlisted", "Ready for the client"]),
    );
    const clientReview = await asUser(actor, () =>
      sql("select * from public.role_work_queue_counts($1) where role_id=$2", [cid, rid]),
    );
    expect(clientReview.rows[0]).toMatchObject({
      new_profiles: 0,
      client_review: 1,
      due_follow_ups: 1,
      offers_in_progress: 0,
    });
    await asUser(actor, () =>
      rpc("move_stage", [cid, [rcId], "offer_sent", "Offer sent"]),
    );
    const moved = await asUser(actor, () =>
      sql("select * from public.role_work_queue_counts($1) where role_id=$2", [cid, rid]),
    );
    expect(moved.rows[0]).toMatchObject({
      new_profiles: 0,
      client_review: 0,
      due_follow_ups: 1,
      offers_in_progress: 1,
    });
  });

  it("does not expose role summaries to anonymous callers", async () => {
    await sql("begin");
    await sql("set local role anon");
    await expect(
      sql("select * from public.role_work_queue_counts($1)", [randomUUID()]),
    ).rejects.toThrow();
    await sql("rollback");
  });
});

describe("agency_today_work_queue", () => {
  it("returns only active roles with attention items and their client context", async () => {
    const { cid, rid, rcId } = await pipeline("agency-today", 0);
    await asUser(actor, () =>
      rpc("save_screening", [cid, rcId, JSON.stringify({ followUpAt: "2000-01-01" }), ""]),
    );
    const rows = await asUser(actor, () =>
      sql(
        "select * from public.agency_today_work_queue() where client_id=$1 and role_id=$2",
        [cid, rid],
      ),
    );
    expect(rows.rows[0]).toMatchObject({
      client_id: cid,
      role_id: rid,
      due_follow_ups: 1,
      client_review: 0,
      offers_in_progress: 0,
    });
    await asUser(actor, () => rpc("archive_role", [rid, true]));
    const archived = await asUser(actor, () =>
      sql(
        "select * from public.agency_today_work_queue() where client_id=$1 and role_id=$2",
        [cid, rid],
      ),
    );
    expect(archived.rows).toEqual([]);
  });

  it("does not expose the agency work queue to anonymous callers", async () => {
    await sql("begin");
    await sql("set local role anon");
    await expect(sql("select * from public.agency_today_work_queue()")).rejects.toThrow();
    await sql("rollback");
  });
});
