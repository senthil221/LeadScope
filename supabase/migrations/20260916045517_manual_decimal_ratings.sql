-- Ratings are a recruiter's manual 0.0–5.0 assessment. The legacy
-- "AI shortlisted" tab remains the pipeline name. Historical score data is
-- retained but hidden, while its public write path is disabled.
begin;

revoke all on function public.record_ai_scores(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function private.record_ai_scores(uuid,uuid,jsonb) from public,anon,authenticated;

alter table public.roles
 alter column rating_threshold type numeric(3,1) using rating_threshold::numeric(3,1);
alter table public.role_candidates
 alter column rating type numeric(3,1) using rating::numeric(3,1),
 alter column threshold_at_rating type numeric(3,1) using threshold_at_rating::numeric(3,1);

alter table public.role_candidate_events
 drop constraint role_candidate_events_kind_check,
 add constraint role_candidate_events_kind_check
 check(kind in ('import','stage','rating','ai_rating','reject','client_decision','screening','client_edit','outcome','offer'));

drop function public.save_role(uuid,uuid,text,text,integer,integer);
drop function private.save_role(uuid,uuid,text,text,integer,integer);
create function private.save_role(p_id uuid,p_client uuid,p_name text,p_description text,p_threshold numeric,p_revision integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.roles; begin
 perform private.require_admin(auth.uid());
 if p_threshold is null or p_threshold not between 0 and 5 or p_threshold<>round(p_threshold,1) then
  raise exception 'LS: Choose a rating floor from 0.0 to 5.0.';
 end if;
 if length(trim(coalesce(p_name,'')))=0 or length(p_name)>120 then
  raise exception 'LS: Enter a role name.'; end if;
 perform 1 from public.clients where id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this client before editing roles.'; end if;
 if p_id is null then
  insert into public.roles(client_id,name,description,rating_threshold)
   values(p_client,trim(p_name),coalesce(p_description,''),p_threshold) returning * into r;
 else
  select * into r from public.roles where id=p_id and client_id=p_client for update;
  if not found then raise exception 'LS: Role not found.'; end if;
  if r.revision is distinct from p_revision then raise exception 'LS: Another operator saved changes. Reload before saving.'; end if;
  update public.roles set name=trim(p_name),description=coalesce(p_description,''),
   rating_threshold=p_threshold,revision=revision+1,updated_at=now() where id=r.id returning * into r;
 end if;
 return r.id;
end $$;
create function public.save_role(p_id uuid,p_client uuid,p_name text,p_description text,p_threshold numeric,p_revision integer)
returns uuid language sql security invoker set search_path='' as $$
 select private.save_role(p_id,p_client,p_name,p_description,p_threshold,p_revision);
$$;

drop function public.rate_candidate(uuid,uuid,integer);
create function private.rate_candidate_decimal(p_client uuid,p_id uuid,p_rating numeric)
returns void language plpgsql security definer set search_path='' as $$
declare rc public.role_candidates; v_threshold numeric(3,1); begin
 perform private.require_admin(auth.uid());
 if p_rating is not null and (p_rating not between 0 and 5 or p_rating<>round(p_rating,1)) then
  raise exception 'LS: Choose a rating from 0.0 to 5.0.'; end if;
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
   values(p_client,rc.id,'stage','all_profiles','profile_shortlisted',auth.uid(),'Rating met the floor.');
 else
  update public.role_candidates set rating=p_rating,
   rated_by=case when p_rating is null then null else auth.uid() end,
   rated_at=case when p_rating is null then null else now() end,
   updated_at=now() where id=rc.id;
 end if;
end $$;
create function public.rate_candidate(p_client uuid,p_id uuid,p_rating numeric)
returns void language sql security invoker set search_path='' as $$
 select private.rate_candidate_decimal(p_client,p_id,p_rating);
$$;

create or replace function private.apply_threshold(p_client uuid,p_role uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_threshold numeric(3,1); v_moved integer; begin
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
   'Rating floor applied to existing manual ratings.' from moved returning id
 ) select count(*) into v_moved from history;
 return jsonb_build_object('moved',v_moved);
end $$;

create or replace function private.reject_candidate(p_client uuid,p_ids uuid[],p_type text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 if p_ids is null or cardinality(p_ids) not between 1 and 200 then raise exception 'LS: Select between 1 and 200 candidates.'; end if;
 if p_type is null or p_type not in ('recruiter','client') then raise exception 'LS: Choose whether this is a recruiter or client rejection.'; end if;
 if length(trim(coalesce(p_reason,'')))=0 then raise exception 'LS: Enter a reason to reject this candidate.'; end if;
 if length(p_reason)>4000 then raise exception 'LS: Shorten this rejection reason before saving.'; end if;
 perform 1 from public.clients where id=p_client for update;
 if (select count(*) from public.role_candidates where client_id=p_client and id=any(p_ids))
  <>(select count(distinct u) from unnest(p_ids) u) then raise exception 'LS: Selection is not in this client.'; end if;
 if exists(select 1 from public.role_candidates where client_id=p_client and id=any(p_ids)
  and stage not in ('recruiter_shortlisted','client_shortlisted','offer_sent')) then
  raise exception 'LS: Candidates can be rejected from recruiter review onwards.';
 end if;
 perform 1 from public.role_candidates where client_id=p_client and id=any(p_ids) order by id for update;
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason,detail)
  select p_client,id,'reject',stage,'rejected',auth.uid(),p_reason,jsonb_build_object('rejectionType',p_type)
  from public.role_candidates where client_id=p_client and id=any(p_ids);
 update public.role_candidates set stage='rejected',stage_entered_at=now(),updated_at=now(),
  rejected_at=now(),rejected_by=auth.uid(),rejection_type=p_type,rejection_reason=p_reason
  where client_id=p_client and id=any(p_ids);
end $$;

do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in ('save_role','rate_candidate','rate_candidate_decimal','apply_threshold','reject_candidate') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

commit;
