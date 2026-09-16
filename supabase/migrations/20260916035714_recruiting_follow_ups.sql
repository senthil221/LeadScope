-- Follow-up dates are saved inside screening for the panel, and mirrored in a
-- typed column for the daily queue. Keeping the indexable value separate
-- avoids scanning every candidate's JSON document each time a recruiter opens
-- Follow-ups.
begin;

alter table public.role_candidates add column follow_up_at date;

do $$
declare r record; v_follow_up_at date;
begin
 for r in
  select id, nullif(screening->>'followUpAt','') as follow_up_at
  from public.role_candidates
  where nullif(screening->>'followUpAt','') is not null
 loop
  begin
   v_follow_up_at := r.follow_up_at::date;
  exception when others then
   -- Existing screening is historical free-form JSON. A malformed legacy
   -- value should not prevent the queue from being introduced.
   v_follow_up_at := null;
  end;
  update public.role_candidates set follow_up_at=v_follow_up_at where id=r.id;
 end loop;
end $$;

create index role_candidates_follow_up_queue
 on public.role_candidates(role_id,follow_up_at,id)
 where follow_up_at is not null and stage<>'rejected';

create or replace function private.save_screening(p_client uuid,p_id uuid,p_screening jsonb,p_internal_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_follow_up_text text; v_follow_up_at date;
begin
 perform private.require_admin(auth.uid());
 if p_screening is null or jsonb_typeof(p_screening)<>'object' then
  raise exception 'LS: Invalid screening data.'; end if;
 if length(p_screening::text)>8000 then raise exception 'LS: Screening notes are too long.'; end if;
 if length(coalesce(p_internal_notes,''))>4000 then raise exception 'LS: Shorten the internal note before saving.'; end if;
 v_follow_up_text:=nullif(p_screening->>'followUpAt','');
 if v_follow_up_text is not null then
  if v_follow_up_text !~ '^\d{4}-\d{2}-\d{2}$' then
   raise exception 'LS: Choose a valid follow-up date.'; end if;
  begin
   v_follow_up_at:=v_follow_up_text::date;
  exception when others then
   raise exception 'LS: Choose a valid follow-up date.';
  end;
 end if;
 perform 1 from public.clients where id=p_client for update;
 update public.role_candidates
  set screening=p_screening,internal_notes=coalesce(p_internal_notes,''),follow_up_at=v_follow_up_at,updated_at=now()
  where id=p_id and client_id=p_client;
 if not found then raise exception 'LS: Candidate not found.'; end if;
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,detail)
  values(p_client,p_id,'screening',auth.uid(),p_screening);
end $$;

revoke all on function private.save_screening(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.save_screening(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_screening(uuid,uuid,jsonb,text) to authenticated;

commit;
