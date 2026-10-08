-- Saved X-Ray searches, and imports that span several variations of one.
--
-- A recruiter who finds a search that works wants to run it again next week
-- and see only the people who have appeared since. A template keeps the
-- fields, the country, how many pages and how the search is split, by name,
-- on the role. Splitting one search into a few (one per location, say) means
-- an import can now cover up to five searches of ten pages each.
begin;

create table public.role_xray_templates (
 id uuid primary key default gen_random_uuid(),
 role_id uuid not null references public.roles(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 80),
 inputs jsonb not null check(jsonb_typeof(inputs)='object'),
 custom_query text check(custom_query is null or length(custom_query) between 1 and 1000),
 country text not null check(country ~ '^[a-z]{2}$'),
 pages integer not null check(pages between 1 and 10),
 split text not null default 'none' check(split in ('none','location','titles')),
 created_by uuid not null references public.user_profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index role_xray_templates_name on public.role_xray_templates(role_id,lower(btrim(name)));
alter table public.role_xray_templates enable row level security;
revoke all on public.role_xray_templates from public,anon,authenticated;
grant select on public.role_xray_templates to authenticated;
grant all on public.role_xray_templates to service_role;
create policy agency_read on public.role_xray_templates for select to authenticated using ((select private.is_admin()));

-- Saving under a name the role already uses replaces that search.
create function private.save_role_xray_template(p_role uuid,p_name text,p_inputs jsonb,p_custom text,p_country text,p_pages integer,p_split text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text:=btrim(coalesce(p_name,''));
begin
 perform private.require_admin(auth.uid());
 perform 1 from public.roles where id=p_role and not archived;
 if not found then raise exception 'LS: Restore this role before saving searches.'; end if;
 if length(v_name) not between 1 and 80 then raise exception 'LS: Name the search in 80 characters or fewer.'; end if;
 if p_inputs is null or jsonb_typeof(p_inputs)<>'object' or length(p_inputs::text)>4000 then raise exception 'LS: Check the search fields.'; end if;
 if p_custom is not null and (length(p_custom) not between 1 and 1000 or p_custom not like '%site:linkedin.com/in/%') then raise exception 'LS: Check the LinkedIn query.'; end if;
 if (select count(*) from public.role_xray_templates where role_id=p_role and lower(btrim(name))<>lower(v_name))>=30 then raise exception 'LS: A role can keep 30 saved searches. Delete one first.'; end if;
 insert into public.role_xray_templates(role_id,name,inputs,custom_query,country,pages,split,created_by)
 values(p_role,v_name,p_inputs,p_custom,p_country,p_pages,coalesce(p_split,'none'),auth.uid())
 on conflict (role_id,lower(btrim(name))) do update set name=excluded.name,inputs=excluded.inputs,custom_query=excluded.custom_query,
  country=excluded.country,pages=excluded.pages,split=excluded.split,updated_at=now()
 returning id into v_id;
 return v_id;
end $$;
create function public.save_role_xray_template(p_role uuid,p_name text,p_inputs jsonb,p_custom text,p_country text,p_pages integer,p_split text)
returns uuid language sql security invoker set search_path='' as $$ select private.save_role_xray_template(p_role,p_name,p_inputs,p_custom,p_country,p_pages,p_split); $$;

create function private.delete_role_xray_template(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 delete from public.role_xray_templates where id=p_id;
 return found;
end $$;
create function public.delete_role_xray_template(p_id uuid) returns boolean language sql security invoker set search_path='' as $$ select private.delete_role_xray_template(p_id); $$;

-- Up to five variations of ten pages each in one import. The dialog sends the
-- people in batches of 200, the most one import_candidates call takes.
create or replace function private.import_role_xray_runs(p_role uuid,p_searches uuid[],p_urls text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client uuid; rows jsonb; blocked integer; summary jsonb;
begin
 perform private.require_admin(auth.uid());
 select r.client_id into v_client from public.roles r join public.clients c on c.id=r.client_id where r.id=p_role and not r.archived and not c.archived for update of r;
 if not found then raise exception 'LS: Restore this role and client before importing.'; end if;
 if coalesce(cardinality(p_urls),0) not between 1 and 200 then raise exception 'LS: Select search results to import.'; end if;
 if coalesce(cardinality(p_searches),0) not between 1 and 60
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

do $$ declare signature text; begin
 foreach signature in array array['save_role_xray_template(uuid,text,jsonb,text,text,integer,text)','delete_role_xray_template(uuid)'] loop
  execute 'revoke all on function private.'||signature||' from public,anon,authenticated';
  execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
  execute 'grant execute on function private.'||signature||' to authenticated';
  execute 'grant execute on function public.'||signature||' to authenticated';
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
