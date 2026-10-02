begin;

create table public.role_xray_searches (
 id uuid primary key default gen_random_uuid(), role_id uuid not null references public.roles(id),
 created_by uuid not null references public.user_profiles(id), query text not null check(length(query) between 1 and 1000),
 country text not null, page integer not null check(page between 1 and 5),
 results jsonb not null check(jsonb_typeof(results)='array' and jsonb_array_length(results)<=100),
 request_token uuid not null, status text not null default 'processing' check(status in ('processing','complete','failed')),
 unique(created_by,request_token),
 created_at timestamptz not null default now()
);
create index role_xray_recent on public.role_xray_searches(role_id,created_at desc);
alter table public.role_xray_searches enable row level security;
revoke all on public.role_xray_searches from public,anon,authenticated;
grant select on public.role_xray_searches to authenticated;
grant all on public.role_xray_searches to service_role;
create policy agency_read on public.role_xray_searches for select to authenticated using ((select private.is_admin()));

create function private.reserve_role_xray(p_role uuid,p_query text,p_country text,p_page integer,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.role_xray_searches; search_id uuid;
begin
 perform private.require_admin(auth.uid());
 perform 1 from public.roles r join public.clients c on c.id=r.client_id where r.id=p_role and not r.archived and not c.archived for update of r;
 if not found then raise exception 'LS: Restore this role and client before searching.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1986987));
 select * into previous from public.role_xray_searches where created_by=auth.uid() and request_token=p_token;
 if found then return to_jsonb(previous)||jsonb_build_object('existing',true); end if;
 if (select count(*) from public.role_xray_searches where created_by=auth.uid() and created_at>now()-interval '1 hour')>=50 then raise exception 'LS: Search limit reached. Try again after an hour.'; end if;
 if length(p_query) not between 1 and 1000 or p_query not like '%site:linkedin.com/in/%' or p_country !~ '^[a-z]{2}$' or p_page not between 1 and 5 or p_token is null then raise exception 'LS: Check the LinkedIn query, country and page.'; end if;
 insert into public.role_xray_searches(role_id,created_by,query,country,page,results,request_token) values(p_role,auth.uid(),p_query,p_country,p_page,'[]',p_token) returning id into search_id;
 return jsonb_build_object('id',search_id,'existing',false);
end $$;
create function public.reserve_role_xray(p_role uuid,p_query text,p_country text,p_page integer,p_token uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.reserve_role_xray(p_role,p_query,p_country,p_page,p_token); $$;
create function private.import_role_xray(p_role uuid,p_search uuid,p_urls text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client uuid; rows jsonb; blocked integer; summary jsonb;
begin
 perform private.require_admin(auth.uid());
 select r.client_id into v_client from public.roles r join public.clients c on c.id=r.client_id where r.id=p_role and not r.archived and not c.archived for update of r;
 if not found then raise exception 'LS: Restore this role and client before importing.'; end if;
 if coalesce(cardinality(p_urls),0) not between 1 and 100 then raise exception 'LS: Select search results to import.'; end if;
 if not exists(select 1 from public.role_xray_searches where id=p_search and role_id=p_role and status='complete') then raise exception 'LS: Search results not found for this role.'; end if;
 perform pg_advisory_xact_lock(1986987,10);
 if exists(select 1 from unnest(p_urls) u where not exists(select 1 from public.role_xray_searches s,jsonb_array_elements(s.results) item where s.id=p_search and item->>'url'=u)) then raise exception 'LS: Import only saved search results.'; end if;
 select count(*) into blocked from unnest(p_urls) u where exists(select 1 from public.recruiting_blocklist b where b.linkedin_url=u and (b.client_id is null or b.client_id=v_client));
 select jsonb_agg(jsonb_build_object('name',item->>'name','identities',jsonb_build_array(jsonb_build_object('kind','linkedin','value',item->>'url')),'fields',jsonb_build_object('headline',item->>'title'),'sourceDetail','Google X-Ray')) into rows
 from public.role_xray_searches s,jsonb_array_elements(s.results) item where s.id=p_search and item->>'url'=any(p_urls)
 and not exists(select 1 from public.recruiting_blocklist b where b.linkedin_url=item->>'url' and (b.client_id is null or b.client_id=v_client));
 if rows is null then return jsonb_build_object('created',0,'blocked',blocked); end if;
 summary:=private.import_candidates(v_client,p_role,rows,'google','all_profiles');
 return summary||jsonb_build_object('blocked',blocked);
end $$;
create function public.import_role_xray(p_role uuid,p_search uuid,p_urls text[]) returns jsonb language sql security invoker set search_path='' as $$ select private.import_role_xray(p_role,p_search,p_urls); $$;

create table public.candidate_mobile_numbers (
 candidate_id uuid not null references public.candidates(id) on delete cascade,
 number text not null check(number ~ '^[6-9][0-9]{9}$' or number ~ '^\+[1-9][0-9]{7,14}$'),
 provider text not null check(provider in ('database','signalhire','apollo','bettercontact')),
 found_at timestamptz not null default now(), primary key(candidate_id,number)
);
alter table public.candidate_mobile_numbers enable row level security;
revoke all on public.candidate_mobile_numbers from public,anon,authenticated;
grant select on public.candidate_mobile_numbers to authenticated;
grant all on public.candidate_mobile_numbers to service_role;
create policy agency_read on public.candidate_mobile_numbers for select to authenticated using ((select private.is_admin()));

-- Queue metadata and callback results are not exposed to authenticated clients.
create table public.mobile_waterfall_jobs (
 id uuid primary key default gen_random_uuid(), role_id uuid not null references public.roles(id),
 candidate_id uuid not null references public.candidates(id), created_by uuid not null references public.user_profiles(id),
 collect_all boolean not null default false,
 status text not null default 'queued' check(status in ('queued','running','waiting','waiting_setup','needs_review','complete','no_mobile','failed','cancelled')),
 provider_index integer not null default 0 check(provider_index between 0 and 4),
 attempt_state text not null default 'idle' check(attempt_state in ('idle','dispatching','pending')),
 identifier text not null, request_id text, callback_result jsonb,
 results jsonb not null default '[]', steps jsonb not null default '[]', error_code text,
 lease_token uuid, lease_until timestamptz, next_at timestamptz not null default now(),
 retries integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index mobile_one_active on public.mobile_waterfall_jobs(candidate_id)
 where status in ('queued','running','waiting','waiting_setup','needs_review');
create index mobile_queue on public.mobile_waterfall_jobs(next_at,created_at)
 where status in ('queued','running','waiting','waiting_setup');
create index mobile_role_recent on public.mobile_waterfall_jobs(role_id,created_at desc);
alter table public.mobile_waterfall_jobs enable row level security;
revoke all on public.mobile_waterfall_jobs from public,anon,authenticated;
grant all on public.mobile_waterfall_jobs to service_role;
create table private.mobile_worker_health (id boolean primary key default true check(id), last_seen timestamptz not null);
alter table private.mobile_worker_health enable row level security;
revoke all on private.mobile_worker_health from public,anon,authenticated;

create function private.start_mobile_waterfall(p_role uuid,p_ids uuid[],p_all boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare queued integer; eligible integer;
begin
 perform private.require_admin(auth.uid());
 if coalesce(cardinality(p_ids),0) not between 1 and 200 then raise exception 'LS: Select between 1 and 200 profiles.'; end if;
 perform 1 from public.roles r join public.clients c on c.id=r.client_id where r.id=p_role and not r.archived and not c.archived for update of r;
 if not found then raise exception 'LS: Restore this role and client first.'; end if;
 if (select count(distinct rc.candidate_id) from public.role_candidates rc where rc.role_id=p_role and rc.candidate_id=any(p_ids))<>(select count(distinct id) from unnest(p_ids) id) then raise exception 'LS: Select profiles belonging to this role.'; end if;
 select count(*) into eligible from public.candidates c where c.id=any(p_ids) and exists(select 1 from public.candidate_identities i where i.candidate_id=c.id and i.kind='linkedin');
 insert into public.mobile_waterfall_jobs(role_id,candidate_id,created_by,collect_all,identifier)
 select p_role,c.id,auth.uid(),p_all,i.normalized_value from public.candidates c join public.candidate_identities i on i.candidate_id=c.id and i.kind='linkedin' where c.id=any(p_ids)
 on conflict do nothing;
 get diagnostics queued=row_count;
 return jsonb_build_object('queued',queued,'alreadyRunning',eligible-queued,'missingLinkedIn',(select count(distinct id) from unnest(p_ids) id)-eligible);
end $$;
create function public.start_mobile_waterfall(p_role uuid,p_ids uuid[],p_all boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.start_mobile_waterfall(p_role,p_ids,p_all); $$;

create function private.mobile_waterfall_status(p_role uuid,p_candidate uuid default null,p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 if p_page not between 1 and 10000 then raise exception 'LS: Invalid page.'; end if;
 return jsonb_build_object('workerOnline',exists(select 1 from private.mobile_worker_health where last_seen>now()-interval '90 seconds'),
 'total',(select count(*) from public.mobile_waterfall_jobs where role_id=p_role and (p_candidate is null or candidate_id=p_candidate)),
 'jobs',coalesce((select jsonb_agg(row) from (select j.id,j.candidate_id,c.full_name candidate_name,j.status,j.provider_index,j.collect_all,j.results,j.steps,j.error_code,j.created_at,j.updated_at from public.mobile_waterfall_jobs j join public.candidates c on c.id=j.candidate_id where j.role_id=p_role and (p_candidate is null or j.candidate_id=p_candidate) order by j.created_at desc,j.id limit 25 offset (p_page-1)*25) row),'[]'::jsonb));
end $$;
create function public.mobile_waterfall_status(p_role uuid,p_candidate uuid default null,p_page integer default 1) returns jsonb language sql security invoker set search_path='' as $$ select private.mobile_waterfall_status(p_role,p_candidate,p_page); $$;

create function private.mobile_waterfall_summary(p_role uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 return jsonb_build_object('active',(select count(*) from public.mobile_waterfall_jobs where role_id=p_role and status in ('queued','running','waiting','waiting_setup')),
 'review',(select count(*) from public.mobile_waterfall_jobs where role_id=p_role and status='needs_review'),
 'resultVersion',(select max(n.found_at) from public.candidate_mobile_numbers n join public.role_candidates rc on rc.candidate_id=n.candidate_id where rc.role_id=p_role));
end $$;
create function public.mobile_waterfall_summary(p_role uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.mobile_waterfall_summary(p_role); $$;

create function private.control_mobile_waterfall(p_role uuid,p_id uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare j public.mobile_waterfall_jobs;
begin
 perform private.require_admin(auth.uid());
 select * into j from public.mobile_waterfall_jobs where id=p_id and role_id=p_role for update;
 if not found then raise exception 'LS: Lookup not found.'; end if;
 if p_action='cancel' then
  update public.mobile_waterfall_jobs set status='cancelled',lease_token=null,lease_until=null,updated_at=now() where id=p_id and status not in ('complete','no_mobile','cancelled');
 elsif p_action='retry' and j.status='needs_review' then
  update public.mobile_waterfall_jobs set status='queued',attempt_state='idle',request_id=null,callback_result=null,lease_token=null,lease_until=null,error_code=null,retries=0,next_at=now(),updated_at=now() where id=p_id;
 else raise exception 'LS: This lookup cannot be retried.'; end if;
end $$;
create function public.control_mobile_waterfall(p_role uuid,p_id uuid,p_action text) returns void language sql security invoker set search_path='' as $$ select private.control_mobile_waterfall(p_role,p_id,p_action); $$;

-- Service-only queue operations. A lease protects every write from stale workers.
create function private.claim_mobile_waterfall() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.mobile_waterfall_jobs; token uuid:=gen_random_uuid();
begin
 insert into private.mobile_worker_health(id,last_seen) values(true,now()) on conflict(id) do update set last_seen=excluded.last_seen;
 -- An interrupted non-idempotent POST must not silently charge the account twice.
 update public.mobile_waterfall_jobs set status='needs_review',error_code='dispatch_outcome_unknown',lease_token=null,lease_until=null,updated_at=now()
 where status='running' and attempt_state='dispatching' and provider_index>0 and lease_until<now() and request_id is null and callback_result is null;
 update public.mobile_waterfall_jobs pending set status='cancelled',lease_token=null,lease_until=null,error_code='role_unavailable',updated_at=now()
 where status in ('queued','running','waiting','waiting_setup') and (exists(select 1 from public.roles r join public.clients c on c.id=r.client_id where r.id=pending.role_id and (r.archived or c.archived)) or not exists(select 1 from public.role_candidates rc where rc.role_id=pending.role_id and rc.candidate_id=pending.candidate_id));
 update public.mobile_waterfall_jobs pending set status='failed',error_code='access_revoked',lease_token=null,lease_until=null,updated_at=now()
 where status in ('queued','running','waiting','waiting_setup') and not exists(select 1 from public.user_profiles where id=pending.created_by and is_agency_admin);
 select * into j from public.mobile_waterfall_jobs where status in ('queued','running','waiting','waiting_setup') and next_at<=now() and (lease_until is null or lease_until<now()) order by next_at,created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.mobile_waterfall_jobs set status='running',lease_token=token,lease_until=now()+interval '2 minutes',updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('candidate',(select jsonb_build_object('name',full_name,'company',current_company,'phone',phone,'alternate_phone',alternate_phone,'email',email) from public.candidates where id=j.candidate_id),
 'cached',coalesce((select jsonb_agg(jsonb_build_object('number',number,'provider','database')) from public.candidate_mobile_numbers where candidate_id=j.candidate_id),'[]'::jsonb));
end $$;

create function private.save_mobile_waterfall(p_id uuid,p_token uuid,p_patch jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.mobile_waterfall_jobs; result jsonb; mobile text; idx integer;
begin
 select * into j from public.mobile_waterfall_jobs where id=p_id and lease_token=p_token and lease_until>now() and status='running' for update;
 if not found then return false; end if;
 if not exists(select 1 from public.roles r join public.clients c on c.id=r.client_id join public.role_candidates rc on rc.role_id=r.id where r.id=j.role_id and rc.candidate_id=j.candidate_id and not r.archived and not c.archived)
 or not exists(select 1 from public.user_profiles where id=j.created_by and is_agency_admin) then
  update public.mobile_waterfall_jobs set status='cancelled',error_code='role_unavailable',lease_token=null,lease_until=null,updated_at=now() where id=p_id; return false;
 end if;
 if not exists(select 1 from public.candidate_identities where candidate_id=j.candidate_id and kind='linkedin' and normalized_value=j.identifier) then
  update public.mobile_waterfall_jobs set status='failed',error_code='profile_identity_changed',lease_token=null,lease_until=null,updated_at=now() where id=p_id; return false;
 end if;
 idx:=coalesce((p_patch->>'provider_index')::integer,j.provider_index);
 update public.mobile_waterfall_jobs set status=coalesce(p_patch->>'status',status),provider_index=idx,
  attempt_state=coalesce(p_patch->>'attempt_state',attempt_state),request_id=case when p_patch ? 'request_id' then p_patch->>'request_id' else request_id end,
  callback_result=case when idx<>j.provider_index then null else callback_result end,
  results=coalesce(p_patch->'results',results),steps=coalesce(p_patch->'steps',steps),error_code=p_patch->>'error_code',
  retries=coalesce((p_patch->>'retries')::integer,retries),next_at=now()+make_interval(secs=>greatest(0,least(3600,coalesce((p_patch->>'delay')::integer,0)))),
  lease_token=case when p_patch->>'status'='running' then lease_token else null end,
  lease_until=case when p_patch->>'status'='running' then lease_until else null end,updated_at=now() where id=p_id;
 if p_patch ? 'results' then
  perform set_config('request.jwt.claim.sub',j.created_by::text,true);
  perform 1 from public.candidates where id=j.candidate_id for update;
  for result in select * from jsonb_array_elements(p_patch->'results') loop
   mobile:=result->>'number';
   insert into public.candidate_mobile_numbers(candidate_id,number,provider) values(j.candidate_id,mobile,result->>'provider') on conflict do nothing;
   -- Do not replace recruiter data. Foreign mobiles stay in the result sheet;
   -- the existing application currently accepts Indian ten-digit phone cells.
   if mobile ~ '^[6-9][0-9]{9}$' then
    update public.candidates set phone=mobile,enrichment_state='found',enriched_at=now(),updated_at=now() where id=j.candidate_id and phone is null and alternate_phone is distinct from mobile;
    update public.candidates set alternate_phone=mobile,enrichment_state='found',enriched_at=now(),updated_at=now() where id=j.candidate_id and alternate_phone is null and phone is distinct from mobile;
   end if;
  end loop;
 end if;
 return true;
end $$;

create function private.save_mobile_callback(p_id uuid,p_results jsonb,p_code text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.mobile_waterfall_jobs set callback_result=jsonb_build_object('results',p_results,'code',p_code),status=case when status='needs_review' then 'waiting' else status end,next_at=now(),updated_at=now()
 where id=p_id and provider_index=1 and status in ('running','waiting','needs_review') and callback_result is null;
 return found;
end $$;

create function public.claim_mobile_waterfall() returns jsonb language sql security invoker set search_path='' as $$ select private.claim_mobile_waterfall(); $$;
create function public.save_mobile_waterfall(p_id uuid,p_token uuid,p_patch jsonb) returns boolean language sql security invoker set search_path='' as $$ select private.save_mobile_waterfall(p_id,p_token,p_patch); $$;
create function public.save_mobile_callback(p_id uuid,p_results jsonb,p_code text) returns boolean language sql security invoker set search_path='' as $$ select private.save_mobile_callback(p_id,p_results,p_code); $$;
do $$ declare signature text; begin
 foreach signature in array array['start_mobile_waterfall(uuid,uuid[],boolean)','mobile_waterfall_status(uuid,uuid,integer)','mobile_waterfall_summary(uuid)','control_mobile_waterfall(uuid,uuid,text)','reserve_role_xray(uuid,text,text,integer,uuid)','import_role_xray(uuid,uuid,text[])'] loop
  execute 'revoke all on function private.'||signature||' from public,anon,authenticated';
  execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
  execute 'grant execute on function private.'||signature||' to authenticated';
  execute 'grant execute on function public.'||signature||' to authenticated';
 end loop;
end $$;
revoke all on function public.claim_mobile_waterfall(),public.save_mobile_waterfall(uuid,uuid,jsonb),public.save_mobile_callback(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_mobile_waterfall(),public.save_mobile_waterfall(uuid,uuid,jsonb),public.save_mobile_callback(uuid,jsonb,text) to service_role;
revoke all on function private.claim_mobile_waterfall(),private.save_mobile_waterfall(uuid,uuid,jsonb),private.save_mobile_callback(uuid,jsonb,text) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.claim_mobile_waterfall(),private.save_mobile_waterfall(uuid,uuid,jsonb),private.save_mobile_callback(uuid,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
