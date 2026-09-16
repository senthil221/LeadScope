-- One role-level snapshot powers the compact client dashboard without loading
-- every candidate membership into the application process.
create function public.role_dashboard_counts(p_client uuid)
returns table(
  role_id uuid,
  all_profiles integer,
  profile_shortlisted integer,
  recruiter_shortlisted integer,
  client_shortlisted integer,
  offer_sent integer,
  rejected integer,
  due_follow_ups integer,
  offers_in_progress integer
)
language sql stable security invoker set search_path='' as $$
  select
    r.id,
    count(rc.id) filter (where rc.stage='all_profiles')::integer,
    count(rc.id) filter (where rc.stage='profile_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='recruiter_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='client_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='offer_sent')::integer,
    count(rc.id) filter (where rc.stage='rejected')::integer,
    count(rc.id) filter (
      where rc.stage<>'rejected' and rc.follow_up_at is not null and rc.follow_up_at<=current_date
    )::integer,
    count(rc.id) filter (
      where rc.stage='offer_sent' and coalesce(rc.outcome,'offer_sent') not in ('offer_declined','joined')
    )::integer
  from public.roles r
  left join public.role_candidates rc on rc.role_id=r.id
  where r.client_id=p_client
  group by r.id;
$$;

revoke all on function public.role_dashboard_counts(uuid) from public,anon,authenticated;
grant execute on function public.role_dashboard_counts(uuid) to authenticated;
