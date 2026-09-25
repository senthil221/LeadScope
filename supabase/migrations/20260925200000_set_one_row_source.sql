-- One row's source, changed where it is read.
--
-- Correcting a whole import is a bulk edit; correcting the one row somebody
-- is looking at should not be. This is the single-cell version of the same
-- rule, including the part that matters: a row told it came from Naukri is a
-- row that is not waiting for a rating, so it leaves All profiles.
begin;

create function private.set_candidate_source(p_client uuid,p_id uuid,p_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_stage text; v_moved boolean:=false;
begin
 perform private.require_admin(auth.uid());
 if p_source is null or p_source not in ('linkedin','naukri','google','csv','master_db','other') then
  raise exception 'LS: Choose one of the listed sources.'; end if;
 select stage into v_stage from public.role_candidates
  where id=p_id and client_id=p_client for update;
 if not found then raise exception 'LS: Candidate not found on this role.'; end if;
 update public.role_candidates set source=p_source,updated_at=now() where id=p_id;
 -- Naukri profiles are not rated here, so saying a row came from Naukri takes
 -- it out of the rating queue. Rows already further along stay where they are:
 -- a source correction is not a reason to pull somebody backwards.
 if p_source='naukri' and v_stage='all_profiles' then
  update public.role_candidates set stage='profile_shortlisted',stage_entered_at=now(),
   updated_at=now() where id=p_id;
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason)
   values(p_client,p_id,'stage','all_profiles','profile_shortlisted',auth.uid(),
    'Source set to Naukri, which is not rated here.');
  v_stage:='profile_shortlisted'; v_moved:=true;
 end if;
 return jsonb_build_object('stage',v_stage,'moved',v_moved);
end $$;

create function public.set_candidate_source(p_client uuid,p_id uuid,p_source text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.set_candidate_source(p_client,p_id,p_source);
$$;

do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname='set_candidate_source' loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

commit;
