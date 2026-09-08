-- Optional audience criteria and query-free drafts; preserves authorization, revisions and history.
-- Forward-compatible: the original application can still use this function. No existing rows change.
begin;
create or replace function private.save_campaign(p_id uuid,p_client uuid,p_name text,p_config jsonb,p_queries jsonb,p_reset boolean,p_revision integer) returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.campaigns; v_id uuid; q jsonb; n integer:=0; changed boolean; begin
 perform private.require_admin(auth.uid());
 perform 1 from public.clients where id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this client before editing campaigns.'; end if;
 if jsonb_array_length(p_config->'locations') not between 0 and 20 or jsonb_array_length(p_config->'roles') not between 0 and 30
 or (p_config->>'pageCap')::integer not between 1 and 5 or (p_config->>'budget')::integer not between 1 and 50
 or jsonb_array_length(p_queries) not between 0 and 40 then raise exception 'LS: Invalid campaign limits.'; end if;
 if p_id is null then
  insert into public.campaigns(client_id,name,config) values(p_client,p_name,p_config) returning * into c;
 else
  select * into c from public.campaigns where id=p_id and client_id=p_client for update;
  if not found then raise exception 'LS: Campaign not found.'; end if;
  if c.revision is distinct from p_revision then raise exception 'LS: Another operator saved changes. Reload before saving.'; end if;
  changed := (c.config - array['country','language','queryCap','pageCap','budget','target','cooldownDays','includeRequired','queryExclusions']) is distinct from
             (p_config - array['country','language','queryCap','pageCap','budget','target','cooldownDays','includeRequired','queryExclusions']);
  if changed and exists(select 1 from public.campaign_profiles where campaign_id=c.id) and not p_reset then raise exception 'LS: Criteria changed. Confirm reset to Review before saving.'; end if;
  if changed and exists(select 1 from public.campaign_runs where campaign_id=c.id and status in ('running','paused')) then raise exception 'LS: Cancel unfinished runs before changing criteria.'; end if;
  update public.campaigns set name=p_name,config=p_config,revision=revision+1,criteria_version=criteria_version+case when changed then 1 else 0 end,updated_at=now() where id=c.id returning * into c;
  if changed then
   insert into public.review_events(client_id,campaign_profile_id,actor,decision,was_rule_match,note)
    select client_id,id,auth.uid(),'criteria_reset',automatic_status='rule_match','Criteria changed; returned to Review.' from public.campaign_profiles where campaign_id=c.id;
   update public.campaign_profiles set manual_decision='review',decided_by=auth.uid(),decided_at=now(),decision_note='Criteria changed; review new evidence.',updated_at=now() where campaign_id=c.id;
  end if;
 end if;
 v_id:=c.id;
 for q in select * from jsonb_array_elements(p_queries) loop
  insert into public.campaign_queries(client_id,campaign_id,revision,text,strategy,signature,enabled,ordinal)
   values(p_client,v_id,c.revision,q->>'text',q->>'strategy',q->>'signature',(q->>'enabled')::boolean,n); n:=n+1;
 end loop;
 return v_id;
end $$;

commit;
