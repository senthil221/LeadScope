-- Read-only analytics over role_candidate_events: per-stage funnel counts
-- and median time-in-stage. Purely additive, no new tables. Both views
-- follow the same security_invoker + grant-only pattern as the sourcing
-- side's own lead_rows: no RLS policy lives on a view itself, so running as
-- the invoker and relying on the RLS already enforced by role_candidates and
-- role_candidate_events is what keeps one client's numbers out of another's.
begin;

-- One row per (role, stage). ever_reached is a lifetime count -- how many of
-- this role's candidates have ever had an event landing them in that stage,
-- which for all_profiles includes the initial 'import' event since
-- add_candidates_to_role already writes to_stage='all_profiles' there.
-- currently_here is just today's snapshot. Comparing ever_reached between
-- adjacent pipeline stages is the conversion/drop-off rate; the view leaves
-- that division to the caller rather than baking in one fixed stage order.
create view public.role_stage_funnel with (security_invoker=true) as
with reached as (
 select distinct rc.role_id, rc.client_id, e.to_stage as stage, e.role_candidate_id
 from public.role_candidate_events e
 join public.role_candidates rc on rc.id=e.role_candidate_id
 where e.to_stage is not null
), reached_counts as (
 select role_id, client_id, stage, count(*)::int as ever_reached
 from reached group by role_id, client_id, stage
), current_counts as (
 select role_id, client_id, stage, count(*)::int as currently_here
 from public.role_candidates group by role_id, client_id, stage
), stage_list(stage) as (
 values ('all_profiles'),('profile_shortlisted'),('recruiter_shortlisted'),
  ('client_shortlisted'),('offer_sent'),('rejected')
)
select r.id as role_id, r.client_id, sl.stage,
 coalesce(rc2.ever_reached,0) as ever_reached,
 coalesce(cc.currently_here,0) as currently_here
from public.roles r
cross join stage_list sl
left join reached_counts rc2 on rc2.role_id=r.id and rc2.stage=sl.stage
left join current_counts cc on cc.role_id=r.id and cc.stage=sl.stage;
grant select on public.role_stage_funnel to authenticated;

-- Time-in-stage, from one to_stage event to the next event on the same
-- role_candidate. Only completed stays count: a candidate still sitting in a
-- stage today has no "left_at" yet, and including that open-ended, ever-
-- shrinking duration would bias the median down as time passes rather than
-- reflecting how long a completed stay actually took.
create view public.role_stage_durations with (security_invoker=true) as
with transitions as (
 select e.role_candidate_id, e.to_stage as stage, e.created_at as entered_at,
  lead(e.created_at) over (partition by e.role_candidate_id order by e.created_at) as left_at
 from public.role_candidate_events e
 where e.to_stage is not null
)
select rc.role_id, rc.client_id, t.stage,
 count(*)::int as completed_count,
 percentile_cont(0.5) within group (
  order by extract(epoch from (t.left_at-t.entered_at))/86400.0
 ) as median_days
from transitions t
join public.role_candidates rc on rc.id=t.role_candidate_id
where t.left_at is not null
group by rc.role_id, rc.client_id, t.stage;
grant select on public.role_stage_durations to authenticated;

commit;
