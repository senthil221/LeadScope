-- The role pipeline needs counts on every stage switch. Keep that work scoped
-- to the current role rather than aggregating every role belonging to its
-- client. SECURITY INVOKER preserves the existing RLS boundary.
create function public.role_workspace_counts(p_role uuid)
returns table(
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
  from public.role_candidates rc
  where rc.role_id=p_role;
$$;

revoke all on function public.role_workspace_counts(uuid) from public,anon;
grant execute on function public.role_workspace_counts(uuid) to authenticated;
