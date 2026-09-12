-- Final placement flow: offer_sent -> offer_accepted|offer_declined -> joined.
-- No billing, no new tables -- role_candidates.outcome/outcome_at have carried
-- this since Phase 1 foundation, unused until now. Purely additive.
begin;

-- Phase 1's kind CHECK predates this event kind; widen it rather than edit
-- the applied migration that created it, matching the Phase 9 precedent for
-- 'client_edit'.
alter table public.role_candidate_events drop constraint role_candidate_events_kind_check;
alter table public.role_candidate_events add constraint role_candidate_events_kind_check
 check(kind in ('import','stage','rating','reject','client_decision','screening','client_edit','outcome'));

-- A candidate only ever has an outcome once they have reached the terminal
-- offer_sent pipeline stage, and outcomes only ever move forward one step at
-- a time: null -> offer_sent -> (offer_accepted | offer_declined) -> joined.
-- declined is terminal here, same as rejected is terminal for stage.
create function private.record_outcome(p_client uuid,p_ids uuid[],p_outcome text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_from text; begin
 perform private.require_admin(auth.uid());
 if p_ids is null or cardinality(p_ids) not between 1 and 200 then
  raise exception 'LS: Select between 1 and 200 candidates.'; end if;
 if p_outcome is null or p_outcome not in ('offer_sent','offer_accepted','offer_declined','joined') then
  raise exception 'LS: Choose a valid outcome.'; end if;
 v_from := case p_outcome
  when 'offer_sent' then null
  when 'offer_accepted' then 'offer_sent'
  when 'offer_declined' then 'offer_sent'
  when 'joined' then 'offer_accepted'
 end;
 perform 1 from public.clients where id=p_client for update;
 if (select count(*) from public.role_candidates where client_id=p_client and id=any(p_ids))
  <>(select count(distinct u) from unnest(p_ids) u) then
  raise exception 'LS: Selection is not in this client.'; end if;
 perform 1 from public.role_candidates where client_id=p_client and id=any(p_ids) order by id for update;
 if exists(
  select 1 from public.role_candidates
  where client_id=p_client and id=any(p_ids)
   and (stage<>'offer_sent' or outcome is distinct from v_from)
 ) then raise exception 'LS: One or more selected candidates cannot move to that outcome right now.'; end if;
 update public.role_candidates set outcome=p_outcome,outcome_at=now(),updated_at=now()
  where client_id=p_client and id=any(p_ids);
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,detail)
 select p_client,id,'outcome',auth.uid(),jsonb_build_object('outcome',p_outcome)
  from public.role_candidates where client_id=p_client and id=any(p_ids);
end $$;

create function public.record_outcome(p_client uuid,p_ids uuid[],p_outcome text)
returns void language sql security invoker set search_path='' as $$
 select private.record_outcome(p_client,p_ids,p_outcome);
$$;

do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname='record_outcome' loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

commit;
