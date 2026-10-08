-- X-Ray searches that read several Google pages and keep only new people.
--
-- A search used to be one page at a time, five at most, and the results said
-- nothing about who the role already had. A recruiter now asks for up to ten
-- pages in one go, sees which results are already on the role (any stage) or
-- blocklisted, and imports the new ones across every page they fetched.
begin;

alter table public.role_xray_searches drop constraint if exists role_xray_searches_page_check;
alter table public.role_xray_searches add constraint role_xray_searches_page_check check(page between 1 and 10);
-- A page already fetched for the same query is read back instead of paid for again.
create index if not exists role_xray_reuse on public.role_xray_searches(role_id,country,page,created_at desc) where status='complete';

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
 -- The same page of the same search in the last day costs nothing to show again.
 select * into previous from public.role_xray_searches
  where role_id=p_role and query=p_query and country=p_country and page=p_page and status='complete' and created_at>now()-interval '1 day'
  order by created_at desc limit 1;
 if found then return to_jsonb(previous)||jsonb_build_object('existing',true); end if;
 if (select count(*) from public.role_xray_searches where created_by=auth.uid() and created_at>now()-interval '1 hour')>=150 then raise exception 'LS: Search limit reached. Try again after an hour.'; end if;
 insert into public.role_xray_searches(role_id,created_by,query,country,page,results,request_token) values(p_role,auth.uid(),p_query,p_country,p_page,'[]',p_token) returning id into search_id;
 return jsonb_build_object('id',search_id,'existing',false);
end $$;

-- Which of these LinkedIn URLs the role already has, at any stage, and which
-- the blocklist keeps out. Compared without case, as LinkedIn treats slugs.
create function private.role_xray_known(p_role uuid,p_urls text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_client uuid; in_role jsonb; blocked jsonb;
begin
 perform private.require_admin(auth.uid());
 select client_id into v_client from public.roles where id=p_role;
 if not found then raise exception 'LS: Role not found.'; end if;
 if coalesce(cardinality(p_urls),0)>500 then raise exception 'LS: Too many profiles to check.'; end if;
 select coalesce(jsonb_agg(distinct u),'[]') into in_role from unnest(coalesce(p_urls,'{}')) u
  where exists(select 1 from public.role_candidates rc join public.candidate_identities i on i.candidate_id=rc.candidate_id
   where rc.role_id=p_role and i.kind='linkedin' and lower(i.normalized_value)=lower(u));
 select coalesce(jsonb_agg(distinct u),'[]') into blocked from unnest(coalesce(p_urls,'{}')) u
  where exists(select 1 from public.recruiting_blocklist b where lower(b.linkedin_url)=lower(u) and (b.client_id is null or b.client_id=v_client));
 return jsonb_build_object('inRole',in_role,'blocked',blocked);
end $$;
create function public.role_xray_known(p_role uuid,p_urls text[]) returns jsonb language sql stable security invoker set search_path='' as $$ select private.role_xray_known(p_role,p_urls); $$;

-- Import picked results from any of the role's saved searches, so one import
-- covers every page of a run. Each URL is taken once, from its first search.
create function private.import_role_xray_runs(p_role uuid,p_searches uuid[],p_urls text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client uuid; rows jsonb; blocked integer; summary jsonb;
begin
 perform private.require_admin(auth.uid());
 select r.client_id into v_client from public.roles r join public.clients c on c.id=r.client_id where r.id=p_role and not r.archived and not c.archived for update of r;
 if not found then raise exception 'LS: Restore this role and client before importing.'; end if;
 if coalesce(cardinality(p_urls),0) not between 1 and 200 then raise exception 'LS: Select search results to import.'; end if;
 if coalesce(cardinality(p_searches),0) not between 1 and 20
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
create function public.import_role_xray_runs(p_role uuid,p_searches uuid[],p_urls text[]) returns jsonb language sql security invoker set search_path='' as $$ select private.import_role_xray_runs(p_role,p_searches,p_urls); $$;

do $$ declare signature text; begin
 foreach signature in array array['role_xray_known(uuid,text[])','import_role_xray_runs(uuid,uuid[],text[])'] loop
  execute 'revoke all on function private.'||signature||' from public,anon,authenticated';
  execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
  execute 'grant execute on function private.'||signature||' to authenticated';
  execute 'grant execute on function public.'||signature||' to authenticated';
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
