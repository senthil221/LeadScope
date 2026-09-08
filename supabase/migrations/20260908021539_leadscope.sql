-- LeadScope v1: all agency writes go through narrow, authorized RPCs.
create schema if not exists private;
revoke all on schema private from public;
create table public.user_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 is_agency_admin boolean not null default false, created_at timestamptz not null default now()
);
create function private.on_signup() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.user_profiles(id) values(new.id) on conflict do nothing; return new; end $$;
create trigger leadscope_signup after insert on auth.users for each row execute function private.on_signup();
insert into public.user_profiles(id) select id from auth.users on conflict do nothing;
create function private.is_admin(p_actor uuid default auth.uid()) returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce((select is_agency_admin from public.user_profiles where id = p_actor),false)
$$;
create function private.require_admin(p_actor uuid) returns void language plpgsql security definer set search_path = '' as $$
begin if p_actor is null or not private.is_admin(p_actor) then raise exception 'LS: Agency access required.' using errcode='42501'; end if; end $$;

create table public.clients (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
 notes text not null default '' check(length(notes)<=4000), archived boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.campaigns (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 name text not null check(length(trim(name)) between 1 and 120), config jsonb not null check(jsonb_typeof(config)='object'),
 criteria_version integer not null default 1 check(criteria_version>0), revision integer not null default 1,
 archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,client_id)
);
create table public.campaign_queries (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, campaign_id uuid not null,
 revision integer not null, text text not null check(length(text) between 1 and 500),
 strategy text not null check(strategy in ('focused','broader','custom')), signature text not null check(length(signature)=64),
 enabled boolean not null default true, ordinal integer not null, created_at timestamptz not null default now(),
 foreign key(campaign_id,client_id) references public.campaigns(id,client_id), unique(id,campaign_id,client_id)
);
create table public.campaign_runs (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, campaign_id uuid not null,
 request_token uuid not null, created_by uuid not null references public.user_profiles(id),
 snapshot jsonb not null, criteria_version integer not null, rule_version text not null,
 status text not null default 'running' check(status in ('running','paused','completed','cancelled','failed')),
 budget integer not null check(budget between 1 and 50), target integer not null check(target between 1 and 1000),
 reserved integer not null default 0 check(reserved>=0 and reserved<=budget), dispatched integer not null default 0 check(dispatched>=0 and dispatched<=reserved),
 new_client_profiles integer not null default 0, new_candidates integer not null default 0, rule_matches integer not null default 0,
 reviews integer not null default 0, rejected integer not null default 0, suppressed integer not null default 0, duplicates integer not null default 0, errors integer not null default 0,
 stop_reason text, created_at timestamptz not null default now(), finished_at timestamptz,
 unique(created_by,request_token), unique(id,campaign_id,client_id), unique(id,client_id),
 foreign key(campaign_id,client_id) references public.campaigns(id,client_id)
);
create table public.run_queries (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, campaign_id uuid not null, run_id uuid not null,
 query_id uuid not null, text text not null, signature text not null, strategy text not null, ordinal integer not null,
 skipped boolean not null, skip_reason text, last_success_at timestamptz, prior_pages integer[] not null default '{}',
 unique(id,run_id,client_id), foreign key(run_id,campaign_id,client_id) references public.campaign_runs(id,campaign_id,client_id),
 foreign key(query_id,campaign_id,client_id) references public.campaign_queries(id,campaign_id,client_id)
);
create table public.search_jobs (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, run_id uuid not null, run_query_id uuid not null,
 page_number integer not null check(page_number between 1 and 5),
 status text not null default 'pending' check(status in ('pending','leased','retry_wait','response_saved','succeeded','failed','skipped')),
 attempts integer not null default 0 check(attempts between 0 and 3), token uuid, lease_until timestamptz, retry_at timestamptz,
 raw_response jsonb, response_saved_at timestamptz, fingerprint text, metrics jsonb not null default '{}', failure_code text,
 created_at timestamptz not null default now(), finished_at timestamptz,
 unique(run_query_id,page_number), unique(id,client_id), unique(id,run_id,client_id),
 foreign key(run_query_id,run_id,client_id) references public.run_queries(id,run_id,client_id)
);
create unique index one_active_lease_per_run on public.search_jobs(run_id) where token is not null;
create index jobs_claim on public.search_jobs(run_id,status,page_number,retry_at);
create index query_cooldown on public.run_queries(client_id,signature);
create index run_queries_order on public.run_queries(run_id,ordinal);
create index campaign_query_revision on public.campaign_queries(campaign_id,revision,ordinal);
create table public.client_profiles (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 canonical_url text not null check(canonical_url ~ '^https://www[.]linkedin[.]com/in/[^/?#[:space:]]+$'), notes text not null default '' check(length(notes)<=4000),
 first_seen timestamptz not null default now(), last_seen timestamptz not null default now(), unique(client_id,canonical_url), unique(id,client_id)
);
create table public.campaign_profiles (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, campaign_id uuid not null, client_profile_id uuid not null,
 origin_run_id uuid,
 criteria_version integer not null, assessment jsonb not null, prior_assessment jsonb,
 automatic_status text not null check(automatic_status in ('rule_match','review','rejected')), rule_version text not null,
 manual_decision text check(manual_decision in ('accepted','review','rejected')), decided_by uuid references public.user_profiles(id), decided_at timestamptz,
 decision_note text not null default '' check(length(decision_note)<=4000), decision_was_rule_match boolean,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(campaign_id,client_profile_id), unique(id,client_id),
 foreign key(origin_run_id,campaign_id,client_id) references public.campaign_runs(id,campaign_id,client_id),
 foreign key(campaign_id,client_id) references public.campaigns(id,client_id), foreign key(client_profile_id,client_id) references public.client_profiles(id,client_id)
);
create table public.discoveries (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, campaign_id uuid not null, run_id uuid not null,
 search_job_id uuid not null, client_profile_id uuid not null,
 title text not null, snippet text not null, original_url text not null, position integer not null,
 assessment jsonb not null, observed_at timestamptz not null, unique(search_job_id,client_profile_id),
 foreign key(search_job_id,run_id,client_id) references public.search_jobs(id,run_id,client_id),
 foreign key(run_id,campaign_id,client_id) references public.campaign_runs(id,campaign_id,client_id),
 foreign key(client_profile_id,client_id) references public.client_profiles(id,client_id)
);
create index discovery_profile_history on public.discoveries(client_profile_id,observed_at desc);
create index discovery_run on public.discoveries(run_id);
create index campaign_profiles_filter on public.campaign_profiles(client_id,campaign_id,manual_decision,automatic_status,updated_at desc);
create index campaigns_client on public.campaigns(client_id,archived);
create index runs_campaign on public.campaign_runs(campaign_id,created_at desc);
create index runs_client on public.campaign_runs(client_id,created_at desc);
create table public.suppressions (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id), canonical_url text not null,
 reason text not null check(length(reason) between 1 and 200), note text not null default '' check(length(note)<=4000),
 active boolean not null default true, created_by uuid not null references public.user_profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(client_id,canonical_url)
);
create table public.review_events (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, campaign_profile_id uuid not null,
 actor uuid not null references public.user_profiles(id), decision text not null, was_rule_match boolean not null,
 note text not null default '', created_at timestamptz not null default now(),
 foreign key(campaign_profile_id,client_id) references public.campaign_profiles(id,client_id)
);
create table public.suppression_events (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 canonical_url text not null, reason text not null, note text not null, active boolean not null,
 actor uuid not null references public.user_profiles(id), created_at timestamptz not null default now()
);
create index suppression_events_client on public.suppression_events(client_id,created_at desc);
create table public.review_time (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, campaign_id uuid not null,
 actor uuid not null references public.user_profiles(id), request_token uuid not null,
 seconds integer not null check(seconds between 1 and 30), created_at timestamptz not null default now(),
 foreign key(campaign_id,client_id) references public.campaigns(id,client_id), unique(actor,request_token)
);

