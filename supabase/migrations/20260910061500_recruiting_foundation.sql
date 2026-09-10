-- Recruiting CRM foundation: Client -> Role -> Candidate pipeline.
-- Purely additive. No existing table, view, function or grant is modified.
-- Candidate = person (agency-global, reusable). RoleCandidate = that person's
-- journey for one Role (client-scoped). Sourcing tables are untouched.
begin;

-- Agency-global master candidate. Deliberately has no client_id: reusable
-- contact and enrichment data is the entire purpose of the master database.
create table public.candidates (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check(length(trim(full_name)) between 1 and 200),
 headline text not null default '' check(length(headline)<=300),
 current_company text not null default '' check(length(current_company)<=200),
 current_designation text not null default '' check(length(current_designation)<=200),
 location text not null default '' check(length(location)<=200),
 total_experience_years numeric(4,1) check(total_experience_years between 0 and 70),
 phone text check(length(phone) between 1 and 40),
 email text check(length(email) between 3 and 320),
 resume_path text check(length(resume_path)<=400),
 enrichment_state text not null default 'none' check(enrichment_state in ('none','found','not_found','failed')),
 enriched_at timestamptz,
 created_by uuid not null references public.user_profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Dedupe key. Identity, never name: two people share a name, not a profile URL.
create table public.candidate_identities (
 id uuid primary key default gen_random_uuid(),
 candidate_id uuid not null references public.candidates(id) on delete cascade,
 kind text not null check(kind in ('linkedin','naukri','email','phone','external')),
 normalized_value text not null check(length(normalized_value) between 1 and 500),
 created_at timestamptz not null default now()
);
-- Only these kinds merge candidates. A shared office phone must never collapse
-- two people, so phone is stored and searchable but is not a merge key.
create unique index candidate_identity_key on public.candidate_identities(kind,normalized_value)
 where kind in ('linkedin','naukri','email','external');
create index candidate_identity_phone on public.candidate_identities(normalized_value) where kind='phone';
create index candidate_identity_owner on public.candidate_identities(candidate_id);

create table public.roles (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
 name text not null check(length(trim(name)) between 1 and 120),
 description text not null default '' check(length(description)<=4000),
 rating_threshold smallint not null default 3 check(rating_threshold between 0 and 5),
 status text not null default 'open' check(status in ('open','on_hold','closed')),
 archived boolean not null default false, revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,client_id)
);
create index roles_client on public.roles(client_id,archived,updated_at desc);

-- One person's journey for one role. Every role-specific field lives here, so
-- the same candidate joins a second role without duplicating contact data.
create table public.role_candidates (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, role_id uuid not null,
 candidate_id uuid not null references public.candidates(id),
 stage text not null default 'all_profiles'
  check(stage in ('all_profiles','profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent','rejected')),
 rating smallint check(rating between 0 and 5),
 rated_by uuid references public.user_profiles(id), rated_at timestamptz,
 threshold_at_rating smallint check(threshold_at_rating between 0 and 5),
 source text not null default 'manual'
  check(source in ('linkedin','naukri','manual','url_paste','csv','sourcing_import','other')),
 source_detail text not null default '' check(length(source_detail)<=500),
 screening jsonb not null default '{}' check(jsonb_typeof(screening)='object'),
 custom jsonb not null default '{}' check(jsonb_typeof(custom)='object'),
 internal_notes text not null default '' check(length(internal_notes)<=4000),
 client_notes text not null default '' check(length(client_notes)<=4000),
 client_decision text check(client_decision in ('shortlisted','rejected','hold')),
 interview_at timestamptz,
 rejected_at timestamptz, rejected_by uuid references public.user_profiles(id),
 rejection_type text check(rejection_type in ('recruiter','client')),
 rejection_reason text not null default '' check(length(rejection_reason)<=4000),
 outcome text check(outcome in ('offer_sent','offer_accepted','offer_declined','joined')),
 outcome_at timestamptz,
 stage_entered_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(role_id,candidate_id), unique(id,client_id),
 foreign key(role_id,client_id) references public.roles(id,client_id),
 -- A rejected row always carries a type; an active row never does.
 constraint rejection_matches_stage check((stage='rejected')=(rejection_type is not null)),
 -- The reason is mandatory in the table, not only in the RPC that writes it.
 constraint rejection_reason_required check(rejection_type is null or length(trim(rejection_reason))>0)
);
create index role_candidates_stage on public.role_candidates(client_id,role_id,stage,updated_at desc);
create index role_candidates_person on public.role_candidates(candidate_id);

