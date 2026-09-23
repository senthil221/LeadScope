-- Approving a new operator meant someone editing user_profiles by hand over
-- SSH. This puts it in the app, for the owner only.
--
-- Agency admin is not the right gate: every approved operator has that, so any
-- of them could approve the next one. Ownership is separate and is not granted
-- through this screen, or through any other, so the set of people who can hand
-- out access cannot grow by itself.
begin;

alter table public.user_profiles
  add column if not exists is_owner boolean not null default false;

-- Seeded from the account that has been running the agency. Anyone else has to
-- be made an owner deliberately, in SQL, the way this one was.
update public.user_profiles set is_owner = true
 where id = (select id from auth.users where email = 'senthil@b2bdrive.net');

create or replace function private.is_owner(p_actor uuid) returns boolean
language sql security definer stable set search_path = '' as $$
 select coalesce((select is_owner from public.user_profiles where id = p_actor), false)
$$;

create or replace function private.require_owner(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if p_actor is null or not private.is_owner(p_actor) then
  raise exception 'LS: Only the workspace owner can manage access.' using errcode = '42501';
 end if;
end $$;

-- Reads auth.users, which the app's role cannot select from directly. Security
-- definer is what makes the listing possible at all, so the owner check is the
-- whole of the protection here.
create or replace function private.list_operators()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 perform private.require_owner(auth.uid());
 select coalesce(jsonb_agg(row order by row->>'email'), '[]'::jsonb) into result
 from (
  select jsonb_build_object(
   'id', u.id,
   'email', u.email,
   'approved', coalesce(p.is_agency_admin, false),
   'owner', coalesce(p.is_owner, false),
   'confirmed', u.email_confirmed_at is not null,
   'createdAt', u.created_at,
   'lastSignInAt', u.last_sign_in_at
  ) as row
  from auth.users u
  left join public.user_profiles p on p.id = u.id
 ) rows;
 return result;
end $$;

create or replace function private.set_operator_access(p_id uuid, p_approved boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner boolean;
begin
 perform private.require_owner(auth.uid());
 if p_id is null or p_approved is null then
  raise exception 'LS: Choose an operator and whether they have access.'; end if;
 -- Locking yourself out of the screen that grants access would need SSH to
 -- undo, so the one account that cannot be changed here is your own.
 if p_id = auth.uid() then
  raise exception 'LS: You cannot change your own access.'; end if;
 select coalesce(is_owner, false) into v_owner from public.user_profiles where id = p_id;
 if not found then raise exception 'LS: That operator no longer exists.'; end if;
 if v_owner then
  raise exception 'LS: An owner''s access cannot be changed here.'; end if;
 update public.user_profiles set is_agency_admin = p_approved where id = p_id;
end $$;

create or replace function public.list_operators()
returns jsonb language sql security invoker set search_path = '' as $$
 select private.list_operators();
$$;

create or replace function public.set_operator_access(p_id uuid, p_approved boolean)
returns void language sql security invoker set search_path = '' as $$
 select private.set_operator_access(p_id, p_approved);
$$;

do $$ declare f record; begin
 for f in select n.nspname as schema, p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private')
    and p.proname in ('list_operators','set_operator_access','is_owner','require_owner') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated', f.schema, f.proname, f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated', f.schema, f.proname, f.args);
 end loop;
end $$;

commit;
