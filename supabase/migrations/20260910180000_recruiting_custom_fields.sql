-- Recruiting custom fields: role-level columns whose values live on
-- role_candidates.custom (already added, unused, in the Phase 1 migration),
-- so a value persists across every stage move by construction. Purely
-- additive.
begin;

create table public.role_fields (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, role_id uuid not null,
 -- key is the jsonb property name inside role_candidates.custom: a safe
 -- identifier, never user-typed directly, derived from the label below.
 key text not null check(key ~ '^[a-z][a-z0-9_]{0,49}$'),
 label text not null check(length(trim(label)) between 1 and 80),
 kind text not null check(kind in ('text','number','date','select','boolean')),
 options jsonb not null default '[]' check(jsonb_typeof(options)='array'),
 ordinal integer not null default 0,
 archived boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(role_id,key), unique(id,client_id),
 foreign key(role_id,client_id) references public.roles(id,client_id)
);
create index role_fields_role on public.role_fields(role_id,archived,ordinal);

alter table public.role_fields enable row level security;
revoke all on public.role_fields from anon, authenticated;
grant select on public.role_fields to authenticated;
grant all on public.role_fields to service_role;
create policy admin_read on public.role_fields for select to authenticated using ((select private.is_admin()));

create function private.add_role_field(p_client uuid,p_role uuid,p_label text,p_kind text,p_options jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_base text; v_key text; n integer:=1; v_id uuid; begin
 perform private.require_admin(auth.uid());
 if length(trim(coalesce(p_label,'')))=0 or length(p_label)>80 then raise exception 'LS: Enter a column name.'; end if;
 if p_kind is null or p_kind not in ('text','number','date','select','boolean') then
  raise exception 'LS: Choose a valid column type.'; end if;
 if p_kind='select' then
  if p_options is null or jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options) not between 1 and 20
   or exists(select 1 from jsonb_array_elements_text(p_options) o where length(trim(o)) not between 1 and 60) then
   raise exception 'LS: Add between 1 and 20 options for a dropdown column.'; end if;
 end if;
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'LS: Client not found.'; end if;
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this role before adding columns.'; end if;
 if (select count(*) from public.role_fields where role_id=p_role and not archived)>=30 then
  raise exception 'LS: This role already has the maximum of 30 custom columns.'; end if;
 -- Derive a stable jsonb key from the label; append a numeric suffix on
 -- collision so two columns can share a display label.
 v_base:=lower(regexp_replace(trim(p_label),'[^a-zA-Z0-9]+','_','g'));
 v_base:=trim(both '_' from v_base);
 if v_base='' or v_base !~ '^[a-z]' then v_base:='field_'||v_base; end if;
 v_base:=left(v_base,40);
 v_key:=v_base;
 while exists(select 1 from public.role_fields where role_id=p_role and key=v_key) loop
  n:=n+1; v_key:=left(v_base,36)||'_'||n;
 end loop;
 insert into public.role_fields(client_id,role_id,key,label,kind,options,ordinal)
  values(p_client,p_role,v_key,trim(p_label),p_kind,coalesce(p_options,'[]'::jsonb),
   coalesce((select max(ordinal)+1 from public.role_fields where role_id=p_role),0))
  returning id into v_id;
 return v_id;
end $$;

-- No client check, matching archive_role: any approved admin may archive any
-- role's column. Archiving hides it from new entry without touching values
-- already stored in role_candidates.custom.
create function private.archive_role_field(p_id uuid,p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 update public.role_fields set archived=p_archived,updated_at=now() where id=p_id;
 if not found then raise exception 'LS: Custom column not found.'; end if;
end $$;

-- One cell, one save, matching the inline rating/contact-status pattern
-- elsewhere in the app. A null value removes the key rather than storing an
-- explicit null, keeping role_candidates.custom sparse.
create function private.save_custom_field(p_client uuid,p_id uuid,p_key text,p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_kind text; begin
 perform private.require_admin(auth.uid());
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'LS: Client not found.'; end if;
 select f.kind into v_kind from public.role_candidates rc
  join public.role_fields f on f.role_id=rc.role_id and f.key=p_key and not f.archived
  where rc.id=p_id and rc.client_id=p_client;
 if v_kind is null then raise exception 'LS: This custom column no longer exists for this role.'; end if;
 if p_value is not null then
  if v_kind='number' and jsonb_typeof(p_value)<>'number' then raise exception 'LS: Enter a number for this column.'; end if;
  if v_kind='boolean' and jsonb_typeof(p_value)<>'boolean' then raise exception 'LS: Choose yes or no for this column.'; end if;
  if v_kind in ('text','date','select') and jsonb_typeof(p_value)<>'string' then
   raise exception 'LS: Enter text for this column.'; end if;
  if v_kind in ('text','date','select') and length(p_value#>>'{}')>2000 then
   raise exception 'LS: Shorten this value before saving.'; end if;
 end if;
 update public.role_candidates set
  custom = case when p_value is null then custom - p_key else jsonb_set(custom,array[p_key],p_value,true) end,
  updated_at=now()
  where id=p_id and client_id=p_client;
 if not found then raise exception 'LS: Candidate not found.'; end if;
end $$;

create function public.add_role_field(p_client uuid,p_role uuid,p_label text,p_kind text,p_options jsonb)
returns uuid language sql security invoker set search_path='' as $$
 select private.add_role_field(p_client,p_role,p_label,p_kind,p_options);
$$;
create function public.archive_role_field(p_id uuid,p_archived boolean)
returns void language sql security invoker set search_path='' as $$
 select private.archive_role_field(p_id,p_archived);
$$;
create function public.save_custom_field(p_client uuid,p_id uuid,p_key text,p_value jsonb)
returns void language sql security invoker set search_path='' as $$
 select private.save_custom_field(p_client,p_id,p_key,p_value);
$$;
do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in
   ('add_role_field','archive_role_field','save_custom_field') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

commit;
