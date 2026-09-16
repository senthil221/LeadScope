-- Offer details belong to a role candidate, not the reusable person record.
-- They keep the final stage operational without exposing compensation or notes
-- to the client-share endpoint.
begin;

alter table public.role_candidates
 add column offer_amount numeric(14,2) check(offer_amount is null or offer_amount>=0),
 add column offer_currency text not null default '' check(offer_currency ~ '^[A-Z]{0,10}$'),
 add column offer_sent_on date,
 add column offer_response_due_at date,
 add column expected_start_at date,
 add column offer_notes text not null default '' check(length(offer_notes)<=4000);

create index role_candidates_offer_due_queue
 on public.role_candidates(role_id,offer_response_due_at,id)
 where stage='offer_sent' and offer_response_due_at is not null;

alter table public.role_candidate_events
 drop constraint role_candidate_events_kind_check,
 add constraint role_candidate_events_kind_check
 check(kind in ('import','stage','rating','ai_rating','reject','client_decision','screening','client_edit','outcome','offer'));

create function private.save_offer_details(
 p_client uuid,p_id uuid,p_amount numeric,p_currency text,p_sent_on date,
 p_response_due_at date,p_expected_start_at date,p_notes text
)
returns void language plpgsql security definer set search_path='' as $$
declare v_currency text:=upper(trim(coalesce(p_currency,''))); begin
 perform private.require_admin(auth.uid());
 if p_amount is not null and (p_amount<0 or p_amount>999999999999.99) then
  raise exception 'LS: Enter a valid offer amount.'; end if;
 if v_currency !~ '^[A-Z]{0,10}$' then
  raise exception 'LS: Use a valid currency code.'; end if;
 if length(coalesce(p_notes,''))>4000 then
  raise exception 'LS: Shorten the offer notes before saving.'; end if;
 perform 1 from public.clients where id=p_client for update;
 update public.role_candidates
  set offer_amount=p_amount,offer_currency=v_currency,offer_sent_on=p_sent_on,
   offer_response_due_at=p_response_due_at,expected_start_at=p_expected_start_at,
   offer_notes=coalesce(p_notes,''),updated_at=now()
  where id=p_id and client_id=p_client and stage='offer_sent';
 if not found then raise exception 'LS: Candidate must be in Offer sent before recording offer details.'; end if;
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,detail)
  values(p_client,p_id,'offer',auth.uid(),jsonb_build_object(
   'amount',p_amount,'currency',v_currency,'sentOn',p_sent_on,
   'responseDueAt',p_response_due_at,'expectedStartAt',p_expected_start_at
  ));
end $$;

create function public.save_offer_details(
 p_client uuid,p_id uuid,p_amount numeric,p_currency text,p_sent_on date,
 p_response_due_at date,p_expected_start_at date,p_notes text
)
returns void language sql security invoker set search_path='' as $$
 select private.save_offer_details(
  p_client,p_id,p_amount,p_currency,p_sent_on,p_response_due_at,p_expected_start_at,p_notes
 );
$$;

revoke all on function private.save_offer_details(uuid,uuid,numeric,text,date,date,date,text) from public,anon,authenticated;
revoke all on function public.save_offer_details(uuid,uuid,numeric,text,date,date,date,text) from public,anon,authenticated;
grant execute on function public.save_offer_details(uuid,uuid,numeric,text,date,date,date,text) to authenticated;

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
  )::integer,
  count(rc.id) filter (where rc.stage='client_shortlisted')::integer,
  count(rc.id) filter (
   where rc.stage='offer_sent' and coalesce(rc.outcome,'offer_sent') not in ('offer_declined','joined')
    and rc.offer_response_due_at is not null and rc.offer_response_due_at<=current_date
  )::integer
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
   and rc.offer_response_due_at is not null and rc.offer_response_due_at<=current_date
 )>0
 order by due_follow_ups desc,client_review desc,offers_in_progress desc,c.name,r.name;
$$;

revoke all on function public.agency_today_work_queue() from public,anon,authenticated;
grant execute on function public.agency_today_work_queue() to authenticated;

commit;
