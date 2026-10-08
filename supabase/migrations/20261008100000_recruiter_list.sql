-- The people a role can be assigned to, as a list rather than whatever was
-- typed.
--
-- Recruiter tags were free text, comma separated, so "Tisha", "tisha" and
-- "Tisha " were three different people to the filter that finds a
-- recruiter's roles. They are now chosen from a short list the agency keeps,
-- one dropdown per role, the way a candidate's source is chosen. No role had
-- a tag yet, so there is nothing to convert.
begin;

create table public.recruiters (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 1 and 120 and name=trim(name)),
 archived boolean not null default false,
 created_at timestamptz not null default now()
);
-- One person, however their name is capitalised.
create unique index recruiters_name on public.recruiters(lower(name));
alter table public.recruiters enable row level security;
revoke all on public.recruiters from public,anon,authenticated;
grant select on public.recruiters to authenticated;
grant all on public.recruiters to service_role;
create policy admin_read on public.recruiters for select to authenticated using ((select private.is_admin()));

insert into public.recruiters(name) values ('Tisha'),('Anshika');

-- Add a name, or bring back one that was removed.
create function private.save_recruiter(p_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_name text:=trim(coalesce(p_name,'')); v_id uuid;
begin
 perform private.require_admin(auth.uid());
 if length(v_name) not between 1 and 120 then raise exception 'LS: Enter a recruiter name.'; end if;
 select id into v_id from public.recruiters where lower(name)=lower(v_name) for update;
 if found then
  update public.recruiters set archived=false where id=v_id;
  return v_id;
 end if;
 insert into public.recruiters(name) values(v_name) returning id into v_id;
 return v_id;
end $$;

-- Removing a name stops it being offered. Roles already tagged with it keep
-- the tag, so nobody's history changes because somebody left.
create function private.archive_recruiter(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 update public.recruiters set archived=true where id=p_id;
 if not found then raise exception 'LS: Recruiter not found.'; end if;
end $$;

-- The dropdown in the roles list. Takes a list so a role could carry more
-- than one person later; the dropdown sends one, or none to unassign. A name
-- has to be on the active list, or already on this role - so re-saving a role
-- whose recruiter has since been removed does not fail.
create function private.set_role_recruiters(p_role uuid,p_names text[])
returns text[] language plpgsql security definer set search_path='' as $$
declare v_current text[]; v_names text[];
begin
 perform private.require_admin(auth.uid());
 select recruiter_names into v_current from public.roles where id=p_role for update;
 if not found then raise exception 'LS: Role not found.'; end if;
 select coalesce(array_agg(distinct trim(n)),'{}') into v_names
  from unnest(coalesce(p_names,'{}')) n where trim(n)<>'';
 if cardinality(v_names)>20 then raise exception 'LS: A role can have at most 20 recruiters.'; end if;
 if exists(
  select 1 from unnest(v_names) n
  where not exists(select 1 from public.recruiters r where r.name=n and not r.archived)
   and not (n=any(v_current))
 ) then raise exception 'LS: Choose a recruiter from the list.'; end if;
 update public.roles set recruiter_names=v_names,updated_at=now() where id=p_role;
 return v_names;
end $$;

create function public.save_recruiter(p_name text) returns uuid
 language sql security invoker set search_path='' as $$ select private.save_recruiter(p_name); $$;
create function public.archive_recruiter(p_id uuid) returns void
 language sql security invoker set search_path='' as $$ select private.archive_recruiter(p_id); $$;
create function public.set_role_recruiters(p_role uuid,p_names text[]) returns text[]
 language sql security invoker set search_path='' as $$ select private.set_role_recruiters(p_role,p_names); $$;

do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private')
   and p.proname in ('save_recruiter','archive_recruiter','set_role_recruiters') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

commit;
