begin;

-- Manual ratings are the only active assessment method. Preserve any legacy
-- assessment values for audit purposes, without carrying AI terminology or a
-- callable scoring path into the live schema.
alter table public.role_candidates
 rename column ai_rating to legacy_assessment_rating;
alter table public.role_candidates
 rename column ai_rationale to legacy_assessment_note;
alter table public.role_candidates
 rename column ai_scored_at to legacy_assessed_at;

update public.role_candidate_events
set kind = 'legacy_assessment'
where kind = 'ai_rating';

alter table public.role_candidate_events
 drop constraint role_candidate_events_kind_check,
 add constraint role_candidate_events_kind_check
 check(kind in (
   'import','stage','rating','legacy_assessment','reject','client_decision',
   'screening','client_edit','outcome','offer'
 ));

drop function if exists public.record_ai_scores(uuid,uuid,jsonb);
drop function if exists private.record_ai_scores(uuid,uuid,jsonb);

drop function public.role_source_performance(uuid);
create function public.role_source_performance(p_role uuid)
returns table(
 source text,
 source_detail text,
 total_profiles integer,
 profile_shortlisted integer,
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
   coalesce(bool_or(e.to_stage='profile_shortlisted'),false) as reached_profile,
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
   where reached_profile or stage in ('profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent')
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
