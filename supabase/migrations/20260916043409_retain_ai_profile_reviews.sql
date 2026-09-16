-- Keep the AI's role-specific review beside the recruiter rating so the
-- recruiter can verify the basis for every profile moved to this stage.
begin;

alter table public.role_candidates
 add column ai_rating smallint check(ai_rating between 0 and 5),
 add column ai_rationale text not null default '' check(length(ai_rationale)<=240),
 add column ai_scored_at timestamptz;

alter table public.role_candidate_events
 drop constraint role_candidate_events_kind_check,
 add constraint role_candidate_events_kind_check
 check(kind in ('import','stage','rating','ai_rating','reject','client_decision','screening'));

create function private.record_ai_scores(p_client uuid,p_role uuid,p_scores jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_threshold smallint;
 v_score record;
 v_candidate public.role_candidates;
 v_scored integer:=0;
 v_shortlisted integer:=0;
begin
 perform private.require_admin(auth.uid());
 if p_scores is null or jsonb_typeof(p_scores)<>'array'
  or jsonb_array_length(p_scores) not between 1 and 20 then
  raise exception 'LS: Score between 1 and 20 candidates at a time.';
 end if;
 if exists(
  select 1 from jsonb_to_recordset(p_scores) as s(id uuid,rating integer,rationale text)
  where s.id is null or s.rating not between 0 and 5
   or length(trim(coalesce(s.rationale,''))) not between 1 and 240
 ) then
  raise exception 'LS: AI scores must include a 0–5 rating and a short rationale.';
 end if;
 if (select count(*) from jsonb_to_recordset(p_scores) as s(id uuid,rating integer,rationale text))
  <> (select count(distinct id) from jsonb_to_recordset(p_scores) as s(id uuid,rating integer,rationale text)) then
  raise exception 'LS: A candidate can only be scored once per request.';
 end if;
 perform 1 from public.clients where id=p_client for update;
 select rating_threshold into v_threshold
 from public.roles where id=p_role and client_id=p_client for update;
 if not found then raise exception 'LS: Role not found.'; end if;

 for v_score in
  select id,rating,trim(rationale) as rationale
  from jsonb_to_recordset(p_scores) as s(id uuid,rating integer,rationale text)
 loop
  select * into v_candidate from public.role_candidates
   where id=v_score.id and client_id=p_client and role_id=p_role and stage='all_profiles'
   for update;
  if not found then
   raise exception 'LS: Candidate is no longer in New profiles. Reload and try again.';
  end if;
  update public.role_candidates
   set ai_rating=v_score.rating,ai_rationale=v_score.rationale,ai_scored_at=now(),updated_at=now()
   where id=v_candidate.id;
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,detail)
   values(p_client,v_candidate.id,'ai_rating',auth.uid(),
    jsonb_build_object('rating',v_score.rating,'rationale',v_score.rationale));
  perform private.rate_candidate(p_client,v_candidate.id,v_score.rating);
  v_scored:=v_scored+1;
  if v_score.rating>=v_threshold then v_shortlisted:=v_shortlisted+1; end if;
 end loop;
 return jsonb_build_object('scored',v_scored,'autoShortlisted',v_shortlisted);
end $$;

create function public.record_ai_scores(p_client uuid,p_role uuid,p_scores jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.record_ai_scores(p_client,p_role,p_scores);
$$;

revoke all on function private.record_ai_scores(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.record_ai_scores(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_ai_scores(uuid,uuid,jsonb) to authenticated;

commit;
