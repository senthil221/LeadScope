-- Recruiting rating and threshold: rate_candidate auto-advances out of
-- All profiles the moment a rating meets the role's threshold; apply_threshold
-- is the only path that re-evaluates candidates already sitting there, and it
-- runs only when explicitly invoked. Purely additive.
begin;

-- Auto-advance fires only here, comparing against the role's threshold at the
-- moment of rating, and only while the candidate is still in All profiles.
-- Re-rating someone further along the pipeline updates the rating without
-- moving them: progression past All profiles is a deliberate stage move.
create function private.rate_candidate(p_client uuid,p_id uuid,p_rating integer)
returns void language plpgsql security definer set search_path = '' as $$
declare rc public.role_candidates; v_threshold smallint; begin
 perform private.require_admin(auth.uid());
 if p_rating is not null and p_rating not between 0 and 5 then
  raise exception 'LS: Choose a rating between 0 and 5.'; end if;
 perform 1 from public.clients where id=p_client for update;
 select * into rc from public.role_candidates where id=p_id and client_id=p_client for update;
 if not found then raise exception 'LS: Candidate not found.'; end if;
 if p_rating is not distinct from rc.rating then return; end if;
 select rating_threshold into v_threshold from public.roles where id=rc.role_id;
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,detail)
  values(p_client,rc.id,'rating',auth.uid(),jsonb_build_object('rating',p_rating,'previousRating',rc.rating));
 if p_rating is not null and rc.stage='all_profiles' and p_rating>=v_threshold then
  update public.role_candidates set rating=p_rating,rated_by=auth.uid(),rated_at=now(),
   stage='profile_shortlisted',stage_entered_at=now(),threshold_at_rating=v_threshold,updated_at=now()
   where id=rc.id;
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason)
   values(p_client,rc.id,'stage','all_profiles','profile_shortlisted',auth.uid(),'Rating met the threshold.');
 else
  update public.role_candidates set rating=p_rating,
   rated_by=case when p_rating is null then null else auth.uid() end,
   rated_at=case when p_rating is null then null else now() end,
   updated_at=now() where id=rc.id;
 end if;
end $$;

-- The only path that moves a candidate for a threshold set before this rating
-- existed. Explicit and separately invoked: saving a new threshold on the
-- role never calls this on its own, so nobody moves silently.
create function private.apply_threshold(p_client uuid,p_role uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_threshold smallint; v_moved integer; begin
 perform private.require_admin(auth.uid());
 perform 1 from public.clients where id=p_client for update;
 select rating_threshold into v_threshold from public.roles where id=p_role and client_id=p_client for update;
 if not found then raise exception 'LS: Role not found.'; end if;
 with moved as (
  update public.role_candidates set stage='profile_shortlisted',stage_entered_at=now(),
   threshold_at_rating=v_threshold,updated_at=now()
  where client_id=p_client and role_id=p_role and stage='all_profiles'
   and rating is not null and rating>=v_threshold
  returning id
 ), history as (
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason)
  select p_client,id,'stage','all_profiles','profile_shortlisted',auth.uid(),
   'Threshold applied to already-rated candidates.' from moved
  returning id
 ) select count(*) into v_moved from history;
 return jsonb_build_object('moved',v_moved);
end $$;

create function public.rate_candidate(p_client uuid,p_id uuid,p_rating integer)
returns void language sql security invoker set search_path='' as $$
 select private.rate_candidate(p_client,p_id,p_rating);
$$;
create function public.apply_threshold(p_client uuid,p_role uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.apply_threshold(p_client,p_role);
$$;
do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in ('rate_candidate','apply_threshold') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

commit;
