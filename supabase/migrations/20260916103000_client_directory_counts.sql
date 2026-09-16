-- The directory needs one compact row per client. Keep all aggregation in
-- Postgres so opening the agency overview never requires fetching candidates
-- for each client individually.
create function public.client_directory_counts()
returns table(
  client_id uuid,
  active_roles integer,
  all_profiles integer,
  profile_shortlisted integer,
  recruiter_shortlisted integer,
  client_shortlisted integer,
  offer_sent integer,
  due_follow_ups integer,
  offers_in_progress integer
)
language sql stable security invoker set search_path='' as $$
  select
    c.id,
    count(distinct r.id)::integer,
    count(rc.id) filter (where rc.stage='all_profiles')::integer,
    count(rc.id) filter (where rc.stage='profile_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='recruiter_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='client_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='offer_sent')::integer,
    count(rc.id) filter (
      where rc.stage<>'rejected' and rc.follow_up_at is not null and rc.follow_up_at<=current_date
    )::integer,
    count(rc.id) filter (
      where rc.stage='offer_sent' and coalesce(rc.outcome,'offer_sent') not in ('offer_declined','joined')
    )::integer
  from public.clients c
  left join public.roles r on r.client_id=c.id and not r.archived
  left join public.role_candidates rc on rc.role_id=r.id
  group by c.id;
$$;

revoke all on function public.client_directory_counts() from public,anon,authenticated;
grant execute on function public.client_directory_counts() to authenticated;