-- Append-only history. created_at is never rewritten; time-in-stage and
-- conversion reporting read from here alone.
create table public.role_candidate_events (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, role_candidate_id uuid not null,
 kind text not null check(kind in ('import','stage','rating','reject','client_decision','screening')),
 from_stage text, to_stage text,
 actor uuid references public.user_profiles(id), -- null: a client acting through a share link
 share_link_id uuid,                             -- foreign key arrives with role_share_links
 reason text not null default '' check(length(reason)<=4000),
 detail jsonb not null default '{}' check(jsonb_typeof(detail)='object'),
 created_at timestamptz not null default now(),
 foreign key(role_candidate_id,client_id) references public.role_candidates(id,client_id)
);
create index role_candidate_history on public.role_candidate_events(role_candidate_id,created_at desc);
create index role_events_client on public.role_candidate_events(client_id,created_at desc);

-- Same boundary as the sourcing tables: no direct writes, reads for approved
-- operators only, anon reaches nothing.
do $$ declare t text; begin
 foreach t in array array['candidates','candidate_identities','roles','role_candidates','role_candidate_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy admin_read on public.%I for select to authenticated using ((select private.is_admin()))',t);
 end loop;
end $$;

create function private.save_role(p_id uuid,p_client uuid,p_name text,p_description text,p_threshold integer,p_revision integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.roles; begin
 perform private.require_admin(auth.uid());
 if p_threshold is null or p_threshold not between 0 and 5 then raise exception 'LS: Choose a rating threshold between 0 and 5.'; end if;
 if length(trim(coalesce(p_name,'')))=0 or length(p_name)>120 then raise exception 'LS: Enter a role name.'; end if;
 perform 1 from public.clients where id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this client before editing roles.'; end if;
 if p_id is null then
  insert into public.roles(client_id,name,description,rating_threshold)
   values(p_client,trim(p_name),coalesce(p_description,''),p_threshold::smallint) returning * into r;
 else
  select * into r from public.roles where id=p_id and client_id=p_client for update;
  if not found then raise exception 'LS: Role not found.'; end if;
  if r.revision is distinct from p_revision then raise exception 'LS: Another operator saved changes. Reload before saving.'; end if;
  -- Threshold changes are never retroactive: no role_candidates row is touched
  -- here. Re-evaluating existing candidates is a separate, confirmed action.
  update public.roles set name=trim(p_name),description=coalesce(p_description,''),
   rating_threshold=p_threshold::smallint,revision=revision+1,updated_at=now() where id=r.id returning * into r;
 end if;
 return r.id;
end $$;

create function private.archive_role(p_id uuid,p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 update public.roles set archived=p_archived,updated_at=now() where id=p_id;
 if not found then raise exception 'LS: Role not found.'; end if;
end $$;

-- Resolves a person by identity before creating one, so the same LinkedIn URL
-- never produces a second master record and never re-spends enrichment.
create function private.upsert_candidate(p_name text,p_identities jsonb,p_fields jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ids uuid[]; e jsonb; k text; v text; n integer:=0;
 f jsonb:=coalesce(p_fields,'{}'::jsonb); begin
 perform private.require_admin(auth.uid());
 if length(trim(coalesce(p_name,'')))=0 or length(p_name)>200 then raise exception 'LS: Enter a candidate name.'; end if;
 if jsonb_typeof(f)<>'object' then raise exception 'LS: Invalid candidate details.'; end if;
 if p_identities is null or jsonb_typeof(p_identities)<>'array'
  or jsonb_array_length(p_identities) not between 1 and 10 then
  raise exception 'LS: Add between 1 and 10 candidate identities.'; end if;
 for e in select * from jsonb_array_elements(p_identities) loop
  k:=e->>'kind'; v:=e->>'value';
  if k is null or k not in ('linkedin','naukri','email','phone','external') then
   raise exception 'LS: Unsupported candidate identity type.'; end if;
  if v is null or length(v) not between 1 and 500 then raise exception 'LS: Enter a valid candidate identity.'; end if;
  if k='linkedin' and v !~ '^https://www[.]linkedin[.]com/in/[^/?#[:space:]]+$' then
   raise exception 'LS: Use a valid LinkedIn profile URL.'; end if;
  if k='email' and v !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
   raise exception 'LS: Use a valid email address.'; end if;
  if k in ('linkedin','naukri','email','external') then n:=n+1; end if;
 end loop;
 if n=0 then raise exception 'LS: Add a LinkedIn, Naukri, email or external identity so this candidate can be matched.'; end if;
 -- One identity must never resolve to two people; an ambiguous import stops
 -- rather than silently merging two master records.
 select array_agg(distinct i.candidate_id) into v_ids
  from public.candidate_identities i
  join jsonb_array_elements(p_identities) x
   on x.value->>'kind'=i.kind and x.value->>'value'=i.normalized_value
  where i.kind in ('linkedin','naukri','email','external');
 if coalesce(array_length(v_ids,1),0)>1 then
  raise exception 'LS: These identities already belong to different candidates. Resolve the duplicate before importing.'; end if;
 v_id:=v_ids[1];
 if v_id is null then
  insert into public.candidates(full_name,headline,current_company,current_designation,location,
   total_experience_years,phone,email,created_by)
   values(trim(p_name),coalesce(f->>'headline',''),coalesce(f->>'currentCompany',''),
    coalesce(f->>'currentDesignation',''),coalesce(f->>'location',''),
    (f->>'totalExperienceYears')::numeric,nullif(f->>'phone',''),nullif(f->>'email',''),auth.uid())
   returning id into v_id;
 else
  -- Never overwrite reusable contact data with a blank from a thinner source.
  update public.candidates set
   headline=case when coalesce(f->>'headline','')='' then headline else f->>'headline' end,
   current_company=case when coalesce(f->>'currentCompany','')='' then current_company else f->>'currentCompany' end,
   current_designation=case when coalesce(f->>'currentDesignation','')='' then current_designation else f->>'currentDesignation' end,
   location=case when coalesce(f->>'location','')='' then location else f->>'location' end,
   total_experience_years=coalesce((f->>'totalExperienceYears')::numeric,total_experience_years),
   phone=coalesce(nullif(f->>'phone',''),phone), email=coalesce(nullif(f->>'email',''),email),
   updated_at=now() where id=v_id;
 end if;
 insert into public.candidate_identities(candidate_id,kind,normalized_value)
  select distinct v_id,x.value->>'kind',x.value->>'value' from jsonb_array_elements(p_identities) x
  where not exists(select 1 from public.candidate_identities c
   where c.candidate_id=v_id and c.kind=x.value->>'kind' and c.normalized_value=x.value->>'value')
  on conflict do nothing;
 return v_id;
end $$;

create function private.add_candidates_to_role(p_client uuid,p_role uuid,p_candidate_ids uuid[],p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_added integer; v_total integer; begin
 perform private.require_admin(auth.uid());
 if p_candidate_ids is null or cardinality(p_candidate_ids) not between 1 and 200 then
  raise exception 'LS: Add between 1 and 200 candidates at a time.'; end if;
 if p_source is null or p_source not in ('linkedin','naukri','manual','url_paste','csv','sourcing_import','other') then
  raise exception 'LS: Unsupported candidate source.'; end if;
 -- Client lock first, matching the sourcing lock order (client, role, candidate).
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'LS: Client not found.'; end if;
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this role before adding candidates.'; end if;
 select count(distinct u) into v_total from unnest(p_candidate_ids) u;
 if (select count(*) from public.candidates where id=any(p_candidate_ids))<>v_total then
  raise exception 'LS: Some candidates no longer exist. Reload and try again.'; end if;
 with wanted as (select distinct unnest(p_candidate_ids) as cid),
 ins as (
  insert into public.role_candidates(client_id,role_id,candidate_id,source)
  select p_client,p_role,cid,p_source from wanted
  on conflict(role_id,candidate_id) do nothing
  returning id,candidate_id
 ), history as (
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,to_stage,actor,detail)
  select p_client,id,'import','all_profiles',auth.uid(),
   jsonb_build_object('source',p_source,'candidateId',candidate_id) from ins
  returning id
 ) select count(*) into v_added from history;
 return jsonb_build_object('added',v_added,'alreadyInRole',v_total-v_added);
end $$;

create function private.move_stage(p_client uuid,p_ids uuid[],p_to_stage text,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 if p_ids is null or cardinality(p_ids) not between 1 and 200 then raise exception 'LS: Select between 1 and 200 candidates.'; end if;
 if length(coalesce(p_reason,''))>4000 then raise exception 'LS: Shorten this note before saving.'; end if;
 -- Rejection carries a mandatory reason, so it never arrives through this path.
 if p_to_stage is null or p_to_stage not in
  ('all_profiles','profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent') then
  raise exception 'LS: Choose a valid pipeline stage.'; end if;
 perform 1 from public.clients where id=p_client for update;
 if (select count(*) from public.role_candidates where client_id=p_client and id=any(p_ids))
  <>(select count(distinct u) from unnest(p_ids) u) then
  raise exception 'LS: Selection is not in this client.'; end if;
 perform 1 from public.role_candidates where client_id=p_client and id=any(p_ids) order by id for update;
 -- prev is read from the pre-update snapshot, so from_stage is the real origin.
 -- Rows already in the target stage are skipped: no duplicate history, and
 -- stage_entered_at keeps meaning "when this stage was actually entered".
 with prev as (
  select id,stage from public.role_candidates
  where client_id=p_client and id=any(p_ids) and stage is distinct from p_to_stage
 ), moved as (
  update public.role_candidates rc set stage=p_to_stage,stage_entered_at=now(),updated_at=now(),
   rejected_at=null,rejected_by=null,rejection_type=null,rejection_reason=''
  from prev where rc.id=prev.id
  returning rc.id,prev.stage as from_stage
 )
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason)
 select p_client,id,'stage',from_stage,p_to_stage,auth.uid(),coalesce(p_reason,'') from moved;
end $$;

create function private.reject_candidate(p_client uuid,p_ids uuid[],p_type text,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 if p_ids is null or cardinality(p_ids) not between 1 and 200 then raise exception 'LS: Select between 1 and 200 candidates.'; end if;
 if p_type is null or p_type not in ('recruiter','client') then
  raise exception 'LS: Choose whether this is a recruiter or client rejection.'; end if;
 if length(trim(coalesce(p_reason,'')))=0 then raise exception 'LS: Enter a reason to reject this candidate.'; end if;
 if length(p_reason)>4000 then raise exception 'LS: Shorten this rejection reason before saving.'; end if;
 perform 1 from public.clients where id=p_client for update;
 if (select count(*) from public.role_candidates where client_id=p_client and id=any(p_ids))
  <>(select count(distinct u) from unnest(p_ids) u) then
  raise exception 'LS: Selection is not in this client.'; end if;
 perform 1 from public.role_candidates where client_id=p_client and id=any(p_ids) order by id for update;
 -- History is written from the pre-update snapshot so from_stage is preserved.
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason,detail)
  select p_client,id,'reject',stage,'rejected',auth.uid(),p_reason,jsonb_build_object('rejectionType',p_type)
  from public.role_candidates where client_id=p_client and id=any(p_ids) and stage is distinct from 'rejected';
 update public.role_candidates set stage='rejected',stage_entered_at=now(),updated_at=now(),
  rejected_at=now(),rejected_by=auth.uid(),rejection_type=p_type,rejection_reason=p_reason
  where client_id=p_client and id=any(p_ids) and stage is distinct from 'rejected';
end $$;

-- Public entry points are invoker wrappers only. The definer implementations
-- stay in the unexposed private schema and authorize the actor themselves.
create function public.save_role(p_id uuid,p_client uuid,p_name text,p_description text,p_threshold integer,p_revision integer)
returns uuid language sql security invoker set search_path='' as $$
 select private.save_role(p_id,p_client,p_name,p_description,p_threshold,p_revision);
$$;
create function public.archive_role(p_id uuid,p_archived boolean)
returns void language sql security invoker set search_path='' as $$
 select private.archive_role(p_id,p_archived);
$$;
create function public.upsert_candidate(p_name text,p_identities jsonb,p_fields jsonb)
returns uuid language sql security invoker set search_path='' as $$
 select private.upsert_candidate(p_name,p_identities,p_fields);
$$;
create function public.add_candidates_to_role(p_client uuid,p_role uuid,p_candidate_ids uuid[],p_source text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.add_candidates_to_role(p_client,p_role,p_candidate_ids,p_source);
$$;
create function public.move_stage(p_client uuid,p_ids uuid[],p_to_stage text,p_reason text)
returns void language sql security invoker set search_path='' as $$
 select private.move_stage(p_client,p_ids,p_to_stage,p_reason);
$$;
create function public.reject_candidate(p_client uuid,p_ids uuid[],p_type text,p_reason text)
returns void language sql security invoker set search_path='' as $$
 select private.reject_candidate(p_client,p_ids,p_type,p_reason);
$$;

-- Explicit execution grants on both halves: an invoker wrapper runs with the
-- caller's privileges, so authenticated needs execute on the private function.
do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in
   ('save_role','archive_role','upsert_candidate','add_candidates_to_role','move_stage','reject_candidate') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

commit;
