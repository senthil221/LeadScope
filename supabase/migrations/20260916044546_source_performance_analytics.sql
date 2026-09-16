-- Source performance is based on candidates who ever reached each stage, so a
-- candidate who later moves on (or is rejected) still counts for the channel
-- that delivered them.
begin;

create function public.role_source_performance(p_role uuid)
returns table(
 source text,
 source_detail text,
 total_profiles integer,
 ai_shortlisted integer,
 recruiter_shortlisted integer,
 client_shortlisted integer,
 offer_sent integer
)
language sql stable security invoker set search_path='' as $$
 with progress as (
  select
   rc.id,
   rc.source,
   rc.source_detail,
   rc.stage,
   coalesce(bool_or(e.to_stage='profile_shortlisted'),false) as reached_ai,
   coalesce(bool_or(e.to_stage='recruiter_shortlisted'),false) as reached_recruiter,
   coalesce(bool_or(e.to_stage='client_shortlisted'),false) as reached_client,
   coalesce(bool_or(e.to_stage='offer_sent'),false) as reached_offer
  from public.role_candidates rc
  left join public.role_candidate_events e on e.role_candidate_id=rc.id
  where rc.role_id=p_role
  group by rc.id,rc.source,rc.source_detail,rc.stage
 )
 select
  source,
  source_detail,
  count(*)::integer,
  count(*) filter (
   where reached_ai or stage in ('profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent')
  )::integer,
  count(*) filter (
   where reached_recruiter or stage in ('recruiter_shortlisted','client_shortlisted','offer_sent')
  )::integer,
  count(*) filter (
   where reached_client or stage in ('client_shortlisted','offer_sent')
  )::integer,
  count(*) filter (where reached_offer or stage='offer_sent')::integer
 from progress
 group by source,source_detail
 order by count(*) desc,source,source_detail;
$$;

revoke all on function public.role_source_performance(uuid) from public,anon,authenticated;
grant execute on function public.role_source_performance(uuid) to authenticated;

commit;
