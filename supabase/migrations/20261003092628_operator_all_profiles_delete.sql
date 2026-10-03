-- Approved agency operators may remove memberships from the All Profiles
-- view. Other stage views and trash recovery remain owner-only.
-- Master profiles, other role memberships and the recovery snapshot are kept.
-- Rollback: restore private.remove_role_candidates from migration
-- 20261001154400_role_directory_brief_later_and_blocklists (or the release's
-- saved pg_get_functiondef backup), then notify pgrst to reload the schema.
begin;

create or replace function private.remove_role_candidates(p_client uuid,p_role uuid,p_ids uuid[],p_stage text)
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid;
begin
 if p_stage = 'all_profiles' then
  perform private.require_admin(auth.uid());
 else
  perform private.require_owner(auth.uid());
 end if;
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Active role not found.'; end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 2000
    or (select count(distinct id) from unnest(p_ids) id)<>cardinality(p_ids) then
  raise exception 'LS: Select between 1 and 2000 unique rows.';
 end if;
 perform 1 from public.role_candidates where role_id=p_role and client_id=p_client and id=any(p_ids) order by id for update;
 if (select count(*) from public.role_candidates where role_id=p_role and client_id=p_client and id=any(p_ids)
     and (p_stage is null or p_stage='all_profiles' or stage=p_stage))<>cardinality(p_ids) then
  raise exception 'LS: Some selected rows changed or no longer belong to this stage. Refresh and select them again.';
 end if;
 insert into private.role_candidate_trash(client_id,role_id,deleted_by,records,events)
 values(p_client,p_role,auth.uid(),
  (select jsonb_agg(to_jsonb(rc)) from public.role_candidates rc where id=any(p_ids)),
  coalesce((select jsonb_agg(to_jsonb(e)) from public.role_candidate_events e where role_candidate_id=any(p_ids)),'[]'))
 returning id into batch;
 delete from public.role_candidate_events where role_candidate_id=any(p_ids);
 delete from public.role_candidates where id=any(p_ids) and role_id=p_role and client_id=p_client;
 return batch;
end $$;

revoke all on function private.remove_role_candidates(uuid,uuid,uuid[],text),public.remove_role_candidates(uuid,uuid,uuid[],text) from public,anon;
grant execute on function private.remove_role_candidates(uuid,uuid,uuid[],text),public.remove_role_candidates(uuid,uuid,uuid[],text) to authenticated;
notify pgrst,'reload schema';
commit;