-- Deny direct writes, even for approved operators. RPCs preserve invariants.
do $$ declare t text; begin
 foreach t in array array['user_profiles','clients','campaigns','campaign_queries','campaign_runs','run_queries','search_jobs','client_profiles','campaign_profiles','discoveries','suppressions','review_events','suppression_events','review_time'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy admin_read on public.%I for select to authenticated using ((select private.is_admin()))',t);
 end loop;
end $$;

create policy own_profile on public.user_profiles for select to authenticated using (id=(select auth.uid()));
grant usage on schema private to authenticated;
grant execute on function private.is_admin(uuid) to authenticated;

create function public.save_client(p_id uuid, p_name text, p_notes text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; begin
 perform private.require_admin(auth.uid());
 if p_id is null then insert into public.clients(name,notes) values(trim(p_name),p_notes) returning id into v_id;
 else update public.clients set name=trim(p_name),notes=p_notes,updated_at=now() where id=p_id returning id into v_id;
 end if;
 if v_id is null then raise exception 'LS: Client not found.'; end if; return v_id;
end $$;
create function public.save_campaign(p_id uuid,p_client uuid,p_name text,p_config jsonb,p_queries jsonb,p_reset boolean,p_revision integer) returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.campaigns; v_id uuid; q jsonb; n integer:=0; changed boolean; begin
 perform private.require_admin(auth.uid());
 perform 1 from public.clients where id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this client before editing campaigns.'; end if;
 if jsonb_array_length(p_config->'locations') not between 1 and 20 or jsonb_array_length(p_config->'roles') not between 1 and 30
 or (p_config->>'pageCap')::integer not between 1 and 5 or (p_config->>'budget')::integer not between 1 and 50
 or jsonb_array_length(p_queries) not between 1 and 40 then raise exception 'LS: Invalid campaign limits.'; end if;
 if p_id is null then
  insert into public.campaigns(client_id,name,config) values(p_client,p_name,p_config) returning * into c;
 else
  select * into c from public.campaigns where id=p_id and client_id=p_client for update;
  if not found then raise exception 'LS: Campaign not found.'; end if;
  if c.revision is distinct from p_revision then raise exception 'LS: Another operator saved changes. Reload before saving.'; end if;
  changed := (c.config - array['country','language','queryCap','pageCap','budget','target','cooldownDays','includeRequired','queryExclusions']) is distinct from
             (p_config - array['country','language','queryCap','pageCap','budget','target','cooldownDays','includeRequired','queryExclusions']);
  if changed and exists(select 1 from public.campaign_profiles where campaign_id=c.id) and not p_reset then raise exception 'LS: Criteria changed. Confirm reset to Review before saving.'; end if;
  if changed and exists(select 1 from public.campaign_runs where campaign_id=c.id and status in ('running','paused')) then raise exception 'LS: Cancel unfinished runs before changing criteria.'; end if;
  update public.campaigns set name=p_name,config=p_config,revision=revision+1,criteria_version=criteria_version+case when changed then 1 else 0 end,updated_at=now() where id=c.id returning * into c;
  if changed then
   insert into public.review_events(client_id,campaign_profile_id,actor,decision,was_rule_match,note)
    select client_id,id,auth.uid(),'criteria_reset',automatic_status='rule_match','Criteria changed; returned to Review.' from public.campaign_profiles where campaign_id=c.id;
   update public.campaign_profiles set manual_decision='review',decided_by=auth.uid(),decided_at=now(),decision_note='Criteria changed; review new evidence.',updated_at=now() where campaign_id=c.id;
  end if;
 end if;
 v_id:=c.id;
 for q in select * from jsonb_array_elements(p_queries) loop
  insert into public.campaign_queries(client_id,campaign_id,revision,text,strategy,signature,enabled,ordinal)
   values(p_client,v_id,c.revision,q->>'text',q->>'strategy',q->>'signature',(q->>'enabled')::boolean,n); n:=n+1;
 end loop;
 return v_id;
end $$;
create function public.archive_entity(p_kind text,p_id uuid,p_archived boolean) returns void language plpgsql security definer set search_path = '' as $$
begin perform private.require_admin(auth.uid());
 if p_kind='client' then
  update public.clients set archived=p_archived,updated_at=now() where id=p_id;
  if p_archived then update public.campaign_runs set status='paused',stop_reason='client_archived' where client_id=p_id and status='running'; end if;
 elsif p_kind='campaign' then
  update public.campaigns set archived=p_archived,updated_at=now() where id=p_id;
  if p_archived then update public.campaign_runs set status='paused',stop_reason='campaign_archived' where campaign_id=p_id and status='running'; end if;
 else raise exception 'LS: Invalid archive action.'; end if;
end $$;

create function public.review_leads(p_client uuid,p_ids uuid[],p_decision text,p_note text) returns void language plpgsql security definer set search_path = '' as $$
declare cp public.campaign_profiles; url text; ver integer; begin
 perform private.require_admin(auth.uid());
 if cardinality(p_ids) not between 1 and 100 or length(p_note)>4000 or p_decision not in ('accepted','review','rejected','suppressed') then raise exception 'LS: Invalid review selection.'; end if;
 -- Client lock serializes suppression/accept/ingestion races consistently.
 perform 1 from public.clients where id=p_client for update;
 if (select count(*) from public.campaign_profiles where client_id=p_client and id=any(p_ids)) <> cardinality(p_ids) then raise exception 'LS: Selection is not in this client.'; end if;
 for cp in select * from public.campaign_profiles where client_id=p_client and id=any(p_ids) order by id for update loop
  select canonical_url into url from public.client_profiles where id=cp.client_profile_id;
  select criteria_version into ver from public.campaigns where id=cp.campaign_id;
  if p_decision='accepted' and (cp.criteria_version<>ver or exists(select 1 from public.suppressions where client_id=p_client and canonical_url=url and active)) then raise exception 'LS: Suppressed or stale candidates cannot be accepted. Requalify stale evidence first.'; end if;
  if p_decision='suppressed' then
   insert into public.suppressions(client_id,canonical_url,reason,note,created_by) values(p_client,url,'Operator suppression',p_note,auth.uid())
    on conflict(client_id,canonical_url) do update set active=true,note=excluded.note,updated_at=now();
   insert into public.suppression_events(client_id,canonical_url,reason,note,active,actor) values(p_client,url,'Operator suppression',p_note,true,auth.uid());
  else
   update public.campaign_profiles set manual_decision=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=p_note,decision_was_rule_match=(automatic_status='rule_match'),updated_at=now() where id=cp.id;
  end if;
  insert into public.review_events(client_id,campaign_profile_id,actor,decision,was_rule_match,note) values(p_client,cp.id,auth.uid(),p_decision,cp.automatic_status='rule_match',p_note);
 end loop;
end $$;
create function public.set_suppression(p_client uuid,p_url text,p_reason text,p_note text,p_active boolean) returns void language plpgsql security definer set search_path = '' as $$
begin perform private.require_admin(auth.uid());
 perform 1 from public.clients where id=p_client for update;
 if p_url !~ '^https://www[.]linkedin[.]com/in/[^/?#[:space:]]+$' then raise exception 'LS: Invalid profile URL.'; end if;
 insert into public.suppressions(client_id,canonical_url,reason,note,active,created_by) values(p_client,p_url,p_reason,p_note,p_active,auth.uid())
 on conflict(client_id,canonical_url) do update set active=p_active,reason=p_reason,note=p_note,updated_at=now();
 insert into public.suppression_events(client_id,canonical_url,reason,note,active,actor) values(p_client,p_url,p_reason,p_note,p_active,auth.uid());
 if not p_active then
  insert into public.review_events(client_id,campaign_profile_id,actor,decision,was_rule_match,note)
   select client_id,id,auth.uid(),'review',automatic_status='rule_match','Suppression removed; review required.' from public.campaign_profiles
   where client_id=p_client and client_profile_id in(select id from public.client_profiles where client_id=p_client and canonical_url=p_url);
  update public.campaign_profiles set manual_decision='review',decided_by=auth.uid(),decided_at=now(),decision_note='Suppression removed; review required.',updated_at=now()
   where client_id=p_client and client_profile_id in(select id from public.client_profiles where client_id=p_client and canonical_url=p_url);
 end if;
end $$;
create function public.save_profile_note(p_client uuid,p_profile uuid,p_note text) returns void language plpgsql security definer set search_path = '' as $$
begin perform private.require_admin(auth.uid()); update public.client_profiles set notes=p_note where id=p_profile and client_id=p_client; if not found then raise exception 'LS: Profile not found.'; end if; end $$;
create function public.record_review_time(p_campaign uuid,p_seconds integer,p_token uuid) returns void language plpgsql security definer set search_path = '' as $$
begin perform private.require_admin(auth.uid());
 insert into public.review_time(client_id,campaign_id,actor,seconds,request_token) select client_id,id,auth.uid(),p_seconds,p_token from public.campaigns where id=p_campaign on conflict(actor,request_token) do nothing;
end $$;

create view public.lead_rows with (security_invoker=true) as
 select cp.*, p.canonical_url,p.notes,p.first_seen,p.last_seen,c.name as campaign_name,c.criteria_version as current_version,
 case when s.active then 'suppressed' when cp.criteria_version<>c.criteria_version then 'review' else coalesce(cp.manual_decision,cp.automatic_status) end as status,
 coalesce(s.active,false) as suppressed,
 cp.assessment->>'title' as title, cp.assessment->>'snippet' as snippet,
 p.canonical_url || ' ' || coalesce(cp.assessment->>'title','') || ' ' || coalesce(cp.assessment->>'snippet','') as search_text
 from public.campaign_profiles cp join public.client_profiles p on p.id=cp.client_profile_id and p.client_id=cp.client_id
 join public.campaigns c on c.id=cp.campaign_id and c.client_id=cp.client_id
 left join public.suppressions s on s.client_id=cp.client_id and s.canonical_url=p.canonical_url;
grant select on public.lead_rows to authenticated;

-- Search preflight and creation use the server integration key, plus verified actor.
create function public.prepare_run(p_actor uuid,p_campaign uuid,p_token uuid,p_force uuid[],p_cap integer,p_create boolean,p_revision integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.campaigns; q public.campaign_queries; r public.campaign_runs; items jsonb:='[]'; last_at timestamptz; pages integer[]; eligible integer:=0; cap integer; skip boolean; rq uuid; item jsonb; begin
 perform private.require_admin(p_actor);
 perform 1 from public.clients where id=(select client_id from public.campaigns where id=p_campaign) for update;
 select * into c from public.campaigns where id=p_campaign for update;
 if not found then raise exception 'LS: Campaign not found.'; end if;
 if p_create then
  select * into r from public.campaign_runs where created_by=p_actor and request_token=p_token;
  if found then
   if r.campaign_id<>p_campaign then raise exception 'LS: Start token belongs to a different campaign.'; end if;
   return jsonb_build_object('runId',r.id,'cap',r.budget);
  end if;
 end if;
 if p_create and c.revision is distinct from p_revision then raise exception 'LS: Campaign changed. Preview the search again before starting.'; end if;
 if exists(select 1 from unnest(p_force) f where not exists(select 1 from public.campaign_queries where id=f and campaign_id=c.id and revision=c.revision and enabled)) then raise exception 'LS: Force selection must contain enabled queries from this campaign.'; end if;
 if c.archived or exists(select 1 from public.clients where id=c.client_id and archived) then raise exception 'LS: Restore this client and campaign before starting a run.'; end if;
 for q in select * from public.campaign_queries where campaign_id=c.id and revision=c.revision and enabled order by ordinal loop
  select max(j.finished_at),array_agg(distinct j.page_number order by j.page_number) into last_at,pages
   from public.search_jobs j join public.run_queries x on x.id=j.run_query_id
   where x.client_id=c.client_id and x.signature=q.signature and j.status='succeeded';
  skip:=coalesce(last_at>now()-make_interval(days=>(c.config->>'cooldownDays')::integer),false) and not(q.id=any(coalesce(p_force,'{}')));
  if not skip then eligible:=eligible+1; end if;
  items:=items||jsonb_build_array(jsonb_build_object('id',q.id,'text',q.text,'strategy',q.strategy,'signature',q.signature,'ordinal',q.ordinal,'skipped',skip,'lastSuccess',last_at,'priorPages',coalesce(pages,'{}')));
 end loop;
 cap:=least((c.config->>'budget')::integer,greatest(0,least(p_cap,50)),eligible*(c.config->>'pageCap')::integer);
 if not p_create then return jsonb_build_object('revision',c.revision,'queries',items,'eligible',eligible,'cap',cap,'pages',(c.config->>'pageCap')::integer,'target',(c.config->>'target')::integer); end if;
 if cap=0 then raise exception 'LS: No eligible queries. Enable a query or use Force rerun.'; end if;
 insert into public.campaign_runs(client_id,campaign_id,request_token,created_by,snapshot,criteria_version,rule_version,budget,target)
  values(c.client_id,c.id,p_token,p_actor,c.config,c.criteria_version,'evidence-v1',cap,(c.config->>'target')::integer) returning * into r;
 for item in select * from jsonb_array_elements(items) loop
  insert into public.run_queries(client_id,campaign_id,run_id,query_id,text,signature,strategy,ordinal,skipped,skip_reason,last_success_at,prior_pages)
   values(c.client_id,c.id,r.id,(item->>'id')::uuid,item->>'text',item->>'signature',item->>'strategy',(item->>'ordinal')::integer,(item->>'skipped')::boolean,
    case when (item->>'skipped')::boolean then 'cooldown' end,(item->>'lastSuccess')::timestamptz,array(select jsonb_array_elements_text(item->'priorPages')::integer)) returning id into rq;
  if not (item->>'skipped')::boolean then insert into public.search_jobs(client_id,run_id,run_query_id,page_number) values(c.client_id,r.id,rq,1); end if;
 end loop;
 return jsonb_build_object('runId',r.id,'cap',cap);
end $$;

create function public.control_run(p_run uuid,p_action text) returns void language plpgsql security definer set search_path = '' as $$
declare r public.campaign_runs; begin perform private.require_admin(auth.uid());
 select * into r from public.campaign_runs where id=p_run for update;
 if not found then raise exception 'LS: Run not found.'; end if;
 if r.status in ('completed','cancelled','failed') then raise exception 'LS: This run has finished.'; end if;
 if p_action='resume' then
  if exists(select 1 from public.clients where id=r.client_id and archived) or exists(select 1 from public.campaigns where id=r.campaign_id and archived) then raise exception 'LS: Restore this workspace before resuming.'; end if;
  update public.campaign_runs set status='running',stop_reason=null where id=r.id;
 elsif p_action='pause' then update public.campaign_runs set status='paused' where id=r.id;
 elsif p_action='cancel' then
  update public.campaign_runs set status='cancelled',finished_at=now(),stop_reason='operator_cancelled' where id=r.id;
  update public.search_jobs set status='skipped',finished_at=now() where run_id=r.id and status in ('pending','retry_wait');
 else raise exception 'LS: Unknown run action.'; end if;
end $$;

create function public.claim_job(p_actor uuid,p_run uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.campaign_runs; j public.search_jobs; q public.run_queries; wait_at timestamptz; expired_count integer; begin
 perform private.require_admin(p_actor);
 select * into r from public.campaign_runs where id=p_run for update;
 if not found then raise exception 'LS: Run not found.'; end if;
 -- An expired lease consumed its reserved slot, even when dispatch is uncertain.
 select count(*) into expired_count from public.search_jobs where run_id=r.id and token is not null and lease_until<=now() and raw_response is null;
 if expired_count>0 then update public.campaign_runs set errors=errors+expired_count where id=r.id returning * into r; end if;
 update public.search_jobs set token=null,lease_until=null,status=case when raw_response is not null then 'response_saved' when attempts>=3 then 'failed' else 'retry_wait' end,
  failure_code=case when raw_response is null then 'lease_expired_uncertain' else failure_code end,retry_at=now()
  where run_id=r.id and token is not null and lease_until<=now();
 select min(lease_until) into wait_at from public.search_jobs where run_id=r.id and token is not null;
 if wait_at is not null then return jsonb_build_object('state','waiting','nextRetryAt',wait_at); end if;
 -- Durable responses can be recovered even after pause/cancel, with no new slot.
 select * into j from public.search_jobs where run_id=r.id and status='response_saved' order by page_number,created_at limit 1 for update;
 if found then
  update public.search_jobs set token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where id=j.id returning * into j;
  select * into q from public.run_queries where id=j.run_query_id;
  return jsonb_build_object('state','recover','job',to_jsonb(j),'query',to_jsonb(q),'run',to_jsonb(r));
 end if;
 if r.status<>'running' then return jsonb_build_object('state',r.status); end if;
 if exists(select 1 from public.clients where id=r.client_id and archived) or exists(select 1 from public.campaigns where id=r.campaign_id and archived) then
  update public.campaign_runs set status='paused' where id=r.id; return jsonb_build_object('state','paused');
 end if;
 if r.reserved>=r.budget or r.rule_matches>=r.target then
  update public.search_jobs set status='skipped',finished_at=now() where run_id=r.id and status in ('pending','retry_wait');
  update public.campaign_runs set status='completed',stop_reason=case when r.rule_matches>=r.target then 'target_reached' else 'budget_reserved' end,finished_at=now() where id=r.id;
  return jsonb_build_object('state','completed');
 end if;
 select j2.* into j from public.search_jobs j2 join public.run_queries x on x.id=j2.run_query_id
  where j2.run_id=r.id and j2.status in ('pending','retry_wait') and coalesce(j2.retry_at,now())<=now() and j2.attempts<3
  and j2.page_number=(select min(page_number) from public.search_jobs where run_id=r.id and status in ('pending','retry_wait'))
  order by j2.page_number,x.ordinal limit 1 for update of j2;
 if not found then
  select min(retry_at) into wait_at from public.search_jobs where run_id=r.id and status='retry_wait';
  if wait_at is not null then return jsonb_build_object('state','waiting','nextRetryAt',wait_at); end if;
  update public.campaign_runs set status='completed',stop_reason='queries_exhausted',finished_at=now() where id=r.id;
  return jsonb_build_object('state','completed');
 end if;
 update public.search_jobs set status='leased',attempts=attempts+1,token=gen_random_uuid(),lease_until=now()+interval '60 seconds',retry_at=null where id=j.id returning * into j;
 update public.campaign_runs set reserved=reserved+1 where id=r.id returning * into r;
 select * into q from public.run_queries where id=j.run_query_id;
 return jsonb_build_object('state','dispatch','job',to_jsonb(j),'query',to_jsonb(q),'run',to_jsonb(r));
end $$;
create function public.mark_dispatch(p_actor uuid,p_job uuid,p_token uuid) returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.search_jobs; r public.campaign_runs; begin perform private.require_admin(p_actor);
 select * into j from public.search_jobs where id=p_job;
 select * into r from public.campaign_runs where id=j.run_id for update;
 select * into j from public.search_jobs where id=p_job for update;
 if j.token is distinct from p_token or j.lease_until<=now() or j.status<>'leased' then return false; end if;
 if r.status<>'running' then update public.search_jobs set status='skipped',token=null,lease_until=null,finished_at=now() where id=j.id; return false; end if;
 if j.metrics->>'dispatchToken'=p_token::text then return false; end if;
 update public.search_jobs set metrics=metrics||jsonb_build_object('dispatchToken',p_token,'dispatchedAttempts',coalesce((metrics->>'dispatchedAttempts')::integer,0)+1) where id=j.id;
 update public.campaign_runs set dispatched=dispatched+1 where id=r.id;
 return true;
end $$;
create function public.save_response(p_actor uuid,p_job uuid,p_token uuid,p_raw jsonb) returns boolean language plpgsql security definer set search_path = '' as $$
declare rid uuid; begin perform private.require_admin(p_actor);
 select run_id into rid from public.search_jobs where id=p_job; perform 1 from public.campaign_runs where id=rid for update;
 update public.search_jobs set raw_response=p_raw,response_saved_at=now(),status='response_saved'
  where id=p_job and token=p_token and lease_until>now() and status='leased' and raw_response is null;
 return found;
end $$;
create function public.fail_job(p_actor uuid,p_job uuid,p_token uuid,p_code text,p_retry boolean,p_stop boolean) returns void language plpgsql security definer set search_path = '' as $$
declare j public.search_jobs; r public.campaign_runs; again boolean; begin perform private.require_admin(p_actor);
 select * into j from public.search_jobs where id=p_job; select * into r from public.campaign_runs where id=j.run_id for update;
 select * into j from public.search_jobs where id=p_job for update;
 if j.token is distinct from p_token or j.lease_until<=now() or j.raw_response is not null then return; end if;
 again:=p_retry and j.attempts<3 and r.status='running' and not p_stop;
 update public.search_jobs set status=case when again then 'retry_wait' else 'failed' end,failure_code=left(p_code,80),token=null,lease_until=null,
 retry_at=case when again then now()+make_interval(secs=>least(120,5*power(2,j.attempts)::integer)) end,finished_at=case when not again then now() end where id=j.id;
 update public.campaign_runs set errors=errors+1,status=case when p_stop and status='running' then 'failed' else status end,
 stop_reason=case when p_stop then left(p_code,80) else stop_reason end,finished_at=case when p_stop then now() else finished_at end where id=r.id;
 if p_stop then update public.search_jobs set status='skipped',finished_at=now() where run_id=r.id and status in ('pending','retry_wait'); end if;
end $$;

create function public.commit_job(p_actor uuid,p_job uuid,p_token uuid,p_items jsonb,p_fingerprint text,p_occurrences integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.search_jobs; r public.campaign_runs; item jsonb; p public.client_profiles; cp public.campaign_profiles; a jsonb;
 nclient integer:=0; ncandidate integer:=0; nrule integer:=0; nreview integer:=0; nreject integer:=0; nsuppress integer:=0; ndupe integer:=0; nuseful integer:=0;
 isnew boolean; issuppressed boolean; repeat_page boolean; conflict boolean; target_seen boolean; v_metrics jsonb; begin
 perform private.require_admin(p_actor);
 select * into j from public.search_jobs where id=p_job;
 -- Universal order for ingestion/review: client, run, job, profile.
 perform 1 from public.clients where id=j.client_id for update;
 select * into r from public.campaign_runs where id=j.run_id for update;
 select * into j from public.search_jobs where id=p_job for update;
 if j.status='succeeded' then return j.metrics; end if;
 if j.token is distinct from p_token or j.lease_until<=now() or j.raw_response is null then raise exception 'LS: Search lease expired; resume to recover.'; end if;
 repeat_page:=exists(select 1 from public.search_jobs where run_query_id=j.run_query_id and id<>j.id and fingerprint=p_fingerprint and status='succeeded');
 ndupe:=greatest(0,p_occurrences-jsonb_array_length(p_items));
 for item in select * from jsonb_array_elements(p_items) loop
  select * into p from public.client_profiles where client_id=r.client_id and canonical_url=item->>'canonicalUrl';
  if not found then insert into public.client_profiles(client_id,canonical_url,first_seen,last_seen) values(r.client_id,item->>'canonicalUrl',j.response_saved_at,j.response_saved_at) returning * into p; nclient:=nclient+1;
  else update public.client_profiles set last_seen=greatest(last_seen,j.response_saved_at) where id=p.id; end if;
  a:=item->'assessment';
  select * into cp from public.campaign_profiles where campaign_id=r.campaign_id and client_profile_id=p.id for update;
  isnew:=not found;
  select exists(select 1 from public.suppressions where client_id=r.client_id and canonical_url=p.canonical_url and active) into issuppressed;
  select exists(select 1 from public.discoveries where run_id=r.id and client_profile_id=p.id and assessment->>'status'='rule_match') into target_seen;
  if isnew then
   insert into public.campaign_profiles(client_id,campaign_id,client_profile_id,origin_run_id,criteria_version,assessment,automatic_status,rule_version)
    values(r.client_id,r.campaign_id,p.id,r.id,r.criteria_version,a,a->>'status',r.rule_version); ncandidate:=ncandidate+1;
  elsif cp.criteria_version=r.criteria_version then
   select exists(select 1 from jsonb_each(a->'criteria') e where
    (e.value->>'state'='pass' and cp.assessment->'criteria'->e.key->>'state'='fail') or
    (e.value->>'state'='fail' and cp.assessment->'criteria'->e.key->>'state'='pass')) into conflict;
   if conflict or coalesce((cp.assessment->>'conflict')::boolean,false) then
    conflict:=true; a:=jsonb_set(jsonb_set(a,'{status}','"review"'),'{conflict}','true');
   elsif cp.automatic_status='rule_match' and a->>'status'<>'rule_match' then a:=cp.assessment; end if;
   update public.campaign_profiles set assessment=a,prior_assessment=case when conflict then cp.assessment else prior_assessment end,automatic_status=a->>'status',updated_at=now() where id=cp.id;
   ndupe:=ndupe+1;
  else
   update public.campaign_profiles set criteria_version=r.criteria_version,assessment=a,prior_assessment=assessment,automatic_status=a->>'status',rule_version=r.rule_version,updated_at=now() where id=cp.id;
   ndupe:=ndupe+1;
  end if;
  insert into public.discoveries(client_id,campaign_id,run_id,search_job_id,client_profile_id,title,snippet,original_url,position,assessment,observed_at)
   values(r.client_id,r.campaign_id,r.id,j.id,p.id,item->>'title',item->>'snippet',item->>'originalUrl',(item->>'position')::integer,item->'assessment',j.response_saved_at);
  if issuppressed then nsuppress:=nsuppress+1;
  elsif not target_seen and (isnew or cp.origin_run_id=r.id) and a->>'status'='rule_match' then nrule:=nrule+1;
  end if;
  if not issuppressed and isnew then
   if a->>'status' in ('rule_match','review') then nuseful:=nuseful+1; end if;
   if item->'assessment'->>'status'='review' then nreview:=nreview+1; elsif item->'assessment'->>'status'='rejected' then nreject:=nreject+1; end if;
  end if;
 end loop;
 v_metrics:=jsonb_build_object('dispatchedAttempts',coalesce((j.metrics->>'dispatchedAttempts')::integer,0),'newClientProfiles',nclient,'newCandidates',ncandidate,'ruleMatches',nrule,'review',nreview,'rejected',nreject,'suppressed',nsuppress,'duplicates',ndupe,'validProfiles',jsonb_array_length(p_items),'repeatedPage',repeat_page);
 update public.search_jobs set status='succeeded',metrics=v_metrics,fingerprint=p_fingerprint,token=null,lease_until=null,finished_at=now() where id=j.id;
 update public.campaign_runs set new_client_profiles=new_client_profiles+nclient,new_candidates=new_candidates+ncandidate,rule_matches=rule_matches+nrule,
 reviews=reviews+nreview,rejected=rejected+nreject,suppressed=suppressed+nsuppress,duplicates=duplicates+ndupe where id=r.id;
 if r.status='running' and not repeat_page and j.page_number<(r.snapshot->>'pageCap')::integer and nuseful>0 and r.rule_matches+nrule<r.target and r.reserved<r.budget then
  insert into public.search_jobs(client_id,run_id,run_query_id,page_number) values(r.client_id,r.id,j.run_query_id,j.page_number+1) on conflict do nothing;
 end if;
 return v_metrics;
end $$;

create function public.cleanup_raw_responses() returns integer language plpgsql security definer set search_path = '' as $$
declare n integer; begin perform private.require_admin(auth.uid());
 update public.search_jobs set raw_response=null where response_saved_at<now()-interval '30 days' and status='succeeded'; get diagnostics n=row_count; return n; end $$;

create function public.review_metrics(p_client uuid,p_campaign uuid default null) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 return jsonb_build_object(
 'seconds',(select coalesce(sum(seconds),0) from public.review_time where client_id=p_client and (p_campaign is null or campaign_id=p_campaign)),
 'dispatched',(select coalesce(sum(dispatched),0) from public.campaign_runs where client_id=p_client and (p_campaign is null or campaign_id=p_campaign)),
 'precision',(select jsonb_build_object('accepted',count(*) filter(where manual_decision='accepted'),'adjudicated',count(*)) from public.campaign_profiles where client_id=p_client and (p_campaign is null or campaign_id=p_campaign) and decision_was_rule_match and manual_decision in ('accepted','rejected')));
end $$;
revoke all on function public.review_metrics(uuid,uuid) from public,anon;
grant execute on function public.review_metrics(uuid,uuid) to authenticated;

create function public.requalify_lead(p_actor uuid,p_id uuid,p_version integer,p_assessment jsonb,p_prior jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare cp public.campaign_profiles; begin
 perform private.require_admin(p_actor);
 select * into cp from public.campaign_profiles where id=p_id;
 perform 1 from public.clients where id=cp.client_id for update;
 perform 1 from public.campaigns where id=cp.campaign_id and criteria_version=p_version for update;
 if not found then raise exception 'LS: Criteria changed during requalification. Try again.'; end if;
 update public.campaign_profiles set assessment=p_assessment,prior_assessment=p_prior,criteria_version=p_version,automatic_status=p_assessment->>'status',rule_version='evidence-v1',updated_at=now() where id=p_id and criteria_version<>p_version;
end $$;
revoke all on function public.requalify_lead(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.requalify_lead(uuid,uuid,integer,jsonb,jsonb) to service_role;

create function public.export_accepted(p_client uuid,p_campaign uuid default null) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
  select l.*,coalesce((select rq.text from public.discoveries d join public.search_jobs j on j.id=d.search_job_id join public.run_queries rq on rq.id=j.run_query_id
    where d.client_profile_id=l.client_profile_id and d.campaign_id=l.campaign_id order by d.observed_at desc,d.id limit 1),'') as source_query
  from public.lead_rows l where l.client_id=p_client and (p_campaign is null or l.campaign_id=p_campaign)
   and l.status='accepted' and not l.suppressed and l.criteria_version=l.current_version
  order by l.decided_at desc,l.id
 ) x),'[]'::jsonb);
end $$;
revoke all on function public.export_accepted(uuid,uuid) from public,anon;
grant execute on function public.export_accepted(uuid,uuid) to authenticated;
grant execute on function private.require_admin(uuid) to authenticated;

-- Explicit execution grants: privileged provider RPCs are unreachable with a publishable/session key.
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_admin(uuid) to authenticated;
grant execute on function private.require_admin(uuid) to authenticated;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('save_client','save_campaign','archive_entity','review_leads','set_suppression','save_profile_note','record_review_time','prepare_run','control_run','claim_job','mark_dispatch','save_response','fail_job','commit_job','cleanup_raw_responses') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  if f.proname in ('prepare_run','claim_job','mark_dispatch','save_response','fail_job','commit_job') then execute format('grant execute on function %s to service_role',f.sig);
  else execute format('grant execute on function %s to authenticated',f.sig); end if;
end loop;
end $$;

-- Expose invoker wrappers only. Definer implementations live in the unexposed
-- private schema, retain their narrow execution grants, and authorize the actor.
grant usage on schema private to service_role;
do $$ declare f record; placeholders text; audience text; begin
 for f in select p.oid,p.proname,p.pronargs,pg_get_function_identity_arguments(p.oid) as args,pg_get_function_result(p.oid) as result
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and p.proname in
  ('save_client','save_campaign','archive_entity','review_leads','set_suppression','save_profile_note','record_review_time','prepare_run','control_run','claim_job','mark_dispatch','save_response','fail_job','commit_job','cleanup_raw_responses','requalify_lead') loop
  select coalesce(string_agg('$'||i,','),'') into placeholders from generate_series(1,f.pronargs) i;
  execute format('alter function public.%I(%s) set schema private',f.proname,f.args);
  execute format('create function public.%I(%s) returns %s language sql security invoker set search_path = %L as %L',f.proname,f.args,f.result,'',format('select private.%I(%s)',f.proname,placeholders));
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',f.proname,f.args);
  audience:=case when f.proname in ('prepare_run','claim_job','mark_dispatch','save_response','fail_job','commit_job','requalify_lead') then 'service_role' else 'authenticated' end;
  execute format('grant execute on function public.%I(%s) to %I',f.proname,f.args,audience);
 end loop;
end $$;
