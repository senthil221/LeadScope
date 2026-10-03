begin;

-- Read only the latest lookup for the profiles currently loaded in the sheet.
create index mobile_waterfall_role_candidate_latest
  on public.mobile_waterfall_jobs(role_id,candidate_id,created_at desc,id desc);

create or replace function private.mobile_waterfall_summary(p_role uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_admin(auth.uid());
  return jsonb_build_object(
    'active',(select count(*) from public.mobile_waterfall_jobs where role_id=p_role and status in ('queued','running','waiting','waiting_setup')),
    'review',(select count(*) from public.mobile_waterfall_jobs where role_id=p_role and status='needs_review'),
    -- An empty completed lookup must refresh the table too.
    'resultVersion',greatest(
      (select max(updated_at) from public.mobile_waterfall_jobs where role_id=p_role and status in ('complete','no_mobile','failed','cancelled')),
      (select max(n.found_at) from public.candidate_mobile_numbers n join public.role_candidates rc on rc.candidate_id=n.candidate_id where rc.role_id=p_role)
    )
  );
end $$;

create function private.mobile_waterfall_table_status(p_role uuid,p_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_admin(auth.uid());
  if coalesce(cardinality(p_ids),0) not between 1 and 200 then
    raise exception 'LS: Select between 1 and 200 profiles.';
  end if;
  return private.mobile_waterfall_summary(p_role) || jsonb_build_object('cells',coalesce((
    select jsonb_agg(to_jsonb(cell)) from (
      select rc.candidate_id,j.status,j.identifier,j.updated_at checked_at,jsonb_array_length(j.results) phone_count
      from public.role_candidates rc
      cross join lateral (
        select lookup.status,lookup.identifier,lookup.updated_at,lookup.results
        from public.mobile_waterfall_jobs lookup
        where lookup.role_id=rc.role_id and lookup.candidate_id=rc.candidate_id
        order by lookup.created_at desc,lookup.id desc limit 1
      ) j
      where rc.role_id=p_role and rc.candidate_id=any(p_ids)
        and exists(select 1 from public.candidate_identities i where i.candidate_id=rc.candidate_id and i.kind='linkedin' and i.normalized_value=j.identifier)
    ) cell
  ),'[]'::jsonb));
end $$;

create function public.mobile_waterfall_table_status(p_role uuid,p_ids uuid[])
returns jsonb language sql security invoker set search_path='' as $$
  select private.mobile_waterfall_table_status(p_role,p_ids);
$$;
revoke all on function private.mobile_waterfall_table_status(uuid,uuid[]),public.mobile_waterfall_table_status(uuid,uuid[]) from public,anon,authenticated;
grant execute on function private.mobile_waterfall_table_status(uuid,uuid[]),public.mobile_waterfall_table_status(uuid,uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
