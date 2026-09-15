-- An existing master record can enter another role without pretending it was
-- manually entered. Keep the source visible in the role-specific journey.
begin;

alter table public.role_candidates drop constraint role_candidates_source_check;
alter table public.role_candidates add constraint role_candidates_source_check
 check(source in ('linkedin','naukri','manual','url_paste','csv','sourcing_import','master_db','other'));

create or replace function private.add_candidates_to_role(p_client uuid,p_role uuid,p_candidate_ids uuid[],p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_added integer; v_total integer; begin
 perform private.require_admin(auth.uid());
 if p_candidate_ids is null or cardinality(p_candidate_ids) not between 1 and 200 then
  raise exception 'LS: Add between 1 and 200 candidates at a time.'; end if;
 if p_source is null or p_source not in ('linkedin','naukri','manual','url_paste','csv','sourcing_import','master_db','other') then
  raise exception 'LS: Unsupported candidate source.'; end if;
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'LS: Client not found.'; end if;
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this role before adding candidates.'; end if;
 select count(distinct u) into v_total from unnest(p_candidate_ids) u;
 if (select count(*) from public.candidates where id=any(p_candidate_ids))<>v_total then
  raise exception 'LS: Some candidates no longer exist. Reload and try again.'; end if;
 with wanted as (select distinct unnest(p_candidate_ids) as cid),
 ins as (
  insert into public.role_candidates(client_id,role_id,candidate_id,source)
  select p_client,p_role,cid,p_source from wanted
  on conflict(role_id,candidate_id) do nothing
  returning id,candidate_id
 ), history as (
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,to_stage,actor,detail)
  select p_client,id,'import','all_profiles',auth.uid(),
   jsonb_build_object('source',p_source,'candidateId',candidate_id) from ins
  returning id
 ) select count(*) into v_added from history;
 return jsonb_build_object('added',v_added,'alreadyInRole',v_total-v_added);
end $$;

revoke all on function private.add_candidates_to_role(uuid,uuid,uuid[],text) from public,anon,authenticated;
grant execute on function private.add_candidates_to_role(uuid,uuid,uuid[],text) to authenticated;

commit;
