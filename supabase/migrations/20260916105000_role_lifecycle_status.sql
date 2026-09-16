-- Roles already carry a lifecycle state. Make it part of the supported save
-- path so recruiters can keep the role list aligned with real hiring work.
drop function public.save_role(uuid,uuid,text,text,numeric,integer);
drop function private.save_role(uuid,uuid,text,text,numeric,integer);

create function private.save_role(
  p_id uuid,
  p_client uuid,
  p_name text,
  p_description text,
  p_threshold numeric,
  p_status text,
  p_revision integer
)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.roles;
begin
  perform private.require_admin(auth.uid());
  if p_threshold is null or p_threshold not between 0 and 5 or p_threshold<>round(p_threshold,1) then
    raise exception 'LS: Choose a rating floor from 0.0 to 5.0.';
  end if;
  if p_status is null or p_status not in ('open','on_hold','closed') then
    raise exception 'LS: Choose a valid role status.';
  end if;
  if length(trim(coalesce(p_name,'')))=0 or length(p_name)>120 then
    raise exception 'LS: Enter a role name.';
  end if;
  perform 1 from public.clients where id=p_client and not archived for update;
  if not found then
    raise exception 'LS: Restore this client before editing roles.';
  end if;
  if p_id is null then
    insert into public.roles(client_id,name,description,rating_threshold,status)
      values(p_client,trim(p_name),coalesce(p_description,''),p_threshold,p_status)
      returning * into r;
  else
    select * into r from public.roles where id=p_id and client_id=p_client for update;
    if not found then
      raise exception 'LS: Role not found.';
    end if;
    if r.revision is distinct from p_revision then
      raise exception 'LS: Another operator saved changes. Reload before saving.';
    end if;
    update public.roles
      set name=trim(p_name),
          description=coalesce(p_description,''),
          rating_threshold=p_threshold,
          status=p_status,
          revision=revision+1,
          updated_at=now()
      where id=r.id
      returning * into r;
  end if;
  return r.id;
end;
$$;

create function public.save_role(
  p_id uuid,
  p_client uuid,
  p_name text,
  p_description text,
  p_threshold numeric,
  p_status text,
  p_revision integer
)
returns uuid language sql security invoker set search_path='' as $$
  select private.save_role(p_id,p_client,p_name,p_description,p_threshold,p_status,p_revision);
$$;

revoke all on function private.save_role(uuid,uuid,text,text,numeric,text,integer) from public,anon,authenticated;
revoke all on function public.save_role(uuid,uuid,text,text,numeric,text,integer) from public,anon,authenticated;
grant execute on function private.save_role(uuid,uuid,text,text,numeric,text,integer) to authenticated;
grant execute on function public.save_role(uuid,uuid,text,text,numeric,text,integer) to authenticated;
