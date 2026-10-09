-- X-Ray as a page per role: many pasted queries run together, and a history
-- of every query run for the role that can be loaded back and imported.
begin;

-- Batches of pasted queries: up to 400 page fetches an hour per recruiter.
create or replace function private.reserve_role_xray(p_role uuid,p_query text,p_country text,p_page integer,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.role_xray_searches; search_id uuid;
begin
 perform private.require_admin(auth.uid());
 perform 1 from public.roles r join public.clients c on c.id=r.client_id where r.id=p_role and not r.archived and not c.archived for update of r;
 if not found then raise exception 'LS: Restore this role and client before searching.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1986987));
 select * into previous from public.role_xray_searches where created_by=auth.uid() and request_token=p_token;
 if found then return to_jsonb(previous)||jsonb_build_object('existing',true); end if;
 if length(p_query) not between 1 and 1000 or p_query not like '%site:linkedin.com/in/%' or p_country !~ '^[a-z]{2}$' or p_page not between 1 and 10 or p_token is null then raise exception 'LS: Check the LinkedIn query, country and page.'; end if;
 select * into previous from public.role_xray_searches
  where role_id=p_role and query=p_query and country=p_country and page=p_page and status='complete' and created_at>now()-interval '1 day'
  order by created_at desc limit 1;
 if found then return to_jsonb(previous)||jsonb_build_object('existing',true); end if;
 if (select count(*) from public.role_xray_searches where created_by=auth.uid() and created_at>now()-interval '1 hour')>=400 then raise exception 'LS: Search limit reached. Try again after an hour.'; end if;
 insert into public.role_xray_searches(role_id,created_by,query,country,page,results,request_token) values(p_role,auth.uid(),p_query,p_country,p_page,'[]',p_token) returning id into search_id;
 return jsonb_build_object('id',search_id,'existing',false);
end $$;

-- One import can draw on every page of a large batch.
create or replace function private.import_role_xray_runs(p_role uuid,p_searches uuid[],p_urls text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client uuid; rows jsonb; blocked integer; summary jsonb;
begin
 perform private.require_admin(auth.uid());
 select r.client_id into v_client from public.roles r join public.clients c on c.id=r.client_id where r.id=p_role and not r.archived and not c.archived for update of r;
 if not found then raise exception 'LS: Restore this role and client before importing.'; end if;
 if coalesce(cardinality(p_urls),0) not between 1 and 200 then raise exception 'LS: Select search results to import.'; end if;
 if coalesce(cardinality(p_searches),0) not between 1 and 500
  or exists(select 1 from unnest(p_searches) s where not exists(select 1 from public.role_xray_searches x where x.id=s and x.role_id=p_role and x.status='complete'))
  then raise exception 'LS: Search results not found for this role.'; end if;
 perform pg_advisory_xact_lock(1986987,10);
 if exists(select 1 from unnest(p_urls) u where not exists(select 1 from public.role_xray_searches s,jsonb_array_elements(s.results) item where s.id=any(p_searches) and item->>'url'=u)) then raise exception 'LS: Import only saved search results.'; end if;
 select count(distinct u) into blocked from unnest(p_urls) u where exists(select 1 from public.recruiting_blocklist b where b.linkedin_url=u and (b.client_id is null or b.client_id=v_client));
 select jsonb_agg(jsonb_build_object('name',item->>'name','identities',jsonb_build_array(jsonb_build_object('kind','linkedin','value',item->>'url')),'fields',jsonb_build_object('headline',item->>'title'),'sourceDetail','Google X-Ray') order by first_seen) into rows
 from (
  select distinct on (item->>'url') item, s.created_at as first_seen
  from public.role_xray_searches s,jsonb_array_elements(s.results) item
  where s.id=any(p_searches) and item->>'url'=any(p_urls)
   and not exists(select 1 from public.recruiting_blocklist b where b.linkedin_url=item->>'url' and (b.client_id is null or b.client_id=v_client))
  order by item->>'url', s.created_at
 ) picked;
 if rows is null then return jsonb_build_object('created',0,'blocked',blocked); end if;
 summary:=private.import_candidates(v_client,p_role,rows,'google','all_profiles');
 return summary||jsonb_build_object('blocked',blocked);
end $$;

-- A big batch or a loaded history can hold thousands of people to check.
create or replace function private.role_xray_known(p_role uuid,p_urls text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_client uuid; in_role jsonb; blocked jsonb;
begin
 perform private.require_admin(auth.uid());
 select client_id into v_client from public.roles where id=p_role;
 if not found then raise exception 'LS: Role not found.'; end if;
 if coalesce(cardinality(p_urls),0)>5000 then raise exception 'LS: Too many profiles to check.'; end if;
 with asked as (select distinct u, lower(u) as l from unnest(coalesce(p_urls,'{}')) u),
  have as (select distinct lower(i.normalized_value) as l from public.role_candidates rc
   join public.candidate_identities i on i.candidate_id=rc.candidate_id and i.kind='linkedin' where rc.role_id=p_role)
 select coalesce(jsonb_agg(a.u),'[]') into in_role from asked a where exists(select 1 from have h where h.l=a.l);
 select coalesce(jsonb_agg(distinct u),'[]') into blocked from unnest(coalesce(p_urls,'{}')) u
  where exists(select 1 from public.recruiting_blocklist b where lower(b.linkedin_url)=lower(u) and (b.client_id is null or b.client_id=v_client));
 return jsonb_build_object('inRole',in_role,'blocked',blocked);
end $$;

-- Every query run for the role, newest first: how many pages, how many
-- people it found, and how many of them the role still does not have.
create function private.role_xray_history(p_role uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_client uuid;
begin
 perform private.require_admin(auth.uid());
 select client_id into v_client from public.roles where id=p_role;
 if not found then raise exception 'LS: Role not found.'; end if;
 return coalesce((
  with latest as (
   select distinct on (query,country,page) id,query,country,page,results,created_at
   from public.role_xray_searches where role_id=p_role and status='complete'
   order by query,country,page,created_at desc
  ), found as (
   select distinct l.query,l.country,item->>'url' as url from latest l, jsonb_array_elements(l.results) item
  ), known as (
   select distinct lower(i.normalized_value) as url from public.role_candidates rc
   join public.candidate_identities i on i.candidate_id=rc.candidate_id and i.kind='linkedin' where rc.role_id=p_role
  ), groups as (
   select l.query,l.country,count(*) as pages,max(l.page) as last_page,max(l.created_at) as last_run,
    array_agg(l.id order by l.page) as search_ids
   from latest l group by l.query,l.country
  )
  select jsonb_agg(jsonb_build_object(
   'query',g.query,'country',g.country,'pages',g.pages,'lastPage',g.last_page,'lastRun',g.last_run,'searchIds',g.search_ids,
   'profiles',(select count(*) from found f where f.query=g.query and f.country=g.country),
   'fresh',(select count(*) from found f where f.query=g.query and f.country=g.country
     and not exists(select 1 from known k where k.url=lower(f.url))
     and not exists(select 1 from public.recruiting_blocklist b where lower(b.linkedin_url)=lower(f.url) and (b.client_id is null or b.client_id=v_client)))
  ) order by g.last_run desc)
  from (select * from groups order by last_run desc limit 300) g
 ),'[]'::jsonb);
end $$;
create function public.role_xray_history(p_role uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.role_xray_history(p_role); $$;
revoke all on function private.role_xray_history(uuid), public.role_xray_history(uuid) from public, anon, authenticated;
grant execute on function private.role_xray_history(uuid), public.role_xray_history(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
