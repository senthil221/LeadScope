-- Recruiters can maintain the single client-visible note from the candidate
-- drawer. The same field is used by the client share, so there is no second
-- source of truth. This also repairs the missing private-function permission
-- on Offer details: the public invoker wrapper must be able to call it.
begin;

alter table public.role_candidate_events
  drop constraint role_candidate_events_kind_check,
  add constraint role_candidate_events_kind_check
  check(kind in (
    'import','stage','rating','ai_rating','reject','client_decision','screening',
    'client_edit','client_note','outcome','offer'
  ));

create function private.save_client_note(p_client uuid,p_id uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.require_admin(auth.uid());
  if length(coalesce(p_note,''))>4000 then
    raise exception 'LS: Shorten the client note before saving.';
  end if;
  perform 1 from public.clients where id=p_client for update;
  update public.role_candidates
    set client_notes=trim(coalesce(p_note,'')),updated_at=now()
    where id=p_id and client_id=p_client;
  if not found then raise exception 'LS: Candidate not found.'; end if;
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,detail)
    values(p_client,p_id,'client_note',auth.uid(),jsonb_build_object(
      'hasNote',length(trim(coalesce(p_note,'')))>0
    ));
end $$;

create function public.save_client_note(p_client uuid,p_id uuid,p_note text)
returns void language sql security invoker set search_path='' as $$
  select private.save_client_note(p_client,p_id,p_note);
$$;

revoke all on function private.save_client_note(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.save_client_note(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.save_client_note(uuid,uuid,text) to authenticated;
grant execute on function public.save_client_note(uuid,uuid,text) to authenticated;

grant execute on function private.save_offer_details(uuid,uuid,numeric,text,date,date,date,text)
  to authenticated;

commit;
