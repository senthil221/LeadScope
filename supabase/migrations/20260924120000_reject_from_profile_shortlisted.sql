-- Rejecting from Profile shortlisted.
--
-- The grid has offered a Reject action on Profile shortlisted for a while, but
-- the function behind it only accepted recruiter review onwards, so the button
-- always failed. A profile that is shortlisted on its rating and then turns out
-- to be wrong is rejected there, not walked forward a stage first to make the
-- rule happy. All profiles is still excluded: nothing has been judged yet.
begin;

create or replace function private.reject_candidate(p_client uuid,p_ids uuid[],p_type text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 if p_ids is null or cardinality(p_ids) not between 1 and 200 then raise exception 'LS: Select between 1 and 200 candidates.'; end if;
 if p_type is null or p_type not in ('recruiter','client') then raise exception 'LS: Choose whether this is a recruiter or client rejection.'; end if;
 if length(trim(coalesce(p_reason,'')))=0 then raise exception 'LS: Enter a reason to reject this candidate.'; end if;
 if length(p_reason)>4000 then raise exception 'LS: Shorten this rejection reason before saving.'; end if;
 perform 1 from public.clients where id=p_client for update;
 if (select count(*) from public.role_candidates where client_id=p_client and id=any(p_ids))
  <>(select count(distinct u) from unnest(p_ids) u) then raise exception 'LS: Selection is not in this client.'; end if;
 if exists(select 1 from public.role_candidates where client_id=p_client and id=any(p_ids)
  and stage not in ('profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent')) then
  raise exception 'LS: Candidates can be rejected from Profile shortlisted onwards.';
 end if;
 perform 1 from public.role_candidates where client_id=p_client and id=any(p_ids) order by id for update;
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason,detail)
  select p_client,id,'reject',stage,'rejected',auth.uid(),p_reason,jsonb_build_object('rejectionType',p_type)
  from public.role_candidates where client_id=p_client and id=any(p_ids);
 update public.role_candidates set stage='rejected',stage_entered_at=now(),updated_at=now(),
  rejected_at=now(),rejected_by=auth.uid(),rejection_type=p_type,rejection_reason=p_reason
  where client_id=p_client and id=any(p_ids);
end $$;

revoke all on function private.reject_candidate(uuid,uuid[],text,text) from public,anon,authenticated;
grant execute on function private.reject_candidate(uuid,uuid[],text,text) to authenticated;

commit;
