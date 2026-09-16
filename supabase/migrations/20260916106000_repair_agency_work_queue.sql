-- The original work-queue migrations named their returned columns but did not
-- alias the aggregate expressions used by ORDER BY. Replace the function so
-- already-installed databases receive the portable definition too.
create or replace function public.agency_today_work_queue()
returns table(
  client_id uuid,
  client_name text,
  role_id uuid,
  role_name text,
  due_follow_ups integer,
  client_review integer,
  offers_in_progress integer
)
language sql stable security invoker set search_path='' as $$
  select
    c.id,
    c.name,
    r.id,
    r.name,
    count(rc.id) filter (
      where rc.stage<>'rejected' and rc.follow_up_at is not null and rc.follow_up_at<=current_date
    )::integer as due_follow_ups,
    count(rc.id) filter (where rc.stage='client_shortlisted')::integer as client_review,
    count(rc.id) filter (
      where rc.stage='offer_sent' and coalesce(rc.outcome,'offer_sent') not in ('offer_declined','joined')
    )::integer as offers_in_progress
  from public.clients c
  join public.roles r on r.client_id=c.id
  left join public.role_candidates rc on rc.role_id=r.id
  where not c.archived and not r.archived
  group by c.id,c.name,r.id,r.name
  having count(rc.id) filter (
    where rc.stage<>'rejected' and rc.follow_up_at is not null and rc.follow_up_at<=current_date
  )>0
    or count(rc.id) filter (where rc.stage='client_shortlisted')>0
    or count(rc.id) filter (
      where rc.stage='offer_sent' and coalesce(rc.outcome,'offer_sent') not in ('offer_declined','joined')
    )>0
  order by due_follow_ups desc,client_review desc,offers_in_progress desc,c.name,r.name;
$$;

revoke all on function public.agency_today_work_queue() from public,anon,authenticated;
grant execute on function public.agency_today_work_queue() to authenticated;
